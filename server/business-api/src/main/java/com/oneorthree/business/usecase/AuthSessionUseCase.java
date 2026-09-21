package com.oneorthree.business.usecase;

import com.oneorthree.business.auth.CredentialDigest;
import com.oneorthree.business.auth.LoginAttemptCredentials;
import com.oneorthree.business.auth.SocialCredential;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.exception.UpstreamDomainException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataApiClient;
import com.oneorthree.business.upstream.data.dto.LoginAttemptLookup;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 소셜 로그인 세션 발급 (GROMO-1908, 계정 LLD §2.1 · §3).
 *
 * <h2>두 단계인 이유</h2>
 * LLD §3 은 「제공자 교환 <b>전에</b> 내구 시도를 먼저 조회한다」이고, 저장된 결과가 있는 분기의
 * 「IdP 교환 횟수는 0」이다. 그래서 조회와 교환이 서로 다른 상류 표면이다 — 하나로 합쳐 Data 안에서
 * 분기하면 「정말 다시 안 불렀는가」를 밖에서 확인할 수 없고, 회귀가 조용히 들어온다. 나눠 두면
 * <b>호출 횟수 자체가 계약의 증거</b>가 되고, 계약 테스트가 그 숫자를 센다.
 *
 * <h2>digest 는 여기서 계산한다</h2>
 * 앱이 보낸 digest 를 받지 않는다(LLD §3). 매 요청이 실제 원 code/credential 을 제시하고, Business 가
 * 자기 비밀로 계산한다 — 그래야 그 값이 「원 자격을 들고 있다」의 증거가 된다.
 */
@Service
@RequiredArgsConstructor
public class AuthSessionUseCase {

    /**
     * 상류 도메인 코드 → 공개 코드·field.
     *
     * <p>{@code GlobalExceptionHandler} 의 자동 매핑({@code ApiErrorCode.valueOf})에 맡기지 않는
     * 것들만 적는다. 자동 매핑은 이름이 같아야 붙는데, Data 의 로그인 원장 코드는 공개 계약의
     * 이름과 다르다 — 내부 사정을 드러내는 이름을 공개 코드로 그대로 내보내지 않기 위해서다.
     */
    private static final Map<String, PublicFailure> DOMAIN_FAILURES = Map.of(
            // 같은 키에 «다른 자격». LLD §3 의 409 IDEMPOTENCY_KEY_REUSED 이고 field 는 범용
            // 명령 키가 아니라 X-Login-Attempt-Id 다(§3 이 그 구분을 명시한다).
            "IDEMPOTENCY_KEY_CONFLICT",
            new PublicFailure(ApiErrorCode.IDEMPOTENCY_KEY_REUSED, LoginAttemptCredentials.ATTEMPT_HEADER),
            // 같은 키·같은 자격인데 다른 실행자가 진행 중. retryable=true 라 봉투에 Retry-After: 1 이 붙는다.
            "LOGIN_ATTEMPT_IN_PROGRESS",
            new PublicFailure(ApiErrorCode.REQUEST_IN_PROGRESS, LoginAttemptCredentials.ATTEMPT_HEADER),
            // 복구 창 종료·폐기·digest 키 교체. 답은 하나 — 새 제공자 인증.
            "LOGIN_ATTEMPT_UNUSABLE", new PublicFailure(ApiErrorCode.UNAUTHORIZED, null));

    private final DataApiClient data;
    private final CredentialDigest digests;

    public LoginSession login(LoginAttemptCredentials credentials, SocialCredential credential,
            String termsVersion, Deadline deadline) {

        String keyId = digests.keyId();
        String digest = digests.of(credential);

        LoginAttemptLookup stored =
                relay(() -> data.lookupLoginAttempt(credentials.attemptId(), keyId, digest, deadline));
        if (stored == null) {
            throw new UpstreamContractMismatchException("Data 로그인 시도 조회 응답이 비어 있다");
        }
        if (stored.replayable()) {
            // 저장된 결과가 있다 — 여기서 끝난다. 교환 표면을 «부르지 않는다».
            return verified(stored.session());
        }

        return verified(relay(() -> data.executeLoginAttempt(
                new DataApiClient.LoginAttemptCommand(
                        credentials.attemptId(), keyId, digest, credential.providerEnumName(),
                        credential.kind(), credential.value(), termsVersion, credentials.accessToken()),
                deadline)));
    }

