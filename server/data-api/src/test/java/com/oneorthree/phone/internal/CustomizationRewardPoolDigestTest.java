package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.CustomizationRewardPoolAdminService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 추첨 풀 지문: 계약 §0 의 POOL 시험 값. 백오피스(JS JSON.stringify)와 바이트까지 같아야 한다. */
class CustomizationRewardPoolDigestTest {

    @Test
    @DisplayName("POOL 정규 문자열과 SHA-256 이 계약의 시험 값과 같다")
    void poolCanonicalAndDigestMatchTheContract() throws Exception {
        String canonical = CustomizationRewardPoolAdminService.canonical(
                List.of("cust.head.bun", "cust.head.mandarin", "cust.neck.bell"));

        assertThat(canonical).isEqualTo("{\"productIds\":[\"cust.head.bun\",\"cust.head.mandarin\",\"cust.neck.bell\"]}");
        assertThat(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(canonical.getBytes(StandardCharsets.UTF_8))))
                .isEqualTo("e7c9781ed14a0461f6b88b1a70438621e457e6f42ae1fd98709832e728fe66b1");
    }
}
