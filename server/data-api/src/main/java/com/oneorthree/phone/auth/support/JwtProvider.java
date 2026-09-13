package com.oneorthree.phone.auth.support;

import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.UUID;

/**
 * 자체 발급 JWT 의 생성·검증 담당. HS256 대칭키({@code jwt.secret}) 하나로 서명하며,
 * subject 에 userId, 커스텀 클레임으로 {@code type}(access/refresh)과 {@code guest} 를 싣는다.
 *
 * <p><b>토큰 타입 가드가 이 클래스의 핵심 계약이다.</b> access 와 refresh 는 같은 키로 서명되므로
 * 서명 검증({@link #isTokenValid})만으로는 둘을 구분하지 못한다 — 구분은 오직 {@code type} 클레임이고,
 * 그 판정은 호출부({@code JwtFilter}·{@code AuthService})의 몫이다. 이 클래스는 클레임을 그대로
 * 돌려줄 뿐 기본값을 채우지 않으며, 클레임이 없는 구 토큰에는 {@code null} 을 준다 —
 * 호출부가 fail-closed 로 거부하도록 남겨 둔 것이다.
 *
 * <p>검증 계열 중 예외를 삼키는 건 {@link #isTokenValid} 하나뿐이다. 나머지 extract 계열은
 * 서명·만료가 무효면 {@code JwtException} 을 그대로 전파하므로, 반드시 isTokenValid 통과 후에 부른다.
 */
@Component
public class JwtProvider {

    /** {@code type} 클레임이 이 값일 때만 {@code /api/*} 인증을 통과한다 — 짧은 수명(기본 1시간)의 API 호출용 토큰. */
    public static final String TYPE_ACCESS = "access";
    /** 재발급 전용 토큰의 {@code type} 값. 수명이 길어 API 인증에 쓰이면 access 만료 정책이 무력화되므로, 갱신 엔드포인트 밖에서는 반드시 거부해야 한다. */
    public static final String TYPE_REFRESH = "refresh";

    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_GUEST = "guest";

    /**
     * 유저 축 세대 (A22 ㊽ · ㊍) — <b>additive</b> 다. 구 토큰에는 없고, 없으면 없는 채로 흘린다.
     *
     * <p>앱이 로그인과 무관한 시점에 {@code PUT device-token}·{@code onTokenRefresh} 를 부르므로
     * (㊽), 로그인 응답으로만 세대를 전달하면 그 호출들이 세대를 모른다. 그래서 AT claim 으로 나른다.
     */
    private static final String CLAIM_GENERATION = "gen";

    /**
     * 세션 축 식별자 — <b>additive</b> 다. 개별 기기 로그아웃이 「어느 세션인가」를 가리키는 값이고,
     * 유저 축 세대(㊼)와 <b>다른 축</b>이다.
     */
    private static final String CLAIM_SESSION_ID = "sid";

    private final SecretKey secretKey;
    private final long accessExpiration;
    private final long refreshExpiration;
    private final long guestRefreshExpiration;

