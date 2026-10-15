package com.oneorthree.business.api;

import com.oneorthree.business.auth.AccessTokenVerifier;
import com.oneorthree.business.auth.LoginAttemptCredentials;
import com.oneorthree.business.auth.SocialCredential;
import com.oneorthree.business.common.api.ApiErrorCode;
import com.oneorthree.business.common.api.PublicApiException;
import com.oneorthree.business.config.UpstreamConfigProperties;
import com.oneorthree.business.upstream.data.dto.LoginSession;
import com.oneorthree.business.usecase.AuthSessionUseCase;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 공개 소셜 로그인 — {@code POST /auth/sessions} (계정 LLD §2.1).
 *
 * <h2>AT 가 없어도 여기 닿는다</h2>
 * 최초 로그인에는 우리 AT 가 없다. {@code AccessTokenFilter} 가 이 raw method/path 에 한해 AT 생략을
 * 허용하고, <b>AT 를 보냈다면 평소처럼 검증한다</b> — LLD §2.1 의 「잘못된 AT 를 익명 로그인으로
 * 조용히 강등하지 않는다」가 그 규칙이다. 필터를 «푸는» 것이 아니라 이 경로만 «좁혀서» 통과시킨다.
 *
 * <h2>본문 검증을 손으로 하는 이유</h2>
 * {@code FocusSessionController} 와 같다 — 「정확히 이 필드만」과 「둘 중 하나만」은 Bean Validation
 * 으로 표현되지 않는다. 특히 <b>알 수 없는 필드를 400 으로 거부</b>해야 하는데(LLD §1), 타입 바인딩에
 * 맡기면 모르는 필드가 조용히 무시된다.
 */
@RestController
@RequiredArgsConstructor
public class AuthSessionController {

    private static final String FIELD_PROVIDER = "provider";
    private static final String FIELD_CODE = "authorizationCode";
    private static final String FIELD_CREDENTIAL = "credential";
    private static final String FIELD_TERMS = "termsVersion";
    /**
     * 기존 회원 계정으로의 전환 확정 (GROMO-1994 · 정책 「…사용자에게 전환 여부를 안내하고 명시적으로
     * 확인받는다」). 선택 필드이고 생략은 {@code false} 다 — 기존 요청 4필드를 바꾸지 않는
     * additive 확장이라, 이 값을 모르는 앱은 예전과 똑같이 409 로 거절된다.
     */
    private static final String FIELD_SWITCH_CONFIRMED = "accountSwitchConfirmed";
    private static final Set<String> ALLOWED_FIELDS =
            Set.of(FIELD_PROVIDER, FIELD_CODE, FIELD_CREDENTIAL, FIELD_TERMS, FIELD_SWITCH_CONFIRMED);
    private static final Set<String> CREDENTIAL_FIELDS = Set.of("type", "value");
    private static final int MAX_CREDENTIAL_LENGTH = 8192;
    private static final int MAX_TERMS_LENGTH = 64;

    private final AuthSessionUseCase sessions;
    private final AccessTokenVerifier verifier;
    private final UpstreamConfigProperties properties;

    /**
     * 수락 가능한 약관 버전 카탈로그 (정책 Q05 — <b>미결</b>).
     *
     * <p>LLD §2.1 은 「배포된 약관 버전 카탈로그의 실제 문서에 대응해야 하며, Q05 미입력 상태에서
     * 예시 날짜({@code "2026-09"})로 자동 허용하지 않는다」고 한다. 그래서 값을 코드에 박지 «않고»
     * 설정으로 받는다. 비어 있으면(현재 기본값) 형식만 보고 원문을 원장에 기록한다 — 예시 값을
     * 임의로 정본화하는 것보다, 카탈로그가 정해지면 <b>설정 한 줄로</b> 강제되는 쪽이 맞다.
     */
    @Value("${auth.terms.accepted-versions:}")
    private List<String> acceptedTermsVersions = List.of();

