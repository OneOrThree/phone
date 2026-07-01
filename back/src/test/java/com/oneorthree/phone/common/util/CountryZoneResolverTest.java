package com.oneorthree.phone.common.util;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;

class CountryZoneResolverTest {

    @Test
    @DisplayName("KR → Asia/Seoul")
    void resolveKorea() {
        assertThat(CountryZoneResolver.resolve("KR")).isEqualTo(ZoneId.of("Asia/Seoul"));
    }

    @Test
    @DisplayName("null → UTC 폴백")
    void resolveNullFallsBackToUtc() {
        assertThat(CountryZoneResolver.resolve(null)).isEqualTo(ZoneId.of("UTC"));
    }

    @Test
    @DisplayName("미지원 국가코드 → UTC 폴백")
    void resolveUnknownFallsBackToUtc() {
        assertThat(CountryZoneResolver.resolve("ZZ")).isEqualTo(ZoneId.of("UTC"));
    }
}
