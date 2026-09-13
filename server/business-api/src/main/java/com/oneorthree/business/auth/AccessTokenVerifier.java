package com.oneorthree.business.auth;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.RequiredTypeException;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import com.oneorthree.business.common.http.RequiredConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Optional;
import java.util.UUID;

/**
 * access token 을 로컬에서 검증한다 — <b>서명 · 만료(<code>exp</code> 존재 + 미경과) ·
 * {@code type} 클레임 · subject 존재 + UUID 형식</b> 다섯 가지.
 *
 * <p><b>전환 기간에는 검증만 한다.</b> A7 의 최종 그림에서는 이 서비스가 AT 서명 주체가 되지만,
 * legacy issuer(Data API {@code AuthService})가 아직 발급 중이므로 지금은 같은 {@code jwt.secret}
 * 으로 확인만 한다. 발급 메서드를 여기 더하면 서명 주체가 둘이 되어 「어느 서버가 발급했는가」를
 * 아무도 답할 수 없게 된다 — 1661 에서 발급을 옮길 때 이 클래스 한 곳만 바뀌도록 가둬 뒀다.
 *
 * <p><b>type 가드가 핵심 계약이다.</b> access 와 refresh 는 같은 키로 서명되므로 서명 검증만으로는
 * 구분되지 않는다. refresh(수명 30일, 게스트는 그보다 길다)로 위성 쓰기에 닿을 수 있게 되면 AT 1시간
 * 만료 정책이 통째로 무력화된다. 비교를 상수 쪽에서 시작해 클레임이 없는 구 토큰({@code null})도
 * NPE 없이 거절된다(fail-closed).
 *
 * <p><b>{@code gen} 은 없을 수 있고, 없으면 없는 채로 흘린다.</b> 현 {@code JwtProvider} 의 AT 에는
 * {@code gen} 이 없어(§4 · A22 ㊍) 배포 직후 최대 AT 수명 동안 구 토큰이 정상 사용된다. 그때 Data 의
 * 현재 세대를 대신 채우면 로그아웃 전에 발급된 옛 AT 가 최신 세대로 태깅돼 <b>기기 토큰 tombstone 을
 * 우회</b>한다. 그래서 이 클래스는 결코 값을 만들지 않는다 — {@code null} 을 그대로 돌려준다.
 */
@Slf4j
@Component
public class AccessTokenVerifier {

    /** 이 값을 가진 토큰만 통과한다. Data API 의 {@code JwtProvider.TYPE_ACCESS} 와 같은 문자열이다. */
    public static final String TYPE_ACCESS = "access";

    private static final String CLAIM_TYPE = "type";
    private static final String CLAIM_GUEST = "guest";
    private static final String CLAIM_GENERATION = "gen";
    private static final String CLAIM_SESSION = "sid";

    private final SecretKey secretKey;

