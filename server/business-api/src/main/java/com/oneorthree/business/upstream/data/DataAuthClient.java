package com.oneorthree.business.upstream.data;

import com.oneorthree.business.auth.LogoutCredentials;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.common.http.InternalCall;
import com.oneorthree.business.common.http.InternalHttpClient;
import com.oneorthree.business.upstream.data.dto.AccountMe;
import com.oneorthree.business.upstream.data.dto.AccountProfile;
import com.oneorthree.business.upstream.data.dto.DeviceSessionCheck;
import com.oneorthree.business.upstream.data.dto.LoginAttemptLookup;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import com.oneorthree.business.upstream.data.dto.SessionRefresh;
import com.oneorthree.business.upstream.data.dto.UserActivation;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static com.oneorthree.business.upstream.data.DataPaths.sessionScoped;
import static com.oneorthree.business.upstream.data.DataPaths.userPath;

/**
 * 인증·계정 축의 Data 호출 — 로그인 시도, 세션 발급·갱신·폐기, 활성·세션 확인, 계정 projection.
 *
 * <p>세션 증명({@code sid}·{@code gen})은 서명된 AT 에서 꺼낸 값을 헤더로 싣는다(B26).
 * 자격이 인증 정본인 경로만 {@code endUserAuthErrors} 를 켠다({@link InternalCall} 참고).
 */
public class DataAuthClient {

    private static final String PATH_ACTIVATION = "/internal/users/{userId}/activation";
    private static final String PATH_DEVICE_SESSION_VERIFY = "/internal/auth/device-sessions/verify";
    private static final String PATH_SESSION_VERIFY = "/internal/auth/sessions/verify";
    private static final String PATH_LOGIN_ATTEMPTS = "/internal/auth/login-attempts";
    private static final String PATH_LOGIN_ATTEMPT_LOOKUP = "/internal/auth/login-attempts/lookup";
    private static final String PATH_ACCOUNT = "/internal/users/{userId}";

    private final InternalHttpClient http;

    public DataAuthClient(InternalHttpClient http) {
        this.http = http;
    }

