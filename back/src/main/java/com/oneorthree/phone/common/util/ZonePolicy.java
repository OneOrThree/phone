package com.oneorthree.phone.common.util;

import java.time.ZoneId;

/**
 * 서비스 전역 시간대 정책 — 판정·저장·조회의 날짜 버킷이 전부 KST(Asia/Seoul) 고정이다
 * (GROMO-1259, 챌린지 정책 N8 · FR-19).
 *
 * <p>종전엔 통계 저장 일자가 유저 country_code 파생 존({@code CountryZoneResolver}, GROMO-561)으로
 * 갈렸지만, 챌린지 판정·카드·정산은 전부 KST 고정이라 저장축이 갈리면 판정 경로(KST 날짜 키)와
 * 저장 버킷이 어긋난다(정책 B3 — 구 D6 갭. JP 가 UTC+9 라 우연히 무해해 드러나지 않았다).
 * 그래서 저장축까지 KST 로 통일하고 리졸버를 제거했다.
 *
 * <p><b>알려진 한계 L5</b>: 해외 유저는 "내 하루"와 앱의 하루가 어긋난다 — 한국 타깃 서비스라
 * 수용한다(docs/prd/challenge/prd.md L5 · policy.md B3).
 */
public final class ZonePolicy {

    /** 모든 날짜 버킷·판정의 단일 기준 존. */
    public static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private ZonePolicy() {
    }
}
