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

    // GROMO-1252: 폴백을 UTC → Asia/Seoul 로 전환. country_code 는 온보딩 마지막에야 채워져
    // 중간 이탈·게스트는 계속 null 인데, UTC 폴백이면 그 유저들의 '하루'가 KST 오전 9시에 바뀐다.
    @Test
    @DisplayName("null → Asia/Seoul 폴백")
    void resolveNullFallsBackToSeoul() {
        assertThat(CountryZoneResolver.resolve(null)).isEqualTo(ZoneId.of("Asia/Seoul"));
    }

    @Test
    @DisplayName("미지원 국가코드 → Asia/Seoul 폴백")
    void resolveUnknownFallsBackToSeoul() {
        assertThat(CountryZoneResolver.resolve("ZZ")).isEqualTo(ZoneId.of("Asia/Seoul"));
    }
}