    @PostMapping(LoginAttemptCredentials.PATH)
    @ResponseStatus(HttpStatus.CREATED)
    public AuthSessionUseCase.Result login(HttpServletRequest request, HttpServletResponse response,
            @RequestBody JsonNode body) {
        // 필터 예외와 «같은» 판정을 다시 확인한다. 인코딩 변형으로 필터의 정확 일치는 비껴가고
        // MVC 라우팅에는 걸리는 경로가 있으면, 이 한 줄이 그 요청을 여기서 끊는다.
        if (!LoginAttemptCredentials.matches(request) || request.getQueryString() != null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        LoginAttemptCredentials credentials = LoginAttemptCredentials.from(request);
        // AT 를 실었다면 반드시 유효해야 한다. 여기서 접으면 폐기된 게스트의 AT 를 든 요청이
        // 「AT 없는 신규 로그인」으로 통과해, 막으려던 승격 우회가 그대로 열린다.
        if (credentials.accessToken() != null && verifier.verify(credentials.accessToken()).isEmpty()) {
            throw new PublicApiException(ApiErrorCode.UNAUTHORIZED, null);
        }

        SocialCredential credential = credentialOf(body);
        String termsVersion = termsVersionOf(body);

        LoginSession session = sessions.login(credentials, credential, termsVersion,
                accountSwitchConfirmedOf(body),
                properties.deadline());
        DeviceBootstrapHeader.set(response, session.deviceBootstrap());
        return AuthSessionUseCase.Result.of(session);
    }

    /**
     * 전환 확정 플래그 — 정확한 boolean 하나이거나 생략이다 (GROMO-1994).
     *
     * <p>{@code "true"} 문자열·{@code 1} 을 받아 주지 않는다. 여기 느슨함을 두면 「확정하지 않은
     * 사용자의 요청이 확정으로 읽혀 게스트 데이터가 파기되는」 경로가 생긴다 — 이 필드의 결말이
     * 되돌릴 수 없으므로 가장 좁게 읽는다.
     */
    private boolean accountSwitchConfirmedOf(JsonNode body) {
        JsonNode value = body.get(FIELD_SWITCH_CONFIRMED);
        if (value == null || value.isNull()) {
            return false;
        }
        if (!value.isBoolean()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_SWITCH_CONFIRMED);
        }
        return value.booleanValue();
    }

    private SocialCredential credentialOf(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, null);
        }
        body.propertyNames().forEach(name -> {
            if (!ALLOWED_FIELDS.contains(name)) {
                // 모르는 필드를 무시하면 오타 난 요청이 «성공» 한다 — 앱은 자기가 보낸 값이
                // 적용된 줄 알고, 서버는 그 값을 본 적이 없다.
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, name);
            }
        });

        String provider = text(body, FIELD_PROVIDER, 32);
        if (provider == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_PROVIDER);
        }
        // provider 누락/타입 오류(400 INVALID_REQUEST)와 「집합 밖 제공자」(400 UNSUPPORTED_PROVIDER)를
        // 가른다 — LLD §2.1 이 그 구분을 요구한다. 앱은 후자에만 「지원하지 않는 로그인」을 띄운다.
        if (!provider.equals(provider.toLowerCase(Locale.ROOT))
                || !SocialCredential.PROVIDERS.contains(provider)) {
            throw new PublicApiException(ApiErrorCode.UNSUPPORTED_PROVIDER, FIELD_PROVIDER);
        }

        boolean hasCode = body.has(FIELD_CODE);
        boolean hasCredential = body.has(FIELD_CREDENTIAL);
        if (hasCode == hasCredential) {
            // 둘 다이거나 둘 다 아님. LLD §2.1: 「타입 혼합·두 자격 동시 제출은 400 이다」.
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_CREDENTIAL);
        }

        String supported = SocialCredential.supportedKind(provider);
        if (hasCode) {
            // 실제 code 교환 어댑터가 없다. LLD §2.1: 「code 를 기존 JWT 검증 함수의 token 인자에
            // 넣는 것은 구현이 아니다」 — 넣으면 «검증을 통과한 척하는» 경로가 생긴다. 알려진
            // 제공자의 지원하지 않는 자격 종류라 422 이고, 400 UNSUPPORTED_PROVIDER 와 구분된다.
            text(body, FIELD_CODE, MAX_CREDENTIAL_LENGTH);
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, FIELD_CODE);
        }

        JsonNode credential = body.get(FIELD_CREDENTIAL);
        if (!credential.isObject()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_CREDENTIAL);
        }
        credential.propertyNames().forEach(name -> {
            if (!CREDENTIAL_FIELDS.contains(name)) {
                throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_CREDENTIAL + "." + name);
            }
        });
        String type = text(credential, "type", 32);
        String value = text(credential, "value", MAX_CREDENTIAL_LENGTH);
        if (type == null || value == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_CREDENTIAL);
        }
        if (!type.equals(supported)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, FIELD_CREDENTIAL + ".type");
        }
        return new SocialCredential(provider, type, value);
    }

    private String termsVersionOf(JsonNode body) {
        String termsVersion = text(body, FIELD_TERMS, MAX_TERMS_LENGTH);
        if (termsVersion == null) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, FIELD_TERMS);
        }
        if (!acceptedTermsVersions.isEmpty() && !acceptedTermsVersions.contains(termsVersion)) {
            throw new PublicApiException(ApiErrorCode.OUT_OF_RANGE, FIELD_TERMS);
        }
        return termsVersion;
    }

    /** 문자열 필드 하나. 없으면 null, 타입·길이가 어긋나면 400. */
    private String text(JsonNode owner, String field, int maxLength) {
        JsonNode node = owner.get(field);
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isString()) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        String value = node.stringValue();
        if (value.isBlank() || value.length() > maxLength || !value.equals(value.strip())) {
            throw new PublicApiException(ApiErrorCode.INVALID_REQUEST, field);
        }
        return value;
    }
}