    /**
     * @param secret HMAC-SHA 서명키 원문. 비어 있으면 부팅을 실패시킨다 — 런타임에 발견하면 그때는 이미
     *               서명 검증 없이 뜬 진입점이 돌고 있다. legacy issuer 와 <b>같은 값</b>이어야 하며,
     *               길이가 HS256 최소치(32바이트)에 못 미치면 {@code Keys.hmacShaKeyFor} 가 거부한다
     */
    public AccessTokenVerifier(@Value("${jwt.secret}") String secret) {
        // 치환되지 않은 플레이스홀더도 거절한다 — 그 리터럴은 32바이트를 넘어 HS256 키로 «성립»하므로,
        // 막지 않으면 legacy issuer 와 다른 키로 조용히 떠서 모든 AT 가 401 이 된다.
        String resolved = RequiredConfig.require(secret, "jwt.secret");
        this.secretKey = Keys.hmacShaKeyFor(resolved.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * 토큰에서 요청자 신원을 꺼낸다 — 다섯 검증이 모두 통과할 때만.
     *
     * <p><b>{@code exp} 와 {@code subject} 는 있어야 한다.</b> 둘 다 JWT 스펙상 선택 필드라 파서가
     * 통과시키지만, exp 없는 토큰은 영구 유효 AT 가 되고 subject 없는 토큰은 {@code UUID.fromString}
     * 에서 NPE 로 500 이 된다. 이 서비스는 둘 다 거절한다(구 {@code JwtValidator} 와 같은 강도).
     *
     * <p>실패를 예외로 올리지 않고 {@code Optional.empty()} 로 접는 이유는 호출부가 전부 같은 방식으로
     * 다루기 때문이다 — 401 거절. 구분해서 다룰 곳이 없는 예외를 타입으로 남기면 호출부마다 catch 를
     * 복붙하게 되고, 그중 하나가 빠지면 그 경로만 500 이 된다.
     *
     * @param token {@code Bearer } 접두를 <b>이미 떼어낸</b> 토큰 문자열. null 이면 빈 값을 돌려준다
     * @return 유효한 access 토큰이면 클레임, 그 밖에는 전부 empty
     */
    public Optional<AccessTokenClaims> verify(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();

            // 상수를 왼쪽에 둔다 — type 클레임이 없는 구 토큰은 null 이고, 그때도 NPE 없이 false 가 된다.
            if (!TYPE_ACCESS.equals(claims.get(CLAIM_TYPE, String.class))) {
                return Optional.empty();
            }
            // ⚠️ exp 는 JWT 스펙상 «선택» 필드다. 파서는 exp 가 없는 토큰을 「만료되지 않았다」로 통과시키므로,
            //    여기서 막지 않으면 서명만 맞으면 «영구히 유효한» AT 가 성립한다 — AT 1시간 만료 정책이
            //    통째로 무력화되고 로그아웃·탈퇴 후에도 그 토큰이 계속 먹는다.
            if (claims.getExpiration() == null) {
                log.debug("AT 검증 실패 — exp 클레임 없음");
                return Optional.empty();
            }
            // subject 가 null 이면 UUID.fromString 이 IllegalArgumentException 이 아니라 «NPE» 를 던진다.
            // 아래 catch 는 NPE 를 잡지 않으므로 그대로 새어나가 401 이 아니라 500 이 된다.
            if (claims.getSubject() == null) {
                log.debug("AT 검증 실패 — subject 없음");
                return Optional.empty();
            }
            UUID userId = UUID.fromString(claims.getSubject());
            return Optional.of(
                    new AccessTokenClaims(userId, guestOf(claims), generationOf(claims), sessionOf(claims)));
        } catch (JwtException | IllegalArgumentException e) {
            // 서명 불일치·만료·subject 가 UUID 가 아님. 어느 쪽이든 결론은 같아서 구분하지 않는다.
            // 토큰 문자열 자체는 절대 로그에 남기지 않는다 — 로그 수집기로 흘러가면 그게 곧 자격증명 유출이다.
            log.debug("AT 검증 실패 — {}", e.getClass().getSimpleName());
            return Optional.empty();
        }
    }

    /** {@code guest} 클레임이 없는 구 토큰은 false 로 본다 — 게스트 제약을 «더 느슨하게» 열지 않는다. */
    private boolean guestOf(Claims claims) {
        Boolean guest = claims.get(CLAIM_GUEST, Boolean.class);
        return Boolean.TRUE.equals(guest);
    }

    /**
     * {@code sid} 클레임 — 이 AT 가 속한 로그인 세션. <b>없으면 null 이고, 만들지 않는다</b>.
     *
     * <p>{@code gen} 과 같은 이유로 토큰 전체를 거절하지는 않는다. 「세션을 모른다」로 접으면 세션 확인을
     * 건너뛴 채 롤아웃 단계의 판정으로 내려가고, 「현재 세션」으로 채우면 이미 로그아웃된 AT 가 살아 있는
     * 세션의 것처럼 통과한다 — 그건 바로 이 클레임으로 막으려는 것이다.
     */
    private UUID sessionOf(Claims claims) {
        try {
            String sid = claims.get(CLAIM_SESSION, String.class);
            return sid == null ? null : UUID.fromString(sid);
        } catch (RequiredTypeException | IllegalArgumentException e) {
            log.debug("sid 클레임 형식 불일치 — 세션 없음으로 처리");
            return null;
        }
    }

    /**
     * {@code gen} 클레임. <b>없으면 null 이고, 그 null 을 채우지 않는다</b>(A22 ㊍).
     *
     * <p>숫자가 아닌 값이 들어와도 토큰 전체를 거절하지는 않는다 — 그러면 클레임 타입 변경이 정상 세션의
     * 전면 401 이 된다. 「세대를 모른다」로 접고, 필수화 단계의 판정은 수신 측이 한다.
     */
    private Long generationOf(Claims claims) {
        try {
            Number gen = claims.get(CLAIM_GENERATION, Number.class);
            return gen == null ? null : gen.longValue();
        } catch (RequiredTypeException e) {
            log.debug("gen 클레임 타입 불일치 — 세대 없음으로 처리");
            return null;
        }
    }
}
