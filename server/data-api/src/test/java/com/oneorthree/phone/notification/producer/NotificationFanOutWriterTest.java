package com.oneorthree.phone.notification.producer;

import com.oneorthree.phone.outbox.dto.EventEnvelope;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 조각 쓰기가 «잠금 충돌이 아닌 실패»로 멈출 때의 정책 (PR #763 리뷰 ①).
 *
 * <p>잠금 충돌의 조각 재시도·부분 커밋은 실물 PostgreSQL 에서 {@code LeagueCrisisChunkRetryIntegrationTest}·
 * {@code LeagueCrisisPartialCommitIntegrationTest} 가 본다. 여기서는 PostgreSQL 이 만들 수 없는 임의의 실패(NPE 등)가 앞
 * 조각이 커밋된 뒤 날 때 재생 좌표로 이어지는 부분 커밋이 되는지를 본다 — 조각 경계의 커밋·롤백만 흉내 낸다.
 */
class NotificationFanOutWriterTest {

    private static final Instant OCCURRED = Instant.parse("2026-09-13T11:00:00Z");

    private final NotificationOutboxProducer producer = mock(NotificationOutboxProducer.class);
    private final NotificationFanOutProgress progress = new NotificationFanOutProgress();
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();

    private NotificationFanOutWriter writer() {
        @SuppressWarnings("unchecked")
        ObjectProvider<MeterRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        return new NotificationFanOutWriter(producer, new ChunkBoundaryOnly(), progress, provider, 3);
    }

    /** @return 수신자마다 한 건 — {@code count} 가 조각 상한을 넘으면 조각이 둘이 된다 */
    private static List<NotificationRequest> requests(int count) {
        List<NotificationRequest> requests = new ArrayList<>();
        for (int index = 0; index < count; index++) {
            requests.add(new NotificationRequest(NotificationKind.LEAGUE_DEADLINE, UUID.randomUUID(), null, null,
                    null, OCCURRED, "ko", Map.of("rank", index + 1)));
        }
        return requests;
    }

    private static List<Optional<EventEnvelope>> duplicates(Object slice) {
        return Collections.nCopies(((List<?>) slice).size(), Optional.empty());
    }

    @Test
    @DisplayName("앞 조각이 커밋된 뒤 뒤 조각이 잠금 충돌이 아닌 실패로 멈추면 다시 쓰지 않고 부분 커밋으로 올린다")
    void aNonLockFailureAfterAnEarlierChunkSurfacesAsPartialCommit() {
        var failure = new NullPointerException("조각 조립 실패");
        when(producer.appendAll(anyList()))
                .thenAnswer(invocation -> duplicates(invocation.getArgument(0)))
                .thenThrow(failure);

        assertThatThrownBy(() -> writer().write(requests(NotificationFanOutWriter.CHUNK_RECIPIENTS + 1),
                NotificationFanOutUnit.RECIPIENT))
                .isInstanceOfSatisfying(NotificationFanOutPartiallyCommittedException.class, partial -> {
                    assertThat(partial.getCommittedChunks()).isEqualTo(1);
                    assertThat(partial.getSqlState()).isNull();
                    assertThat(partial.getCause()).isSameAs(failure);
                });

        verify(producer, times(2)).appendAll(anyList());
        assertThat(registry.find(NotificationFanOutWriter.CHUNK_RETRY_METRIC).counter()).isNull();
        // 잠금 충돌 소진 지표는 SQLSTATE 가 있을 때만 오른다 — 비잠금 실패를 소진으로 세지 않는다.
        assertThat(registry.find(NotificationFanOutWriter.CHUNK_EXHAUSTED_METRIC).counter()).isNull();
    }

    @Test
    @DisplayName("같은 배치의 앞 write 가 커밋했으면 첫 조각의 실패도 부분 커밋이다 — 페이지마다 write 를 부르는 배치")
    void aNonLockFailureAfterAnEarlierWriteOfTheSameBatchSurfacesAsPartialCommit() {
        when(producer.appendAll(anyList())).thenThrow(new IllegalStateException("잠금과 무관한 실패"));

        try (NotificationFanOutProgress.Scope scope = progress.open()) {
            progress.recordCommittedChunk();
            assertThatThrownBy(() -> writer().write(requests(1), NotificationFanOutUnit.RECIPIENT))
                    .isInstanceOfSatisfying(NotificationFanOutPartiallyCommittedException.class,
                            partial -> assertThat(partial.getCommittedChunks()).isEqualTo(scope.committedChunks()));
        }

        verify(producer, times(1)).appendAll(anyList());
    }

    @Test
    @DisplayName("아무 조각도 커밋되지 않았으면 잠금 충돌이 아닌 실패는 그대로 올리고 다시 쓰지 않는다")
    void aNonLockFailureBeforeAnyCommitIsRethrownAsIs() {
        var failure = new IllegalStateException("첫 조각 실패");
        when(producer.appendAll(anyList())).thenThrow(failure);

        assertThatThrownBy(() -> writer().write(requests(NotificationFanOutWriter.CHUNK_RECIPIENTS + 1),
                NotificationFanOutUnit.RECIPIENT)).isSameAs(failure);

        verify(producer, times(1)).appendAll(anyList());
    }

    /** 조각 트랜잭션의 시작·커밋·롤백 경계만 있는 매니저 — 이 테스트가 보는 것은 실패 처리 정책이다. */
    private static final class ChunkBoundaryOnly extends AbstractPlatformTransactionManager {

        @Override
        protected Object doGetTransaction() {
            return new Object();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
        }
    }
}
