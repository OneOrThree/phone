package com.oneorthree.phone.common.util;

import java.time.ZoneId;
import java.util.Map;

/**
 * ISO 3166-1 alpha-2 국가코드 → 대표 ZoneId 파생 (GROMO-561).
 *
 * <p>스크린타임 저장의 로컬 날짜 산정 등에서 유저 country_code 로 타임존을 도출한다.
 * 단일 타임존 국가 위주의 정적 매핑으로 시작(YAGNI). 미지원 코드·null 은 Asia/Seoul 로 폴백한다(GROMO-1252).
 */
public final class CountryZoneResolver {

    // 폴백은 Asia/Seoul (GROMO-1252). country_code 는 유저 생성 시점엔 항상 null 이고
    // 온보딩 마지막 프로필 등록에서야 채워진다 — 중간 이탈·게스트는 계속 null 이다.
    // UTC 폴백이면 그 유저들의 '하루'가 한국시간 오전 9시에 바뀌어 자정 분할이 엉뚱한 데서
    // 쪼개진다. KR 중심 서비스이므로 미상은 KST 로 본다.
    private static final ZoneId FALLBACK = ZoneId.of("Asia/Seoul");

    // ⚠️ 한계: countryCode 검증(@Pattern)은 임의의 ISO 2자리(US 등)를 허용하지만 매핑은 아래 국가뿐이다.
    // 미지원 국가는 Asia/Seoul 폴백 → 해당 유저는 자정 경계에서 스크린타임 날짜가 오귀속될 수 있다.
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
