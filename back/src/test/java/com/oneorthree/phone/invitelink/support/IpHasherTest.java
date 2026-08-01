package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 매치 fingerprint 의 한 축이자 개인정보 경계선 — 원본 IP 는 절대 값으로 남지 않아야 한다.
 */
class IpHasherTest {

    private final IpHasher hasher = new IpHasher("test-salt");

    @Test
    @DisplayName("해시는 hex 64자이고 같은 IP 에 대해 안정적이다")
    void hashesToStableHex() {
        String first = hasher.hash("1.2.3.4");

        assertThat(first).hasSize(64).matches("[0-9a-f]+");
        assertThat(hasher.hash("1.2.3.4")).isEqualTo(first);
    }

    @Test
    @DisplayName("해시에 원본 IP 가 남지 않고, 다른 IP 는 다른 값이 된다")
    void doesNotLeakRawIp() {
        String hash = hasher.hash("1.2.3.4");

        assertThat(hash).doesNotContain("1.2.3.4");
        assertThat(hash).isNotEqualTo(hasher.hash("1.2.3.5"));
    }

    @Test
    @DisplayName("salt 가 다르면 같은 IP 도 다른 해시가 된다 — 무지개 테이블 방어")
    void saltChangesTheHash() {
        assertThat(new IpHasher("another-salt").hash("1.2.3.4")).isNotEqualTo(hasher.hash("1.2.3.4"));
    }
}
