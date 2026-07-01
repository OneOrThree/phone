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

    // ⚠️ 한계: countryCode 검증(@Pattern)은 임의의 ISO 2자리(US 등)를 허용하지만 매핑은 아래 국가뿐이다.
    // 미지원 국가는 UTC 폴백 → 해당 유저는 자정 경계에서 스크린타임 날짜가 오귀속될 수 있다.
    // 현재 서비스는 KR 중심이라 YAGNI 로 최소 매핑만 두며, 지원국 확대가 필요하면 여기 추가한다.
    // (US 처럼 다중 타임존 국가는 단일 ZoneId 매핑이 부정확하므로 별도 정책 필요.)
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
