package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.CustomizationGrantAdminService;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 백오피스(JS JSON.stringify)와 바이트 단위로 같은 정규 문자열·지문. 계약 §0 의 시험 값을 그대로 고정한다. */
class CustomizationGrantDigestTest {

    @Test
    void grantUsersCanonicalAndDigestMatchTheContractValue() {
        String canonical = CustomizationGrantAdminService.canonical("cust.head.mandarin", "USERS",
                List.of("0192f5a0-0000-7000-8000-000000000001", "0192f5a0-0000-7000-8000-000000000002"),
                "11월 출석 감사 선물 \"귤\"");

        assertThat(canonical).isEqualTo("{\"productId\":\"cust.head.mandarin\",\"mode\":\"USERS\",\"userIds\":"
                + "[\"0192f5a0-0000-7000-8000-000000000001\",\"0192f5a0-0000-7000-8000-000000000002\"],"
                + "\"reason\":\"11월 출석 감사 선물 \\\"귤\\\"\"}");
        assertThat(CustomizationGrantAdminService.digest("cust.head.mandarin", "USERS",
                List.of("0192f5a0-0000-7000-8000-000000000001", "0192f5a0-0000-7000-8000-000000000002"),
                "11월 출석 감사 선물 \"귤\""))
                .isEqualTo("f11221233c1eac14b901dff59c694fa29ecb00a58c8142db861ebfdb6fff5cd8");
    }

    @Test
    void grantAllCanonicalAndDigestMatchTheContractValue() {
        assertThat(CustomizationGrantAdminService.canonical("cust.neck.bell", "ALL", List.of(), "전체 지급"))
                .isEqualTo("{\"productId\":\"cust.neck.bell\",\"mode\":\"ALL\",\"userIds\":[],\"reason\":\"전체 지급\"}");
        assertThat(CustomizationGrantAdminService.digest("cust.neck.bell", "ALL", List.of(), "전체 지급"))
                .isEqualTo("e9330e1d94d92be4eacf6f7570725d2c79acc2d6bd5ffd84eaa16d359c61d506");
    }

    @Test
    void backslashIsEscapedLikeJsonStringify() {
        assertThat(CustomizationGrantAdminService.canonical("p", "ALL", List.of(), "a\\b"))
                .contains("\"reason\":\"a\\\\b\"");
    }
}
