package com.oneorthree.phone.invitelink.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * 클릭 IP 를 SHA-256(ip + salt) hex 로 바꾼다.
 *
 * <p><b>원본 IP 는 어디에도 저장하지 않는다.</b> 매치에 필요한 건 "같은 IP 였나" 라는 동일성뿐이고,
 * 그건 해시로 충분하다. salt 를 붙이는 이유는 IPv4 공간이 좁아 salt 없는 해시는 전수 계산으로
 * 되돌릴 수 있기 때문이다(사실상 원본 저장과 같아진다).
 */
@Component
public class IpHasher {

    private final String salt;

    public IpHasher(@Value("${link.ip-salt}") String salt) {
        this.salt = salt;
    }

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
