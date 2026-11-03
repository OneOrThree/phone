package com.oneorthree.phone.internal.dto;

import java.util.List;

/**
 * {@code POST /internal/users/{userId}/islands/{islandId}/intro-arrivals} 선택 본문 (GROMO-2741).
 * Meta Conversions API 가 사용자를 알아보는 데 쓰는 값이다. 본문이 없거나 형식이 틀리면 사건은 기록하되
 * 전송 대상에서 뺀다(도착은 언제나 처리한다).
 *
 * @param meta     앱이 보낸 Meta SDK 값(없으면 null)
 * @param clientIp Business 가 신뢰한 프록시에서 판정한 호출자 주소(없으면 null)
 */
public record IntroArrivalRequest(Meta meta, String clientIp) {

    /**
     * @param anonId                    Meta SDK 설치 익명 ID — 1~128자 출력 가능 ASCII
     * @param advertiserTrackingEnabled iOS 는 ATT 허용일 때만 true
     * @param extinfo                   정확히 16칸 — [0] 은 i2|a2, [4] 는 비지 않음
     */
    public record Meta(String anonId, Boolean advertiserTrackingEnabled, List<String> extinfo) {

        /** 형식이 맞는가 — Business 검증과 같은 규칙이다(내부 호출이라도 열 길이 초과로 도착을 깨지 않게 다시 본다). */
        public boolean valid() {
            return anonId != null && anonId.matches("[\\x21-\\x7E]{1,128}") && advertiserTrackingEnabled != null
                    && extinfo != null && extinfo.size() == 16
                    && extinfo.stream().allMatch(v -> v != null && v.length() <= 128)
                    && ("i2".equals(extinfo.get(0)) || "a2".equals(extinfo.get(0)))
                    && !extinfo.get(4).isBlank();
        }
    }
}
