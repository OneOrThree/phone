package com.oneorthree.business.common.http;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 클릭 IP 를 {@code SHA-256(UTF8(ip + salt))} hex 로 바꾼다 — Data API 의 {@code IpHasher} 와
 * <b>글자 그대로 같은 계산</b>이다.
 *
 * <p><b>salt 를 새로 만들면 매치가 전멸한다</b>(A22 ⓕ · 계약 §4 · §7 변경 금지). 기존에 저장된 모든
 * 해시와 대조가 불가능해져 진행 중이던 매치 후보가 전부 무효가 되고, 그건 되돌릴 수 없다. 그래서
 * {@code LINK_IP_SALT} 는 <b>기존 값 그대로</b> 주입한다.
 *
 * <p>원본 IP 는 어디에도 저장하지 않는다 — 매치에 필요한 것은 「같은 IP 였나」라는 동일성뿐이다.
 * salt 를 붙이는 이유는 IPv4 공간이 좁아 salt 없는 해시는 전수 계산으로 되돌릴 수 있기 때문이다.
 */
@Component
public class IpHasher {

    private final String salt;

    /**
     * @param salt {@code link.ip-salt} — <b>기존 운영 값</b>이어야 한다. 비어 있으면 부팅을 실패시킨다:
     *             빈 salt 로 뜨면 그 순간부터 계산한 해시가 기존 것과 하나도 안 맞아 매치가 조용히
     *             전멸하고, 그 사실은 「매치율이 0 이 됐다」로만 드러난다
     */
    public IpHasher(@Value("${link.ip-salt}") String salt) {
        // 빈 salt 로 뜨면 그때부터 계산한 해시가 기존 것과 하나도 안 맞아 매치가 조용히 전멸한다.
        // 치환되지 않은 플레이스홀더도 같다 — 그 리터럴로 해싱하면 값이 「그럴듯하게」 나오므로 더 나쁘다.
        this.salt = RequiredConfig.require(salt, "link.ip-salt");
    }

    /**
     * @param ip {@link ClientIpResolver} 가 판정한 주소 문자열. 값을 못 구했을 때의 {@code "unknown"} 도
     *           그대로 해싱되므로, 그 상태가 흔해지면 미상 클릭들이 같은 해시 한 덩어리로 뭉쳐 서로의
     *           매치 후보가 된다
     */
    public String hash(String ip) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest((ip + salt).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 은 JDK 표준 필수 알고리즘이라 실제로는 도달하지 않는다.
            throw new IllegalStateException("SHA-256 알고리즘을 찾을 수 없습니다", e);
        }
    }
}
