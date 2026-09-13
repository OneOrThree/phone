package com.oneorthree.phone.outbox.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.IdempotentOutcome;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandReceipt;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.repository.CommandIdempotencyRepository;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 실제 Flyway PostgreSQL과 생산 빈으로 공개 명령의 저장·재생·경합·권한 경계를 검증한다. */
@SpringBootTest
class PublicCommandIntegrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    PublicCommandService service;
    @Autowired
    OutboxCommandPort outbox;
    @Autowired
    CommandIdempotencyRepository receipts;
    @Autowired
    EventOutboxRepository events;
    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("응답 유실 재시도는 원 HTTP 상태·data·이벤트를 재생하고 새 버전 검사와 쓰기를 건너뛴다")
    void replaysOriginalResultWithoutExecutingNewVersionCheck() {
        PublicCommandRequest request = request();
        AtomicInteger writes = new AtomicInteger();
        AtomicInteger replayChecks = new AtomicInteger();
        String eventId = "public-replay-" + UUID.randomUUID();
        IdempotentOutcome<PublicCommandReceipt> first = tx().execute(status -> service.run(
                request, active(), receipt -> replayChecks.incrementAndGet(), () -> {
                    writes.incrementAndGet();
                    append(request, eventId);
                    return result(201, "{\"balance\":100}", eventId);
                }));
        IdempotentOutcome<PublicCommandReceipt> second = tx().execute(status -> service.run(
                request, active(), receipt -> replayChecks.incrementAndGet(), () -> {
                    throw new IllegalStateException("낡은 expectedVersion은 신규 실행에서만 검사");
                }));
        assertThat(first.replayed()).isFalse();
        assertThat(second.replayed()).isTrue();
        assertThat(second.value()).isEqualTo(first.value());
        assertThat(second.value().contractVersion()).isEqualTo(1);
        assertThat(second.value().httpStatus()).isEqualTo(201);
        assertThat(second.value().data().get("balance").asInt()).isEqualTo(100);
        assertThat(writes.get()).isEqualTo(1);
        assertThat(replayChecks.get()).isEqualTo(1);
        assertThat(events.findByEventId(eventId)).isPresent();
    }

    @Test
    @DisplayName("두 동시 같은 키는 DB 선점에서 대기하고 한 번만 도메인/outbox를 쓴다")
    void concurrentSameKeyExecutesOnce() throws Exception {
        PublicCommandRequest request = request();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch followerStarted = new CountDownLatch(1);
        AtomicInteger writes = new AtomicInteger();
        String eventId = "public-race-" + UUID.randomUUID();
        var executor = Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> tx().execute(status -> service.run(
                    request, active(), authorized(), () -> {
                        writes.incrementAndGet();
                        append(request, eventId);
                        entered.countDown();
                        await(release);
                        return result(200, "{\"version\":1}", eventId);
                    })));
            assertThat(entered.await(20, TimeUnit.SECONDS)).isTrue();
            var follower = executor.submit(() -> {
                followerStarted.countDown();
                return tx().execute(status -> service.run(request, active(), authorized(), () -> {
                    writes.incrementAndGet();
                    throw new AssertionError("재생 경로에서 새 쓰기 금지");
                }));
            });
            assertThat(followerStarted.await(20, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> follower.get(200, TimeUnit.MILLISECONDS))
                    .isInstanceOf(java.util.concurrent.TimeoutException.class);
            release.countDown();
            var saved = first.get(20, TimeUnit.SECONDS);
            var replay = follower.get(20, TimeUnit.SECONDS);
            assertThat(replay.replayed()).isTrue();
            assertThat(replay.value()).isEqualTo(saved.value());
            assertThat(writes.get()).isEqualTo(1);
            assertThat(events.findByEventId(eventId)).isPresent();
        } finally {
            release.countDown();
            executor.shutdownNow();
            assertThat(executor.awaitTermination(20, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    @DisplayName("도메인 실패 또는 receipt 작성 뒤 외부 TX 실패는 receipt와 outbox를 함께 롤백한다")
    void failureRollsBackReceiptAndOutbox() {
        for (boolean failInside : List.of(true, false)) {
            PublicCommandRequest request = request();
            String eventId = "public-rollback-" + UUID.randomUUID();
            assertThatThrownBy(() -> tx().executeWithoutResult(status -> {
                service.run(request, active(), authorized(), () -> {
                    append(request, eventId);
                    if (failInside) {
                        throw new IllegalStateException("도메인 실패");
                    }
                    return result(200, "null", eventId);
                });
                throw new IllegalStateException("도메인 실패");
            })).hasMessage("도메인 실패");
            assertThat(receipts.findById(request.storageRequest().storageKey())).isEmpty();
            assertThat(events.findByEventId(eventId)).isEmpty();
            var retry = tx().execute(status -> service.run(request, active(), authorized(), () -> {
                append(request, eventId);
                return result(200, "null", eventId);
            }));
            assertThat(retry.replayed()).isFalse();
        }
    }

    @Test
    @DisplayName("사용자 또는 실제 자원 operation이 다르면 같은 앱 UUID도 서로 다른 명령이다")
    void separatesUsersAndOperationsIncludingLongPaths() {
        UUID key = UUID.randomUUID();
        UUID user = UUID.randomUUID();
        String firstOperation = "PATCH /islands/" + UUID.randomUUID() + "/" + "appearance/".repeat(20);
        List<PublicCommandRequest> requests = List.of(
                new PublicCommandRequest(user, firstOperation, key, json("{}")),
                new PublicCommandRequest(UUID.randomUUID(), firstOperation, key, json("{}")),
                new PublicCommandRequest(user, "PATCH /islands/" + UUID.randomUUID(), key, json("{}")));
        for (PublicCommandRequest request : requests) {
            assertThat(request.storageRequest().commandType()).hasSizeLessThanOrEqualTo(100);
            var first = tx().execute(status -> service.run(request, active(), authorized(),
                    () -> result(200, "{}", null)));
            assertThat(first.replayed()).isFalse();
            assertThat(first.value().operation()).isEqualTo(request.operation());
            var replay = tx().execute(status -> service.run(request, active(), authorized(), () -> {
                throw new AssertionError("재실행 금지");
            }));
            assertThat(replay.value()).isEqualTo(first.value());
        }
    }

    @Test
    @DisplayName("같은 작업/키의 다른 본문은 충돌하고 다른 의미가 원 결과를 얻지 못한다")
    void rejectsChangedBodyUnderSameKey() {
        PublicCommandRequest request = request();
        save(request);
        PublicCommandRequest changed = new PublicCommandRequest(request.userId(), request.operation(),
                request.key(), json("{\"expectedVersion\":2}"));
        assertThatThrownBy(() -> tx().execute(status -> service.run(changed, active(), authorized(), () -> {
            throw new AssertionError("다른 본문 재실행 금지");
        }))).isInstanceOf(OutboxException.class)
                .extracting(error -> ((OutboxException) error).getErrorCode())
                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
    }

    @Test
    @DisplayName("지원하지 않는 저장 계약 버전은 명시 거절하며 새 쓰기를 실행하지 않는다")
    void rejectsUnsupportedStoredContractWithoutReexecution() {
        PublicCommandRequest request = request();
        // 미래 배포가 확정한 결과를 동일한 생산 포트로 저장한다. fixture DDL/빈 교체는 하지 않는다.
        tx().execute(status -> outbox.runIdempotent(request.storageRequest(), JsonNode.class,
                () -> json("{\"contractVersion\":2,\"futureShape\":{\"newField\":true}}")));
        assertThatThrownBy(() -> tx().execute(status -> service.run(request, active(), authorized(), () -> {
            throw new AssertionError("미지원 버전 재실행 금지");
        }))).isInstanceOf(OutboxException.class)
                .extracting(error -> ((OutboxException) error).getErrorCode())
                .isEqualTo(OutboxErrorCode.PUBLIC_COMMAND_CONTRACT_UNSUPPORTED);
        assertThat(receipts.findById(request.storageRequest().storageKey())).isPresent();
    }

    @Test
    @DisplayName("비활성 계정과 재생 권한 소멸은 저장 결과 반환 전에 각각 거절한다")
    void rechecksActiveSubjectAndReplayAuthorization() {
        PublicCommandRequest request = request();
        save(request);
        AtomicBoolean returned = new AtomicBoolean();
        assertThatThrownBy(() -> tx().execute(status -> service.run(request, () -> {
            throw new IllegalStateException("비활성 계정");
        }, receipt -> returned.set(true), () -> result(200, "{}", null)))).hasMessage("비활성 계정");
        assertThat(returned.get()).isFalse();
        assertThatThrownBy(() -> tx().execute(status -> service.run(request, active(), receipt -> {
            assertThat(receipt.userId()).isEqualTo(request.userId());
            throw new IllegalStateException("재생 결과 열람 권한 소멸");
        }, () -> result(200, "{}", null)))).hasMessage("재생 결과 열람 권한 소멸");
        assertThat(receipts.findById(request.storageRequest().storageKey())).isPresent();
    }

    @Test
    @DisplayName("생산 서비스는 외부 TX와 두 권한 검사 구현을 반드시 요구한다")
    void requiresTransactionAndAuthorizationBoundaries() {
        PublicCommandRequest request = request();
        assertThatThrownBy(() -> service.run(request, active(), authorized(), () -> result(200, "{}", null)))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThatThrownBy(() -> tx().execute(status -> service.run(
                request, null, authorized(), () -> result(200, "{}", null))))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> tx().execute(status -> service.run(
                request, active(), null, () -> result(200, "{}", null))))
                .isInstanceOf(NullPointerException.class);
        assertThat(receipts.findById(request.storageRequest().storageKey())).isEmpty();
    }

    private void save(PublicCommandRequest request) {
        tx().execute(status -> service.run(request, active(), authorized(), () -> result(200, "{}", null)));
    }

    private void append(PublicCommandRequest request, String eventId) {
        outbox.append(new OutboxAppendCommand(eventId, 1, "public.command.completed", request.userId(),
                "ko", null, AggregateRef.ofUser(request.userId()), null, Map.of(),
                List.of(OutboxDeliveryRequest.toKafka())));
    }

    private TransactionTemplate tx() {
        return new TransactionTemplate(transactionManager);
    }

    private static PublicCommandRequest request() {
        return new PublicCommandRequest(UUID.randomUUID(), "POST /focus-sessions/" + UUID.randomUUID() + "/finish",
                UUID.randomUUID(), json("{\"expectedVersion\":1}"));
    }

    private static PublicCommandResult result(int status, String data, String eventId) {
        var eventList = JSON.createArrayNode();
        if (eventId != null) {
            eventList.addObject().put("eventId", eventId).put("version", 1);
        }
        return new PublicCommandResult(status, json(data), eventList);
    }

    private static JsonNode json(String source) {
        try {
            return JSON.readTree(source);
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException(e);
        }
    }

    /** 이 테스트는 사용자 도메인을 만들지 않으며 필수 콜백 호출 경계 자체를 별도 검증한다. */
    private static Runnable active() {
        return () -> { };
    }

    private static java.util.function.Consumer<PublicCommandReceipt> authorized() {
        return receipt -> assertThat(receipt.userId()).isNotNull();
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(20, TimeUnit.SECONDS)) {
                throw new IllegalStateException("동시 요청 동기화 실패");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }
}