    /**
     * 네 필드가 모두 성립하는지 확인한다 (LLD §2.1 「토큰은 null 이 아니다」).
     *
     * <p>상류 계약 위반을 null 로 접어 200 을 주면 앱은 토큰 없는 성공을 받아 로그인한 줄 알고
     * 다음 요청에서 401 을 맞는다 — 원인이 로그인이라는 사실이 그 시점엔 보이지 않는다. 502 로
     * 올려 배선 문제임을 드러낸다.
     */
    private LoginSession verified(LoginSession session) {
        if (session == null || session.accessToken() == null || session.accessToken().isBlank()
                || session.refreshToken() == null || session.refreshToken().isBlank()
                || session.userId() == null) {
            throw new UpstreamContractMismatchException("Data 로그인 결과 계약 불일치");
        }
        return session;
    }

    private <T> T relay(Supplier<T> call) {
        try {
            return call.get();
        } catch (UpstreamDomainException e) {
            throw mapped(e);
        }
    }

    /**
     * 등록된 상류 실패만 공개 코드로 바꾼다.
     *
     * <p><b>status 까지 같아야 한다.</b> 상류가 같은 코드의 상태를 바꾸면 그건 계약 변경이고, 그때
     * 조용히 옛 매핑을 적용하면 앱이 «틀린 상태»로 분기한다. 어긋나면 매핑을 포기해 502
     * {@code UPSTREAM_CONTRACT_ERROR} 로 올린다({@code FocusSessionUseCase} 와 같은 규율).
     *
     * <p>여기 없는 코드는 그대로 흘려보낸다 — 제공자 6종의 {@code *_TOKEN} 401 처럼 공개 계약과
     * 이름이 같은 것들은 {@code GlobalExceptionHandler} 가 이름으로 매핑한다.
     */
    private RuntimeException mapped(UpstreamDomainException error) {
        // 선택 AT 의 세션이 폐기됐다(계정 LLD §2.1 「선택 AT의 세션 폐기 관문」). Data 는 서비스 자격
        // 거부(401)와 «구분되는» 403 으로 알리고, 공개 계약에는 403 이 없으므로 401 로 낸다 — 앱의
        // 답은 재로그인이다. AccountSettingsUseCase·IslandHostTransferUseCase 와 같은 매핑.
        if (error.getStatus() == 403 && "SESSION_NOT_ACTIVE".equals(error.getCode())) {
            return new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
        }
        PublicFailure failure = DOMAIN_FAILURES.get(error.getCode());
        if (failure == null || failure.code().getStatus().value() != error.getStatus()) {
            return error;
        }
        return new PublicApiException(failure.code(), failure.field());
    }

    private record PublicFailure(ApiErrorCode code, String field) {
    }

    /**
     * 응답 DTO — 공개 201 의 네 필드. 상류가 함께 준 {@code deviceBootstrap} 은 <b>여기 없다</b>:
     * 계정 LLD §2.1 이 그 값을 {@code X-Device-Bootstrap} 헤더로 보내라고 했고 본문 4필드는 고정이다.
     * 헤더를 싣는 일은 컨트롤러의 {@code DeviceBootstrapHeader} 가 한다(GROMO-2037).
     */
    public record Result(String accessToken, String refreshToken, UUID userId, boolean onboardingComplete) {

        public static Result of(LoginSession session) {
            return new Result(session.accessToken(), session.refreshToken(),
                    session.userId(), session.onboardingComplete());
        }
    }
}
