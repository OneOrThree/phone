package com.oneorthree.business.upstream.data.dto;

import java.util.List;

/**
 * 첫 항해 체험 도착의 선택 본문 (GROMO-2741) — Data {@code IntroArrivalRequest} 와 같은 모양이다.
 * Meta Conversions API 가 사용자를 알아보는 값이라 로그에 남기지 않는다.
 *
 * @param meta     검증을 통과한 앱의 Meta SDK 값
 * @param clientIp Business 가 신뢰한 프록시에서 판정한 호출자 주소
 */
public record IntroArrivalCommand(Meta meta, String clientIp) {

    /**
     * @param anonId                    Meta SDK 설치 익명 ID
     * @param advertiserTrackingEnabled 광고 추적 허용 여부
     * @param extinfo                   16칸 기기 정보
     */
    public record Meta(String anonId, boolean advertiserTrackingEnabled, List<String> extinfo) {
    }
}
