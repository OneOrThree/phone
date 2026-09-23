package com.oneorthree.business.usecase;

import com.oneorthree.business.api.dto.MailboxMessageResponse;
import com.oneorthree.business.api.dto.MailboxPageResponse;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.request.CursorBoundary;
import com.oneorthree.business.common.request.CursorScope;
import com.oneorthree.business.common.request.SignedCursorCodec;
import com.oneorthree.business.upstream.data.DataIslandClient;
import com.oneorthree.business.upstream.data.dto.MailboxViewer;
import com.oneorthree.business.upstream.data.dto.MessageAuthors;
import com.oneorthree.business.upstream.realtime.RealtimeApiClient;
import com.oneorthree.business.upstream.realtime.dto.RealtimeHistory;
import com.oneorthree.business.upstream.realtime.dto.RealtimeMessage;
import com.oneorthree.business.upstream.realtime.dto.RealtimeStoreResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 우체통 편지방 두 경로의 조합 (GROMO-1775, island-mailbox LLD §1·§3·§4·§5).
 *
 * <p>Business 는 저장소가 없다. 세 상류를 순서대로 부른다 — <b>Data(주민·시설 인가 + 표시)</b> →
 * <b>실시간(저장소)</b> → <b>Data(작성자 표시 / {@code message.created} 적재)</b>. 인가가 먼저인 것이 계약이다:
 * 실시간 서버의 내부 어댑터는 인가를 하지 않으므로, 이 순서를 뒤집으면 비주민이 남의 섬에 쓴다.
 *
 * <p>집중·휴식 상태는 <b>보지 않는다</b> — 정책 M12(MQ02 결정, 재영님 2026-09-18): 서버는 우체통을 막지 않고
 * 앱이 화면에서 막는다. legacy {@code /api/v1/chat} 의 집중 차단은 실시간 서버에 그대로 남아 있다.
 *
 * <p>이 클래스가 옮기는 것은 이름뿐이다 — 실시간 서버의 {@code messageId/senderId/content/sentAt} 을 공개
 * {@code id/userId/text/createdAt} 으로(LLD §2 「명시 매핑」). 판정은 전부 상류가 한다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class IslandMailboxUseCase {

    public static final int DEFAULT_LIMIT = 30;
    public static final int MAX_LIMIT = 100;

    /** 서명 커서의 scope 이름 — 사용자·섬·정렬·limit 이 함께 지문에 묶인다(LLD §5). */
    private static final String CURSOR_RESOURCE = "islands/messages";
    private static final String CURSOR_SORT = "id-desc";

    /**
     * 상류의 도메인 판정 → 공개 오류. 여기 없는 코드는 그대로 올려 전역 핸들러가 이름으로 옮기거나(같은 이름·
     * 같은 상태일 때) 「등록되지 않은 상류 계약」(502)으로 접는다. 상태까지 대조한다 — 상류가 같은 코드의
     * 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            // Data — 주민 인가 술어(InternalIslandMailboxService.requireResident)
            Map.entry("MEMBER_ONLY", new PublicFailure(403, ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("MAILBOX_LOCKED", new PublicFailure(403, ApiErrorCode.FACILITY_LOCKED, null)),
            Map.entry("USER_NOT_FOUND", new PublicFailure(404, ApiErrorCode.USER_NOT_FOUND, null)),
            // 실시간 — 같은 키·다른 본문(M05). field 가 헤더가 아니라 본문 필드라 기본 매핑을 쓰지 않는다
            Map.entry("IDEMPOTENCY_KEY_REUSED",
                    new PublicFailure(409, ApiErrorCode.IDEMPOTENCY_KEY_REUSED, "clientMessageId")),
            // 실시간 — 본문 규칙(M10). 공개 경계가 먼저 거절하므로 보통 닿지 않는다; 닿으면 같은 422 다
            Map.entry("BLANK_CONTENT", new PublicFailure(400, ApiErrorCode.OUT_OF_RANGE, "text")),
            Map.entry("CONTENT_TOO_LONG", new PublicFailure(400, ApiErrorCode.OUT_OF_RANGE, "text")),
            Map.entry("INVALID_CONTENT", new PublicFailure(400, ApiErrorCode.OUT_OF_RANGE, "text")));

    private final DataIslandClient data;
    private final RealtimeApiClient realtime;
    private final ObjectProvider<SignedCursorCodec> cursorCodecs;

    /**
     * 목록 — 최신 묶음부터 과거로, 묶음 안에서는 오름차순(M06).
     *
     * <p>커서는 인가 증명이 아니다. 매 페이지 Data 인가를 다시 한다(LLD §5) — 커서를 먼저 푸는 것은 «위조·만료
     * 커서로 상류를 두드리지 않기 위해서»이지 인가를 건너뛰기 위해서가 아니다.
     */
    public MailboxPageResponse list(AccessTokenClaims claims, UUID islandId, String cursorToken, int limit,
            Deadline deadline) {
        CursorScope scope = scope(claims, islandId, limit);
        UUID anchor = anchorOf(codec().decode(cursorToken, scope));
        return present(claims, islandId, scope, history(claims, islandId, anchor, limit, deadline), deadline);
    }

    /**
     * 화면 {@code /screens/mailbox} 의 {@code messages} 조각 전반부 — 인가 + 첫 페이지(GET 두 번). 화면 병렬 조합은
     * GET 만 허용하므로 작성자 표시(POST batch)는 여기서 하지 않고 {@link #presentFirstPage} 가 조합 뒤에 붙인다
     * (bff-screens {@code cross-service-mailbox} 그림의 「작성자 표시」 단계). 인가·오류 표는 도메인 GET 과 같다.
     */
    public RealtimeHistory firstPage(AccessTokenClaims claims, UUID islandId, Deadline deadline) {
        return history(claims, islandId, null, DEFAULT_LIMIT, deadline);
    }

    /**
     * {@link #firstPage} 결과에 작성자 이름을 붙이고 도메인 GET 과 같은 scope·limit 의 서명 커서를 발행한다 —
     * 다음 페이지는 {@code GET /islands/{islandId}/messages?cursor=} 가 그대로 이어받는다(B10).
     */
    public MailboxPageResponse presentFirstPage(AccessTokenClaims claims, UUID islandId, RealtimeHistory page,
            Deadline deadline) {
        return present(claims, islandId, scope(claims, islandId, DEFAULT_LIMIT), page, deadline);
    }

    private static CursorScope scope(AccessTokenClaims claims, UUID islandId, int limit) {
        return new CursorScope(claims.userId(), CURSOR_RESOURCE,
                Map.of("islandId", islandId.toString()), CURSOR_SORT, limit);
    }

    private RealtimeHistory history(AccessTokenClaims claims, UUID islandId, UUID anchor, int limit,
            Deadline deadline) {
        access(islandId, claims, deadline);
        RealtimeHistory page = relay(() -> realtime.history(islandId, claims.userId(), anchor, limit, deadline));
        if (page == null || page.messages() == null) {
            throw new UpstreamContractMismatchException("실시간 히스토리 응답 봉투가 없습니다");
        }
        return page;
    }

    private MailboxPageResponse present(AccessTokenClaims claims, UUID islandId, CursorScope scope,
            RealtimeHistory page, Deadline deadline) {
        Map<UUID, String> names = authorNames(islandId, claims, page.messages(), deadline);

        List<MailboxMessageResponse> items = new ArrayList<>(page.messages().size());
        for (int i = page.messages().size() - 1; i >= 0; i--) {
            RealtimeMessage message = page.messages().get(i);
            items.add(publicMessage(message, names.get(message.senderId())));
        }
        String next = page.nextCursor() == null ? null
                : codec().encode(scope, new CursorBoundary(page.nextCursor().toString(), page.nextCursor().toString()));
        return new MailboxPageResponse(items, next);
    }

    /**
     * 발신 — 인가 → 저장 → (처음 저장이면) {@code message.created} 적재.
     *
     * <h2>저장과 적재 사이에 원자성이 없다</h2>
     * 메시지 행은 실시간 서버의 {@code gromo_chat} 에, 사건 봉투는 Data 의 {@code gromo} outbox 에 — 다른 DB,
     * 다른 트랜잭션, 두 번의 HTTP 다. 「저장은 됐는데 적재는 실패」가 가능하다(그 반대는 없다 — 적재는 저장
     * 성공을 본 뒤에만 부른다).
     *
     * <p><b>그 경우 요청은 201 로 성공하고 사건은 유실된다. 재시도하지 않는다.</b> 근거 셋:
     * ① 메시지는 커밋돼 있고 history 재조회가 화면을 복구한다(M09) — 여기서 실패로 답하면 앱이 재전송하고, 그
     * 재전송은 «이미 있는 행»이라 적재 경로를 타지 않아 얻는 것이 없다. ② 실시간 서버 내부 클라이언트의
     * {@code idempotentCommand} 가 이미 일시 장애 한 번은 재시도한다. ③ 지금 REALTIME 전달 자체가 꺼져 있다 —
     * Data relay 에 REALTIME transport 가 등록돼 있지 않고 실시간 서버의 {@code DisabledRealtimeDelivery} 는
     * 항상 예외를 던진다. 봉투는 내구 보류될 뿐 아무 데도 가지 않으므로 오늘의 유실은 실질 0 이다.
     *
     * <p>ponytail: 저장/적재 원자성 없음 — 전달을 켜기 전에 적재를 저장 쪽으로 옮기거나 보상 재시도. 지금은 전달이 꺼져 있어 무해.
     *
     * <p>전달을 켜기 전 게이트(1764 가 같은 자리를 「전달이 꺼져 있어 페이로드 검증 불가」로 게이트에 올린 것과
     * 같은 정직함으로): 적재를 저장과 같은 쪽으로 옮기거나 보상 재시도(실패 로그 → 재적재 잡)를 붙인다.
     * 그 전에는 여기 로그 한 줄이 유일한 흔적이다 — 본문·이름은 싣지 않는다(LLD §6).
     */
    public MailboxMessageResponse send(AccessTokenClaims claims, UUID islandId, UUID clientMessageId, String text,
            Deadline deadline) {
        MailboxViewer viewer = access(islandId, claims, deadline);
        RealtimeStoreResult stored = relay(
                () -> realtime.store(islandId, claims.userId(), clientMessageId, text, deadline));
        if (stored == null || stored.message() == null) {
            throw new UpstreamContractMismatchException("실시간 저장 응답 봉투가 없습니다");
        }
        if (stored.freshlyInserted()) {
            recordMessageCreated(islandId, claims.userId(), stored.message(), deadline);
        }
        return publicMessage(stored.message(), viewer.name());
    }

    private void recordMessageCreated(UUID islandId, UUID authorId, RealtimeMessage message, Deadline deadline) {
        try {
            data.recordMessageCreated(islandId, authorId, message.messageId(), message.clientMessageId(),
                    message.sentAt(), deadline);
        } catch (RuntimeException e) {
            // 저장은 끝났다. 사건만 유실 — 사유·재시도 없음·전달 꺼짐은 위 javadoc. 본문·이름은 싣지 않는다.
            log.error("message.created outbox 적재 실패 — islandId={} messageId={} cause={}",
                    islandId, message.messageId(), e.getClass().getSimpleName());
        }
    }

    /** 주민·시설 인가 + 요청자 표시. Data 가 판정하고 여기는 코드만 옮긴다. */
    private MailboxViewer access(UUID islandId, AccessTokenClaims claims, Deadline deadline) {
        MailboxViewer viewer = relay(() -> data.mailboxAccess(islandId, claims.userId(), deadline));
        if (viewer == null || viewer.userId() == null) {
            throw new UpstreamContractMismatchException("Data 우체통 인가 응답이 비어 있습니다");
        }
        return viewer;
    }

    /**
     * 페이지의 sender 집합으로 <b>한 번</b> batch 조회한다(LLD §5). 상류 장애는 그대로 올린다 — 활성 작성자를
     * 「알 수 없음」으로 바꿔 그리지 않는다(LLD §2). 응답에 없는 id 는 계정이 없는 것이고 그때만 null 이다.
     */
    private Map<UUID, String> authorNames(UUID islandId, AccessTokenClaims claims, List<RealtimeMessage> messages,
            Deadline deadline) {
        LinkedHashSet<UUID> senders = new LinkedHashSet<>();
        for (RealtimeMessage message : messages) {
            senders.add(message.senderId());
        }
        Map<UUID, String> names = new HashMap<>();
        if (senders.isEmpty()) {
            return names;
        }
        MessageAuthors authors = relay(
                () -> data.messageAuthors(islandId, claims.userId(), List.copyOf(senders), deadline));
        if (authors == null || authors.authors() == null) {
            throw new UpstreamContractMismatchException("Data 작성자 표시 응답 봉투가 없습니다");
        }
        for (MailboxViewer author : authors.authors()) {
            names.put(author.userId(), author.name());
        }
        return names;
    }

    private static MailboxMessageResponse publicMessage(RealtimeMessage message, String name) {
        return new MailboxMessageResponse(message.messageId(), message.clientMessageId(), message.senderId(), name,
                message.content(), message.sentAt());
    }

    /**
     * {@code SignedCursorCodec} 은 {@code business.cursor.enabled=true} 와 독립 서명키가 있을 때만 등록된다
     * (1759 와 같은 블록·같은 env). 키가 없는 환경에서 커서를 «없는 셈» 치고 첫 페이지를 돌려주면 위조 커서를
     * 조용히 허용하는 것과 같으므로 명시적으로 실패시킨다 — {@code IslandMembershipUseCase#codec} 과 같은 모양.
     */
    private SignedCursorCodec codec() {
        SignedCursorCodec codec = cursorCodecs.getIfAvailable();
        if (codec == null) {
            throw new PublicApiException(ApiErrorCode.SERVICE_UNAVAILABLE, null);
        }
        return codec;
    }

    /** 커서 본문의 anchor(저장소 id). 서명은 통과했는데 값이 UUID 가 아니면 위조·손상이다 — 같은 400. */
    private static UUID anchorOf(CursorBoundary boundary) {
        if (boundary == null) {
            return null;
        }
        try {
            return UUID.fromString(boundary.sortKey());
        } catch (IllegalArgumentException e) {
            throw new PublicApiException(ApiErrorCode.INVALID_CURSOR, "cursor");
        }
    }

    private static <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            PublicFailure failure = DOMAIN_FAILURES.get(e.getCode());
            if (failure == null || failure.upstreamStatus() != e.getStatus()) {
                throw e;
            }
            throw new PublicApiException(failure.code(), failure.field());
        }
    }

    /** 상류 (status, code) 한 쌍 → 공개 코드와 입력 필드. */
    private record PublicFailure(int upstreamStatus, ApiErrorCode code, String field) {
    }
}
