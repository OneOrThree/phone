package com.oneorthree.business.auth;

import com.oneorthree.business.common.http.RequiredConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;

/**
 * 제공자 자격의 <b>keyed</b> digest (계정 LLD §3 「자격 digest」).
 *
 * <h2>왜 keyed 인가</h2>
 * 이 값은 「같은 시도를 재개하려는 사람이 <b>원 자격을 실제로 들고 있는가</b>」의 증거다. 평범한
 * SHA-256 이면 자격을 아는 사람뿐 아니라 <b>원장을 읽은 사람</b>도 같은 값을 만들 수 있고, 그러면
 * 저장된 digest 하나로 남의 로그인 결과를 재생받는다. 비밀이 섞여 있어야 증거가 된다.
 *
 * <h2>앱이 보낸 digest 를 자격으로 받지 않는다</h2>
 * LLD §3: 「앱이 제출한 digest 를 자격으로 수락하지 않는다」. 그래서 이 계산은 언제나 서버가 원
 * code/credential 로 직접 한다 — 앱에서 받은 값을 그대로 대조하면 위 증거가 증거이기를 그만둔다.
 *
 * <h2>key id 를 비밀에서 «파생» 한다</h2>
 * 별도 설정으로 두면 비밀만 바꾸고 id 를 그대로 두는 사고가 가능하고, 그러면 원장의 옛 attempt 가
 * 「같은 키인데 digest 가 다르다」로 보여 <b>정상 사용자가 409 로 막힌다</b> — LLD §3 이 명시적으로
 * 금지한 오판이다. 파생하면 비밀이 바뀌는 순간 id 도 바뀌어, 그 attempt 는 409 가 아니라 「키가
 * 달라 재현할 수 없다」(401, 새 인증 요구)로 정확히 분류된다. 어긋날 방법이 없다.
 *
 * <p>id 는 비밀의 해시가 아니라 <b>도메인 분리된 HMAC</b> 이다 — 비밀 자체의 해시를 내보내지 않기
 * 위해서다.
 */
@Component
public class CredentialDigest {

    private static final String ALGORITHM = "HmacSHA256";

    /**
     * 필드 구분자 NUL — 제공자 토큰에 나타나지 않는 문자다.
     *
     * <p>구분자가 없으면 {@code ("ab","c")} 와 {@code ("a","bc")} 가 같은 입력이 되어 서로 다른
     * 자격이 같은 digest 를 갖는다. 값에 나타날 <b>수 있는</b> 구분자(공백·콜론)를 쓰면 같은 충돌을
     * 자격 문자열 쪽에서 만들어 낼 수 있다. Data 의 {@code SHA-256(userId + NUL + key)} 와 같은 규율.
     */
    private static final char SEPARATOR = '\0';

    private static final int KEY_ID_LENGTH = 16;

    private final SecretKeySpec key;
    private final String keyId;

    /**
     * @param secret digest 전용 비밀. <b>JWT 서명키·bootstrap HMAC 키와 분리한다</b>(LLD §3) —
     *               한 키가 세 용도를 겸하면 한쪽의 수명 정책(로그인 복구 창 5분)이 다른 쪽
     *               (발급 토큰의 최대 만료)을 끌어내려 멀쩡한 세션이 끊긴다
     */
    public CredentialDigest(@Value("${auth.login-attempt.digest-secret:}") String secret) {
        // 값이 없으면 «부팅을 실패시킨다». 이 서비스의 기존 규율 그대로다(AccessTokenVerifier 의
        // jwt.secret, InternalHttpClient 의 service-token). 기능을 조용히 끄는 대안은 더 나쁘다 —
        // 비밀 없는 digest 는 위 「증거」 성질을 잃은 채 로그인이 «정상 동작하는 것처럼» 보이고,
        // 그 상태가 운영에 떠 있는 동안 원장을 읽은 사람이 남의 세션을 재생받는다. 부팅 실패는
        // 배포 즉시 드러나지만, 조용한 비활성은 사고가 난 뒤에야 드러난다.
        String resolved = RequiredConfig.require(secret, "auth.login-attempt.digest-secret");
        this.key = new SecretKeySpec(resolved.getBytes(StandardCharsets.UTF_8), ALGORITHM);
        this.keyId = hex(mac("key-id" + SEPARATOR + "gromo-1908")).substring(0, KEY_ID_LENGTH);
    }

    /** 원장에 고정되는 키 식별자. 비밀이 바뀌면 함께 바뀐다. */
    public String keyId() {
        return keyId;
    }

    /**
     * provider · credential 종류 · 원 자격을 한 값으로 묶는다.
     *
     * <p>provider 와 kind 를 <b>함께</b> 넣는 이유(LLD §3 이 요구한다): 값만 해싱하면 같은 문자열을
     * 다른 provider 로 제출한 요청이 같은 digest 가 되어, 한 제공자에서 만든 시도를 다른 제공자
     * 자격으로 이어받을 수 있다.
     */
    public String of(SocialCredential credential) {
        return hex(mac(credential.provider() + SEPARATOR + credential.kind()
                + SEPARATOR + credential.value()));
    }

    private byte[] mac(String input) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(key);
            return mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            // HmacSHA256 은 모든 JRE 의 필수 알고리즘이라 여기 오면 배선 사고다. 원문은 싣지 않는다.
            throw new IllegalStateException("자격 digest 를 계산하지 못했다", e);
        }
    }

    private static String hex(byte[] bytes) {
        return HexFormat.of().formatHex(bytes);
    }
}