    /**
     * 설정값에서 서명키와 수명 세 가지를 받아 조립한다.
     *
     * @param secret HMAC-SHA 서명키 원문. 비어 있으면 서명 없는 토큰이 통과하는 사태를 막으려
     *               부팅을 실패시킨다(런타임에 발견하면 이미 늦다). 길이가 알고리즘 최소치에
     *               못 미치면 {@code Keys.hmacShaKeyFor} 가 거부한다
     * @param accessExpiration access 토큰 수명(초)
     * @param refreshExpiration 소셜 계정 refresh 토큰 수명(초)
     * @param guestRefreshExpiration 게스트 refresh 토큰 수명(초). 게스트는 만료 시 돌아갈 계정이
     *                               없어 만료가 곧 계정 소실이므로 별도로 길게 잡는다
     */
    public JwtProvider(
            @Value("${jwt.secret}") String secret,
            @Value("${jwt.access-expiration}") long accessExpiration,
            @Value("${jwt.refresh-expiration}") long refreshExpiration,
            @Value("${jwt.guest-refresh-expiration}") long guestRefreshExpiration
    ) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("jwt.secret 미설정");
        }

        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessExpiration = accessExpiration;
        this.refreshExpiration = refreshExpiration;
        this.guestRefreshExpiration = guestRefreshExpiration;
    }

    /**
     * isGuest 는 **발급 시점**의 유저 상태다 (GROMO-1229) — 게스트 로그인 경로만 true 를 싣고,
     * 소셜 로그인·승격 직후·리프레시 재발급은 그 시점 유저 상태(비게스트면 false)를 싣는다.
     *
     * @param userId subject 에 실릴 유저 PK
     * @param isGuest 발급 시점의 게스트 여부. 이후 승격해도 <b>이미 발급된 토큰의 값은 바뀌지 않으므로</b>,
     *                권한 판정의 근거로 쓰면 승격 전 토큰이 만료될 때까지 옛 상태가 남는다
     * @return {@code type=access} 클레임이 실린 서명 완료 토큰. 이 값만이 {@code /api/*} 를 통과한다
     */
    public String generateAccessToken(UUID userId, boolean isGuest) {
        return buildToken(userId, accessExpiration, TYPE_ACCESS, isGuest, null, null);
    }

    /**
     * 세대·세션이 실린 access 토큰 (A22 ㊽ · ㋞) — <b>additive</b> 추가다.
     *
     * <p>두 claim 은 <b>수신 측이 롤아웃 단계에 따라</b> 쓴다. 지금 발급된 토큰에만 들어 있고 구
     * 토큰에는 없으므로, 배포 직후 최대 AT 수명(기본 3600초) 동안은 두 값이 없는 요청이 정상적으로
     * 섞여 든다(㊍). <b>그때 수신 측이 「없으니 현재 값으로 채우자」를 하면 안 된다</b> — 로그아웃
     * 전에 발급된 옛 AT 가 최신 세대로 태깅돼 기기 토큰 tombstone 을 우회한다.
     *
     * @param userId         subject
     * @param isGuest        발급 시점 게스트 여부
     * @param authGeneration 그 시점 유저 축 세대
     * @param sessionId      이 토큰이 속한 로그인 세션
     * @return {@code gen}·{@code sid} 가 더해진 access 토큰
     */
    public String generateAccessToken(UUID userId, boolean isGuest, long authGeneration, UUID sessionId) {
        return buildToken(userId, accessExpiration, TYPE_ACCESS, isGuest, authGeneration, sessionId);
    }

    /**
     * refresh 토큰 발급 — 게스트만 수명을 길게 잡는다 (GROMO-1509).
     *
     * <p>소셜 계정은 만료돼도 재로그인으로 <b>같은 계정</b>에 돌아오지만, 게스트는 돌아갈 곳이 없다
     * ({@code guestLogin} 은 언제나 새 User 를 만든다). 게스트에게 만료는 곧 계정 소실이라
     * 미접속 허용 기간을 따로 둔다.
     *
     * @param userId subject 에 실릴 유저 PK
     * @param isGuest true 면 {@code jwt.guest-refresh-expiration}, false 면 {@code jwt.refresh-expiration}
     *                을 수명으로 쓴다 — 값 하나가 게스트의 계정 보존 기간을 정한다
     * @return {@code type=refresh} 클레임이 실린 서명 완료 토큰. 갱신 엔드포인트 전용이며
     *         {@code /api/*} 인증에는 쓰일 수 없다
     */
    public String generateRefreshToken(UUID userId, boolean isGuest) {
        return buildToken(userId, refreshTtlSeconds(isGuest), TYPE_REFRESH, isGuest, null, null);
    }

    /**
     * 토큰 만료 시각. 서명·만료가 무효면 JwtException 이 전파된다(extractType 과 같은 규율).
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return {@code exp} 클레임 시각. {@link #isRefreshRotationDue} 의 입력으로 쓰인다
     */
    public Date extractExpiration(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getExpiration();
    }

    /**
     * refresh 토큰을 지금 갈아끼워야 하는지 — 남은 수명이 발급 수명의 <b>절반 미만</b>이면 true.
     *
     * <p>매 갱신마다 회전시키지 않는다. 회전 1회는 "서버는 새 해시를 커밋했는데 응답이 유실돼
     * 클라이언트가 무효해진 옛 토큰을 든 채 남는" 창을 연다 — 그 창에 걸리면 강제 로그아웃이고,
     * 게스트에겐 그게 계정 소실이다. access 가 1시간이라 매 갱신마다 회전하면 한 달에 700번 넘게
     * 그 창이 열리는데, 절반 기준이면 수명당 1~2회로 줄어든다.
     *
     * <p>기준 수명은 <b>현재</b> 유저 상태로 정한다 — 게스트가 승격하면 다음 회전 때 소셜 수명의
     * 토큰으로 자연히 갈아탄다.
     *
     * @param expiration 현재 쥔 refresh 토큰의 만료 시각 — {@link #extractExpiration} 결과
     * @param isGuest <b>현재</b> 유저 상태(발급 시점이 아니다). 기준 수명이 여기서 갈리므로,
     *                승격한 유저에게 게스트 수명을 넘기면 회전 판정이 느슨해진다
     * @return true = 지금 새 refresh 토큰으로 갈아끼울 때, false = 쥔 토큰을 그대로 유지
     */
    public boolean isRefreshRotationDue(Date expiration, boolean isGuest) {
        long remainingSeconds = (expiration.getTime() - System.currentTimeMillis()) / 1000;
        return remainingSeconds < refreshTtlSeconds(isGuest) / 2;
    }

    private long refreshTtlSeconds(boolean isGuest) {
        return isGuest ? guestRefreshExpiration : refreshExpiration;
    }

    /**
     * 토큰의 type 클레임을 반환한다 (GROMO-714).
     *
     * <p>클레임이 없는 구 토큰은 {@code null} 을 반환한다 — 호출부(JwtFilter·AuthService)가 이를 거부하는
     * fail-closed 전제이므로 여기서 기본값을 채우지 않는다. 서명·만료가 무효면 JwtException 이 전파되므로
     * 호출부는 isTokenValid 통과 후에 호출한다.
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return {@link #TYPE_ACCESS} / {@link #TYPE_REFRESH}, 또는 클레임이 없는 구 토큰이면 {@code null}.
     *         비교는 반드시 상수 쪽에서 시작해야 null 이 NPE 없이 거부된다
     */
    public String extractType(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_TYPE, String.class);
    }

    /**
     * 토큰의 guest 클레임(발급 시점 게스트 여부)을 반환한다 (GROMO-1229).
     *
     * <p>클레임이 없는 구 토큰은 {@code null} 을 반환한다 — type 클레임의 "구 토큰 null" 처리와 동형이되,
     * 호출부(AuthService)는 null 을 <b>비게스트로 간주</b>해 현행 동작을 유지한다(점진 적용, D3).
     * 서명·만료가 무효면 JwtException 이 전파되므로 호출부는 isTokenValid 통과 후에 호출한다.
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return 발급 시점 게스트 여부, 클레임이 없는 구 토큰이면 {@code null}(호출부가 비게스트로 간주).
     *         박싱 타입인 건 "미상"을 표현하기 위한 것이라 그대로 언박싱하면 NPE 다
     */
    public Boolean extractIsGuest(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_GUEST, Boolean.class);
    }

    /**
     * subject 클레임에서 유저 PK 를 꺼낸다.
     *
     * <p>이 값은 <b>토큰이 access 타입인지까지는 보증하지 않는다</b> — 서명만 맞으면 refresh 토큰에서도
     * 같은 userId 가 나온다. 타입 판정은 호출부가 {@link #extractType} 으로 따로 해야 한다.
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return 토큰이 가리키는 유저 PK. 서명·만료가 무효면 {@code JwtException},
     *         subject 가 UUID 형식이 아니면 {@code IllegalArgumentException} 이 전파된다
     */
    public UUID extractUserId(String token) {

        String subject = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .getSubject();

        return UUID.fromString(subject);
    }

    /**
     * 서명과 만료만 본다 — 이 클래스에서 예외를 삼키는 유일한 메서드라 extract 계열의 선행 관문 역할을 한다.
     *
     * <p><b>통과했다고 인증된 것이 아니다.</b> 여기서 true 인 토큰에는 refresh 토큰과
     * 탈퇴한 유저의 access 토큰이 모두 포함된다. 실제 인증은 {@code JwtFilter} 가
     * 타입 가드와 소프트딜리트 조회를 더해 완성한다.
     *
     * @param token 검사할 토큰 문자열. {@code null}·빈 문자열·형식 파손도 예외 없이 false 로 흡수된다
     * @return true = 우리 키로 서명됐고 아직 만료 전, false = 그 밖의 모든 경우
     */
    public boolean isTokenValid(String token) {
        try {
            Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }

    /**
     * {@code gen} claim (A22 ㊍) — <b>없으면 {@code null} 이고, 그 null 을 채우면 안 된다</b>.
     *
     * <p>숫자가 아닌 값이 들어와도 토큰 전체를 거절하지 않는다 — 그러면 claim 타입 변경이 정상 세션의
     * 전면 401 이 된다. 「세대를 모른다」로 접고, 필수화 단계의 판정은 수신 측이 한다.
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return 발급 시점 세대, 클레임이 없는 구 토큰이면 {@code null}
     */
    public Long extractAuthGeneration(String token) {
        Number generation = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_GENERATION, Number.class);
        return generation == null ? null : generation.longValue();
    }

    /**
     * {@code sid} claim (A22 ㋞) — 없으면 {@code null}.
     *
     * @param token 서명 검증을 이미 통과한 토큰 문자열
     * @return 이 토큰이 속한 세션, 클레임이 없는 구 토큰이면 {@code null}
     */
    public UUID extractSessionId(String token) {
        String sessionId = Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload()
                .get(CLAIM_SESSION_ID, String.class);
        return sessionId == null ? null : UUID.fromString(sessionId);
    }

    private String buildToken(UUID userId, long expirationSeconds, String type, boolean isGuest,
            Long authGeneration, UUID sessionId) {
        Date now = new Date();
        var builder = Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TYPE, type)
                .claim(CLAIM_GUEST, isGuest);
        // JWT 시각은 초 단위다. 같은 초의 로그인·구 RT 승격도 별도 세션 자격이어야 한다.
        if (TYPE_REFRESH.equals(type)) {
            builder = builder.id(UUID.randomUUID().toString());
        }
        // null 을 claim 으로 «싣지 않는다». 실어 두면 수신 측의 「있음/없음」 판정이 값의 null 검사로
        // 바뀌어, 롤아웃 단계 판정이 두 갈래로 갈린다.
        if (authGeneration != null) {
            builder = builder.claim(CLAIM_GENERATION, authGeneration);
        }
        if (sessionId != null) {
            builder = builder.claim(CLAIM_SESSION_ID, sessionId.toString());
        }
        return builder
                .issuedAt(now)
                .expiration(new Date(now.getTime() + expirationSeconds * 1000))
                .signWith(secretKey)
                .compact();
    }
}
