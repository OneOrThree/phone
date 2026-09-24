package com.oneorthree.business.usecase;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.business.auth.AccessTokenClaims;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataFocusClient;
import com.oneorthree.business.upstream.data.dto.ActiveIntervalState;
import com.oneorthree.business.upstream.data.dto.CurrentFocusSession;
import com.oneorthree.business.upstream.data.dto.FocusFinish;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.FocusSummary;
import com.oneorthree.business.upstream.data.dto.PendingFocusResult;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 집중 세션 수명주기 6종의 위임 (GROMO-1764). 상태·시간·정산은 전부 Data 가 판정한다 —
 * Business 는 세션 주체를 AT 에서만 꺼내 전달하고, 도메인 실패를 공개 오류 표로 옮긴다.
 *
 * <p>주체는 <b>언제나 {@link AccessTokenClaims#userId()}</b> 다. 경로·본문으로 userId 를 받지 않으므로
 * 「남의 세션을 조작하는」 입력 자체가 존재하지 않는다.
 */
@Service
@RequiredArgsConstructor
public class FocusSessionUseCase {

    /**
     * Data 의 도메인 판정 → 공개 오류. 여기 없는 코드는 그대로 올려 보내고 전역 핸들러가
     * 「등록되지 않은 상류 계약」(502)으로 접는다 — 모르는 판정을 그럴듯한 4xx 로 위장하지 않는다.
     *
     * <p>{@code SESSION_STATE_CONFLICT} 를 {@code VERSION_CONFLICT} 가 아니라 {@code STATE_CONFLICT} 로
     * 옮기는 것은 의도다: Data 가 lifecycle 불일치와 expectedVersion 불일치를 한 코드로 합쳐 두어
     * 여기서는 둘을 구분할 수 없다. 구분이 필요해지면 Data 가 코드를 먼저 나눠야 한다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.ofEntries(
            Map.entry("INVALID_SUBJECT", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "subject")),
            Map.entry("INVALID_TARGET_MINUTES",
                    new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "targetMinutes")),
            Map.entry("ISLAND_NOT_CURRENT", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("ISLAND_MEMBERSHIP_REQUIRED", new PublicFailure(ApiErrorCode.FORBIDDEN, "islandId")),
            Map.entry("SESSION_IN_PROGRESS", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("EXPECTED_VERSION_REQUIRED",
                    new PublicFailure(ApiErrorCode.INVALID_REQUEST, "expectedVersion")),
            Map.entry("SESSION_NOT_FOUND", new PublicFailure(ApiErrorCode.NOT_FOUND, "sessionId")),
            Map.entry("FORBIDDEN", new PublicFailure(ApiErrorCode.FORBIDDEN, null)),
            Map.entry("SESSION_STATE_CONFLICT", new PublicFailure(ApiErrorCode.STATE_CONFLICT, null)),
            Map.entry("REWARD_POLICY_UNAVAILABLE", new PublicFailure(ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            // 시작 게이트도 같은 공개 503 이다 — 재시도 가능하다는 것이 앱에 참이고, 어느 게이트가
            // 막았는지는 Data 의 코드로만 갈린다(운영 로그·대시보드가 그 코드를 본다).
            Map.entry("SESSION_START_UNAVAILABLE", new PublicFailure(ApiErrorCode.SERVICE_UNAVAILABLE, null)),
            Map.entry("INVALID_SUMMARY_DATE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "date")),
            Map.entry("SUMMARY_DATE_OUT_OF_RANGE", new PublicFailure(ApiErrorCode.OUT_OF_RANGE, "date")),
            Map.entry("INVALID_SUMMARY_TIMEZONE", new PublicFailure(ApiErrorCode.INVALID_PARAMETER, "timezone")));

    private final DataFocusClient data;

    public StateView start(AccessTokenClaims claims, UUID islandId, String subject, Integer targetMinutes,
            UUID key, Deadline deadline) {
        return StateView.from(relay(() -> data.startFocusSession(
                claims.userId(), islandId, subject, targetMinutes, key, deadline)));
    }

    /**
     * 진행 세션이 없으면 {@code null} 이고, 그 null 은 정상값이다 — 공개 응답의 {@code data:null} 이 된다.
     *
     * <p>봉투 자체가 없는 것({@code null} 본문, 예: 상류가 {@code "null"} 을 준 경우)은 정상값이 아니라
     * 계약 불일치다 — 그냥 {@code .session()} 하면 NPE 로 500 이 되어 배선 사고가 서버 버그처럼 보인다.
     */
    public StateView current(AccessTokenClaims claims, Deadline deadline) {
        CurrentFocusSession envelope = relay(() -> data.fetchCurrentFocusSession(claims.userId(), deadline));
        if (envelope == null) {
            throw new UpstreamContractMismatchException("현재 집중 세션 응답 봉투가 없습니다");
        }
        return StateView.from(envelope.session());
    }

    public StateView pause(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return StateView.from(relay(() -> data.pauseFocusSession(
                claims.userId(), sessionId, expectedVersion, key, deadline)));
    }

    public StateView resume(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return StateView.from(relay(() -> data.resumeFocusSession(
                claims.userId(), sessionId, expectedVersion, key, deadline)));
    }

    public FinishView finish(AccessTokenClaims claims, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return FinishView.from(relay(() -> data.finishFocusSession(
                claims.userId(), sessionId, expectedVersion, key, deadline)));
    }

    /**
     * 휴식 1시간 초과로 서버가 끝낸 집중의 미확인 결과 (GROMO-1998). 보여 줄 것이 없으면 {@code null} 이고,
     * 그 null 은 정상값이다 — 공개 응답의 {@code data:null} 이 된다. 봉투 자체가 없는 것은 계약 불일치다
     * ({@link #current} 와 같은 판정).
     */
    public FinishView pendingResult(AccessTokenClaims claims, Deadline deadline) {
        PendingFocusResult envelope = relay(() -> data.fetchPendingFocusResult(claims.userId(), deadline));
        if (envelope == null) {
            throw new UpstreamContractMismatchException("미확인 집중 결과 응답 봉투가 없습니다");
        }
        return FinishView.from(envelope.result());
    }

    /** 결과창을 보여 줬다고 표시한다 (GROMO-1998). Data 의 조건부 UPDATE 가 최초 1회만 세팅한다. */
    public void acknowledgeResult(AccessTokenClaims claims, UUID sessionId, Deadline deadline) {
        relay(() -> {
            data.acknowledgeFocusResult(claims.userId(), sessionId, deadline);
            return null;
        });
    }

    public SummaryView summary(AccessTokenClaims claims, String date, String timezone, Deadline deadline) {
        return SummaryView.from(relay(() -> data.fetchFocusSummary(claims.userId(), date, timezone, deadline)));
    }

    /** 공개 세션 계약. 내부 응답이 확장되어도 허용한 필드만 내보낸다. */
    public record StateView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) String subject,
            Integer targetMinutes,
            @JsonProperty(required = true) String status,
            @JsonProperty(required = true) long activeSeconds,
            @JsonProperty(required = true) String serverNow,
            @JsonProperty(required = true) String startedAt,
            String restStartedAt,
            @JsonProperty(required = true) long version,
            List<ActiveIntervalView> activeIntervals) {
        private static StateView from(FocusSessionState source) {
            if (source == null) {
                return null;
            }
            return new StateView(source.id(), source.islandId(), source.subject(), source.targetMinutes(),
                    source.status(), source.activeSeconds(), source.serverNow(), source.startedAt(),
                    source.restStartedAt(), source.version(), ActiveIntervalView.fromAll(source.activeIntervals()));
        }
    }

    /** 공개 정산 계약. 중첩 객체도 내부 DTO와 분리한다. */
    public record FinishView(
            @JsonProperty(required = true) UUID recordId,
            @JsonProperty(required = true) UUID islandId,
            @JsonProperty(required = true) String subject,
            Integer targetMinutes,
            @JsonProperty(required = true) long activeSeconds,
            @JsonProperty(required = true) boolean goalAchieved,
            @JsonProperty(required = true) int earnedFish,
            @JsonProperty(required = true) AllocationView allocation,
            @JsonProperty(required = true) String completedAt,
            List<QuestProgressView> questProgress,
            List<ActiveIntervalView> activeIntervals) {
        private static FinishView from(FocusFinish source) {
            if (source == null) {
                return null;
            }
            List<QuestProgressView> progress = source.questProgress() == null ? null : source.questProgress()
                    .stream().map(QuestProgressView::from).toList();
            return new FinishView(source.recordId(), source.islandId(), source.subject(), source.targetMinutes(),
                    source.activeSeconds(), source.goalAchieved(), source.earnedFish(),
                    new AllocationView(source.allocation().personalFishAdded(),
                            source.allocation().constructionFishAdded()),
                    source.completedAt(), progress, ActiveIntervalView.fromAll(source.activeIntervals()));
        }
    }

    public record AllocationView(
            @JsonProperty(required = true) int personalFishAdded,
            @JsonProperty(required = true) int constructionFishAdded) {
    }

    public record QuestProgressView(
            @JsonProperty(required = true) UUID id,
            @JsonProperty(required = true) double myRate) {
        private static QuestProgressView from(FocusFinish.QuestProgress source) {
            return source == null ? null : new QuestProgressView(source.id(), source.myRate());
        }
    }

    /** ACTIVE 구간 하나의 공개 표현(GROMO-2131) — {@link StateView}·{@link FinishView} 가 공유한다. */
    public record ActiveIntervalView(
            @JsonProperty(required = true) String startedAt,
            @JsonProperty(required = true) String endedAt) {
        private static ActiveIntervalView from(ActiveIntervalState source) {
            return source == null ? null : new ActiveIntervalView(source.startedAt(), source.endedAt());
        }

        private static List<ActiveIntervalView> fromAll(List<ActiveIntervalState> source) {
            return source == null ? null : source.stream().map(ActiveIntervalView::from).toList();
        }
    }

    /** 공개 요약 계약. Data가 계산한 날짜·시각의 문자열 표현을 보존한다. */
    public record SummaryView(
            @JsonProperty(required = true) String date,
            @JsonProperty(required = true) long completedSeconds,
            @JsonProperty(required = true) long currentSessionSecondsToday,
            @JsonProperty(required = true) long totalSeconds,
            @JsonProperty(required = true) String serverNow) {
        private static SummaryView from(FocusSummary source) {
            return source == null ? null : new SummaryView(source.date(), source.completedSeconds(),
                    source.currentSessionSecondsToday(), source.totalSeconds(), source.serverNow());
        }
    }

    private <T> T relay(Supplier<T> upstream) {
        try {
            return upstream.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    private RuntimeException mapped(UpstreamDomainException error) {
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        // 상태까지 대조한다 — Data 가 같은 코드의 상태를 바꾸면 공개 표가 조용히 어긋나는 대신 502 가 된다.
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    /** 공개 오류 한 줄 — 코드와 사용자에게 알려 줄 입력 필드. */
    private record PublicFailure(ApiErrorCode code, String field) {
    }
}
