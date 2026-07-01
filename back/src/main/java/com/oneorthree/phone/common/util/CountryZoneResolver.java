package com.oneorthree.phone.common.util;

import java.time.ZoneId;
import java.util.Map;

/**
 * ISO 3166-1 alpha-2 국가코드 → 대표 ZoneId 파생 (GROMO-561).
 *
 * <p>스크린타임 저장의 로컬 날짜 산정 등에서 유저 country_code 로 타임존을 도출한다.
 * 단일 타임존 국가 위주의 정적 매핑으로 시작(YAGNI). 미지원 코드·null 은 UTC 로 폴백한다.
 */
public final class CountryZoneResolver {

    private static final ZoneId FALLBACK = ZoneId.of("UTC");

    private static final Map<String, ZoneId> COUNTRY_ZONES = Map.of(
            "KR", ZoneId.of("Asia/Seoul"),
            "JP", ZoneId.of("Asia/Tokyo"),
            "GB", ZoneId.of("Europe/London")
    );

    private CountryZoneResolver() {
    }

    public static ZoneId resolve(String countryCode) {
        if (countryCode == null) {
            return FALLBACK;
        }
        return COUNTRY_ZONES.getOrDefault(countryCode, FALLBACK);
    }
}
