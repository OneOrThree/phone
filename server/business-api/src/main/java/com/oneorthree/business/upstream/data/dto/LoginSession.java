package com.oneorthree.business.upstream.data.dto;

import java.util.UUID;

/**
 * Data 가 확정한 로그인 결과 — 공개 201 <b>본문</b>의 네 필드 + 헤더로 나갈 자격 하나.
 *
 * <p>상류 DTO 와 공개 DTO 를 같은 모양으로 둔 것은 의도다. 상류에 {@code isNewUser}·provider
 * subject 가 실려 오고 Business 가 그걸 «거르는» 구조였다면, 거르는 줄 하나가 빠지는 순간 노출이다.
 * 애초에 상류가 보내지 않으면 그 사고가 불가능하다.
 *
 * <p>{@code deviceBootstrap} 만 그 대칭에서 벗어난다 — 계정 LLD §2.1 이 그 값을 <b>본문이 아니라</b>
 * {@code X-Device-Bootstrap} 헤더로 내보내라고 하기 때문이다(GROMO-2037). 공개 본문은
 * {@code AuthSessionUseCase.Result} 의 네 필드 그대로다.
 *
 * @param deviceBootstrap 1회용 기기 등록 자격. 결과 재생(응답 유실 복구)에는 실려 오지 않는다 —
 *                        원문을 보관하는 곳이 없어 상류가 되살리지 못한다
 */
public record LoginSession(
        String accessToken,
        String refreshToken,
        UUID userId,
        boolean onboardingComplete,
        String deviceBootstrap) {

    @Override
    public String toString() {
        return "LoginSession[userId=" + userId
                + ", onboardingComplete=" + onboardingComplete + ", credentials=redacted]";
    }
}
