package com.oneorthree.phone.internal.dto;

/**
 * AT 재발급 결과 (GROMO-2035).
 *
 * <p>{@code refreshToken} 은 <b>이 경로에서 언제나 null</b> 이다 — 계정 LLD §3 의 미회전 호환 응답이고,
 * 앱은 값이 있을 때만 저장소를 갱신한다. 필드를 빼지 않고 명시적 null 로 두는 이유는, 나중에 회전이
 * 활성화될 때 <b>필드의 유무가 아니라 값</b>만 달라지게 하기 위해서다.
 *
 * <p>{@code sessionId}·{@code deviceBootstrap} 은 담지 않는다. 기기 등록 축의 자격이고 공개 갱신
 * 계약에 들어 있지 않다 — 내부 DTO 에 담아 두고 Business 에서 거르는 방식은 거르는 줄 하나가
 * 빠지면 그대로 노출된다.
 */
public record SessionRefreshResponse(String accessToken, String refreshToken) {

    @Override
    public String toString() {
        return "SessionRefreshResponse[tokens=redacted]";
    }
}