    /**
     * 제공자 교환 <b>전</b> 내구 시도 조회 (계정 LLD §3-1 · §3-2).
     *
     * <p>{@code onBehalfOf} 가 없다 — 로그인 전에는 검증된 주체가 없다. 그게 이 요청으로 알아내려는
     * 값이다. 자격은 {@code digest} 가 증명한다.
     *
     * <p>{@code idempotentCommand()} 를 켜는 이유: 이 호출은 상태를 바꾸지 않아 재시도가 안전한데,
     * 기본 재시도 대상은 GET 뿐이라 켜 주지 않으면 일시 오류 한 번에 로그인이 실패한다.
     *
     * <p>뒤의 다섯 값은 전환 시도의 재생 관문 증거다 (GROMO-1992) — 일반 시도는 null/false 그대로
     * 실려도 되고, Data 는 {@code switch_phase} 가 있는 행에서만 이 값들을 요구한다.
     * {@code callerAccessToken} 은 source 자격 증명용이며 이 DTO 는 {@code toString} 에서 가린다.
     */
    public LoginAttemptLookup lookupLoginAttempt(UUID attemptId, String digestKeyId, String digest,
            String callerAccessToken, String provider, String credentialKind, String termsVersion,
            Boolean accountSwitchConfirmed, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_LOGIN_ATTEMPT_LOOKUP)
                        .body(new LoginAttemptLookupCommand(attemptId, digestKeyId, digest,
                                callerAccessToken, provider, credentialKind, termsVersion,
                                accountSwitchConfirmed))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginAttemptLookup>() { });
    }

    /**
     * 실행권을 잡고 제공자 교환까지 수행한다 (계정 LLD §3-3).
     *
     * <p><b>{@code attemptId} 가 멱등 키다.</b> 원장이 그 키로 실행권을 선점하므로, 재시도가 같은
     * 값을 들고 오면 두 번째 교환이 일어나지 않는다. 별도 {@code Idempotency-Key} 헤더를 붙이지
     * 않는 이유는 로그인이 범용 receipt 계약 밖이기 때문이다(정책 A16 「로그인/로그아웃은 별도
     * 인증 계약이다」).
     */
    public LoginSession executeLoginAttempt(LoginAttemptCommand command, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_LOGIN_ATTEMPTS)
                        .body(command)
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginSession>() { });
    }

    /**
     * 조회 요청 본문. 원 자격이 아니라 digest 만 나간다 — 단 전환 재생 증거로 source AT 가 실리므로
     * {@code toString} 은 그 값을 가린다 ({@link LoginAttemptCommand} 와 같은 규율).
     */
    private record LoginAttemptLookupCommand(
            UUID attemptId, String digestKeyId, String credentialDigest, String callerAccessToken,
            String provider, String credentialKind, String termsVersion,
            Boolean accountSwitchConfirmed) {

        @Override
        public String toString() {
            return "LoginAttemptLookupCommand[attemptId=" + attemptId + ", provider=" + provider
                    + ", credentialKind=" + credentialKind + ", callerAccessToken=redacted]";
        }
    }

    /**
     * 교환 요청 본문.
     *
     * <p>{@code credential}·{@code callerAccessToken} 은 자격 원문이다 — 이 DTO 는 HTTP 본문으로
     * 한 번 나갈 뿐 어디에도 보관되지 않으며, {@code toString} 은 값을 가린다(직렬화는 Jackson 이
     * 필드 접근자로 하므로 가려도 전송에는 영향이 없다).
     */
    public record LoginAttemptCommand(
            UUID attemptId, String digestKeyId, String credentialDigest, String provider,
            String credentialKind, String credential, String termsVersion, String callerAccessToken,
            boolean accountSwitchConfirmed) {

        @Override
        public String toString() {
            return "LoginAttemptCommand[attemptId=" + attemptId + ", provider=" + provider
                    + ", credentialKind=" + credentialKind + ", credential=redacted]";
        }
    }

    /**
     * AT 재발급 (GROMO-2035). 주체는 Data 가 RT 서명에서 직접 확인한다 — {@code onBehalfOf} 가 없는
     * 이유도 그것이다(여기 닿는 요청은 유효한 AT 를 갖고 있지 않다).
     *
     * <p>{@code idempotentCommand()} 를 켠다: 이 경로는 회전하지 않아 상태를 바꾸지 않으므로 재시도가
     * 안전하고, 켜 주지 않으면 일시 오류 한 번에 앱이 재로그인으로 떨어진다(기본 재시도 대상은 GET 뿐).
     */
    public SessionRefresh refreshSession(String refreshToken, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/sessions/refresh")
                        .body(new SessionRefreshCommand(refreshToken))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<SessionRefresh>() { });
    }

    /**
     * 게스트 세션 발급 (GROMO-2036).
     *
     * <p><b>{@code deviceDigest} 가 멱등 키다.</b> Data 의 점유 원장이 그 값으로 복구 창을 잡으므로,
     * 유실된 201 을 재시도해도 계정이 하나 더 생기지 않는다 — {@code executeLoginAttempt} 의
     * {@code attemptId} 와 같은 자리다. 그래서 여기서도 {@code idempotentCommand()} 를 켠다.
     *
     * @param clientIp Business 가 판정한 호출자 주소. Data 의 게스트 레이트리밋 축이라 <b>반드시</b>
     *                 넘긴다 — 내부 호출의 소스 IP 를 쓰면 모든 게스트가 한 주소로 뭉쳐 한도가
     *                 「전원 차단」으로 동작한다
     */
    public LoginSession issueGuestSession(String deviceDigest, String clientIp, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/guest-sessions")
                        .body(new GuestSessionCommand(deviceDigest, clientIp))
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<LoginSession>() { });
    }

    /** 갱신 요청 본문. RT 원문이라 {@code toString} 이 값을 가린다. */
    private record SessionRefreshCommand(String refreshToken) {
        @Override
        public String toString() {
            return "SessionRefreshCommand[refreshToken=redacted]";
        }
    }

    /** 게스트 발급 요청 본문. 기기 식별자 «원문» 은 나가지 않는다 — digest 만 나간다. */
    private record GuestSessionCommand(String deviceDigest, String clientIp) {
    }

    /** 원 RT의 폐기 증명으로 재시도 가능한 로그아웃. 주체는 Data가 자격에서 직접 검증한다. */
    public JsonNode logoutSession(LogoutCredentials credentials, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, "/internal/auth/sessions/logout")
                        .body(credentials)
                        .endUserAuthErrors()
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }

    /**
     * 위성 쓰기 전 활성 검사 (A22 ⓖ). 멱등 GET 이라 재시도한다.
     *
     * <p><b>실패를 「비활성」으로 접지 않는다</b> — 그러면 Data 장애가 「전원 탈퇴」라는 조용한 차단이
     * 되어 설정 변경·기기 등록이 전부 막힌다. 판정 불가는 503 으로 올라간다.
     */
    public UserActivation checkActivation(UUID userId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.GET, userPath(PATH_ACTIVATION, userId))
                        .onBehalfOf(userId)
                        .build(),
                deadline,
                new ParameterizedTypeReference<UserActivation>() { });
    }

    /**
     * {@code deviceBootstrap} 세션 활성 확인 + {@code sessionEpoch} fencing (A22 ㋤ · ㋨).
     *
     * <p>POST 지만 <b>상태를 바꾸지 않는 확인</b>이라 재시도해도 안전하다. GET 이 아닌 이유는 자격
     * 문자열을 쿼리에 실으면 접근 로그·프록시 캐시에 남기 때문이다.
     */
    public DeviceSessionCheck verifyDeviceSession(UUID userId, String deviceBootstrap, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_DEVICE_SESSION_VERIFY)
                        .onBehalfOf(userId)
                        .body(Map.of("deviceBootstrap", deviceBootstrap))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceSessionCheck>() { });
    }

    /**
     * 서명된 {@code sid} 로 하는 세션 활성 확인 — <b>자격을 싣지 못하는 구 앱</b> 경로(A22 ㋤).
     *
     * <p>확인만 하고 <b>자격은 받지 않는다</b>: 응답에는 활성 여부와 fencing 값만 있다. 자격을 받아
     * 등록 봉투에 실으면 저장하지도 않은 앱이 1회용 자격을 가진 것처럼 되어, 현대 앱의 소유권·CAS
     * 판정이 이 경로로 우회된다.
     *
     * @param sessionId AT 의 {@code sid} claim — 서버가 서명한 값이라 앱이 만들어낼 수 없다
     */
    public DeviceSessionCheck verifySession(UUID userId, UUID sessionId, Deadline deadline) {
        return http.exchange(
                InternalCall.to(HttpMethod.POST, PATH_SESSION_VERIFY)
                        .onBehalfOf(userId)
                        .body(Map.of("sessionId", sessionId.toString()))
                        .idempotentCommand()
                        .build(),
                deadline,
                new ParameterizedTypeReference<DeviceSessionCheck>() { });
    }

    /** 계정 projection (GROMO-1801 · 계정 LLD §2.2). 멱등 GET 이라 재시도한다. */
    public AccountMe fetchAccount(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(sessionScoped(HttpMethod.GET, userPath(PATH_ACCOUNT, userId), userId, sessionId,
                        generation).build(), deadline,
                new ParameterizedTypeReference<AccountMe>() { });
    }

    /**
     * 이름·고양이 색·메인 섬 변경 (GROMO-1801·1945·1971 · 계정 LLD §2.3). 앱 키를 그대로 Data 의 공개 명령 receipt 에 전달한다.
     * 온 필드만 싣는다 — {@code null} 은 「미변경」이라 본문에서 뺀다.
     */
    public AccountProfile patchAccount(UUID userId, UUID sessionId, long generation, String name, String catColor,
            UUID mainIslandId, UUID key, Deadline deadline) {
        Map<String, String> body = new LinkedHashMap<>();
        if (name != null) {
            body.put("name", name);
        }
        if (catColor != null) {
            body.put("catColor", catColor);
        }
        if (mainIslandId != null) {
            body.put("mainIslandId", mainIslandId.toString());
        }
        return http.exchange(sessionScoped(HttpMethod.PATCH, userPath(PATH_ACCOUNT, userId), userId, sessionId,
                        generation)
                        .idempotencyKey(key.toString())
                        .body(body)
                        .idempotentCommand()
                        .build(), deadline,
                new ParameterizedTypeReference<AccountProfile>() { });
    }

    /**
     * 탈퇴 (GROMO-1801 · 계정 LLD §2.5). 응답 유실 뒤 재시도는 이미 비활성이라 404 {@code USER_NOT_FOUND} 이고,
     * 앱은 그것을 탈퇴 확정으로 읽는다 — 그래서 재시도해도 안전하다.
     */
    public JsonNode deleteAccount(UUID userId, UUID sessionId, long generation, Deadline deadline) {
        return http.exchange(sessionScoped(HttpMethod.DELETE, userPath(PATH_ACCOUNT, userId), userId, sessionId,
                        generation)
                        .idempotentCommand()
                        .build(), deadline,
                new ParameterizedTypeReference<JsonNode>() { });
    }
}
