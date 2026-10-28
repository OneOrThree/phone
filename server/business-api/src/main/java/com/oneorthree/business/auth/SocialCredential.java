package com.oneorthree.business.auth;

import java.util.Locale;
import java.util.Set;

/**
 * 제공자 자격 한 건 — 요청 본문에서 검증해 꺼낸 값 (계정 LLD §2.1).
 *
 * <p>{@code value} 는 제공자가 준 원문이다. <b>어디에도 저장하지 않고</b> Data 로 한 번 흘려보내며,
 * 원장에 남는 것은 {@link CredentialDigest} 가 계산한 keyed digest 뿐이다.
 *
 * @param provider 소문자 제공자 이름
 * @param kind     {@link #KIND_ID_TOKEN} · {@link #KIND_ACCESS_TOKEN} · {@link #KIND_CODE}
 * @param value    제공자 원 자격
 */
public record SocialCredential(String provider, String kind, String value) {

    public static final String KIND_ID_TOKEN = "id_token";
    public static final String KIND_ACCESS_TOKEN = "access_token";
    public static final String KIND_CODE = "authorization_code";

    /**
     * 지원 제공자 6종 (정책 A04 「기존 6개 소셜 제공자를 보존한다」).
     *
     * <p>이 집합 밖은 400 {@code UNSUPPORTED_PROVIDER} 다. 알려진 제공자의 «지원하지 않는
     * credential 종류»(422 {@code OUT_OF_RANGE})와 갈린다 — 정책 A18 이 그 구분을 요구한다.
     */
    public static final Set<String> PROVIDERS =
            Set.of("apple", "google", "kakao", "line", "instagram", "facebook");

    /**
     * 제공자별로 <b>현재 어댑터가 실제로 검증하는</b> credential 종류.
     *
     * <p>LLD §2.1 의 표 그대로다. {@code authorizationCode} 교환 어댑터는 아직 없다 — 「code 를
     * 기존 JWT 검증 함수의 token 인자에 넣는 것은 구현이 아니다」(LLD §2.1)라 <b>넣지 않는다</b>.
     * 넣으면 검증을 통과한 척하는 경로가 생기고, 그건 인증이 아니라 인증의 모양이다.
     */
    public static String supportedKind(String provider) {
        return switch (provider) {
            case "apple", "google", "facebook" -> KIND_ID_TOKEN;
            case "kakao", "line", "instagram" -> KIND_ACCESS_TOKEN;
            default -> null;
        };
    }

    /** {@code AuthService} 의 {@code Provider} enum 이름. */
    public String providerEnumName() {
        return provider.toUpperCase(Locale.ROOT);
    }

    /** 원 자격이 로그·오류 덤프로 새지 않게 한다. */
    @Override
    public String toString() {
        return "SocialCredential[provider=" + provider + ", kind=" + kind + ", value=redacted]";
    }
}
