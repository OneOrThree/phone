package com.oneorthree.business.upstream.data;

import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.CurrentFocusSession;
import com.oneorthree.business.upstream.data.dto.FocusFinish;
import com.oneorthree.business.upstream.data.dto.FocusSessionState;
import com.oneorthree.business.upstream.data.dto.FocusSummary;
import com.oneorthree.business.upstream.data.dto.PendingFocusResult;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;

import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/** 집중 세션 수명주기·요약의 Data 호출 (GROMO-1764 · GROMO-1998). */
public class DataFocusClient {

    private static final String PATH_FOCUS_SESSIONS = "/internal/users/{userId}/focus-sessions";
    private static final String PATH_FOCUS_SESSION_CURRENT = "/internal/users/{userId}/focus-sessions/current";
    private static final String PATH_FOCUS_SESSION_PAUSE =
            "/internal/users/{userId}/focus-sessions/{sessionId}/pause";
    private static final String PATH_FOCUS_SESSION_RESUME =
            "/internal/users/{userId}/focus-sessions/{sessionId}/resume";
    private static final String PATH_FOCUS_SESSION_FINISH =
            "/internal/users/{userId}/focus-sessions/{sessionId}/finish";
    private static final String PATH_FOCUS_PENDING_RESULT =
            "/internal/users/{userId}/focus-sessions/pending-result";
    private static final String PATH_FOCUS_SESSION_ACKNOWLEDGE =
            "/internal/users/{userId}/focus-sessions/{sessionId}/acknowledge";
    private static final String PATH_FOCUS_SUMMARY = "/internal/users/{userId}/focus-summary";

    private final InternalHttpClient http;

    public DataFocusClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 집중 세션 시작 (GROMO-1764). 앱이 준 UUID 키를 그대로 실어 Data 의 공개 명령 receipt 를 재생한다 —
     * 응답 유실 뒤 재시도가 <b>두 번째 세션</b>이 되지 않게 하는 유일한 장치다.
     */
    public FocusSessionState startFocusSession(UUID userId, UUID islandId, String subject, Integer targetMinutes,
            UUID key, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(PATH_FOCUS_SESSIONS, userId))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new FocusSessionStartCommand(islandId, subject, targetMinutes))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /**
     * 본인의 진행 세션 조회. 세션이 없어도 {@code {"session": null}} 이 오고, <b>빈 본문은 계약 위반</b>이다
     * — 롤링 배포·프록시가 돌려준 빈 200 을 「세션 없음」으로 읽으면 진행 중인 집중이 사라진 것처럼 보인다.
     */
    public CurrentFocusSession fetchCurrentFocusSession(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FOCUS_SESSION_CURRENT, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<CurrentFocusSession>() { });
    }

    /** 집중 → 휴식 전이. expectedVersion 비교와 자리 배정은 Data 의 세션 행 잠금 안에서만 일어난다. */
    public FocusSessionState pauseFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_PAUSE, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /** 휴식 → 집중 전이. */
    public FocusSessionState resumeFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_RESUME, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusSessionState>() { });
    }

    /**
     * 세션 종료·정산. 보상 정책이 확정되기 전에는 Data 가 {@code REWARD_POLICY_UNAVAILABLE}(503) 로
     * 막는 것이 정상 동작이다 — 「0원 지급 성공」으로 위장하지 않는다.
     */
    public FocusFinish finishFocusSession(UUID userId, UUID sessionId, long expectedVersion, UUID key,
            Deadline deadline) {
        return transitionFocusSession(PATH_FOCUS_SESSION_FINISH, userId, sessionId, expectedVersion, key, deadline,
                new ParameterizedTypeReference<FocusFinish>() { });
    }

    /**
     * 휴식 1시간 초과로 서버가 끝낸 집중의 미확인 결과 (GROMO-1998). 보여 줄 것이 없어도
     * {@code {"result": null}} 이 오고, <b>빈 본문은 계약 위반</b>이다 — {@code current} 와 같은 이유다.
     */
    public PendingFocusResult fetchPendingFocusResult(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FOCUS_PENDING_RESULT, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<PendingFocusResult>() { });
    }

    /**
     * 자동 종료 결과창을 보여 줬다고 표시한다 (GROMO-1998). 멱등 키를 싣지 않는다 — Data 의
     * {@code acknowledged_at IS NULL} 조건부 UPDATE 자체가 최초 1회만 성공해 재시도가 무해하다.
     */
    public void acknowledgeFocusResult(UUID userId, UUID sessionId, Deadline deadline) {
        http.execute(
                InternalCall.to(HttpMethod.POST, userPath(PATH_FOCUS_SESSION_ACKNOWLEDGE, userId)
                                .replace("{sessionId}", sessionId.toString()))
                        .onBehalfOf(userId)
                        .idempotentCommand()
                        .build(),
                deadline);
    }

    /** 홈 요약. 날짜·timezone 판정은 Data 가 한다 — 여기서 KST 규약을 두 번 해석하지 않는다. */
    public FocusSummary fetchFocusSummary(UUID userId, String date, String timezone, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_FOCUS_SUMMARY, userId))
                        .onBehalfOf(userId)
                        .query("date", date)
                        .query("timezone", timezone)
                        .build(),
                deadline,
                new ParameterizedTypeReference<FocusSummary>() { });
    }

    private <T> T transitionFocusSession(String template, UUID userId, UUID sessionId, long expectedVersion,
            UUID key, Deadline deadline, ParameterizedTypeReference<T> responseType) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, userPath(template, userId).replace("{sessionId}",
                                sessionId.toString()))
                        .onBehalfOf(userId)
                        .idempotencyKey(key.toString())
                        .body(new FocusVersionedCommand(expectedVersion))
                        .idempotentCommand()
                        .build(),
                deadline,
                responseType);
    }

    /** 집중 세션 시작 요청 본문 (GROMO-1764). */
    record FocusSessionStartCommand(UUID islandId, String subject, Integer targetMinutes) {
    }

    /** pause/resume/finish 공용 요청 본문 — expectedVersion 필수(FR-P07). */
    record FocusVersionedCommand(long expectedVersion) {
    }
}
