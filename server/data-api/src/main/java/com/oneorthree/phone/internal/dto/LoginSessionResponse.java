package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 로그인 결과 — 공개 201 <b>본문</b>의 네 필드 + 헤더로 나갈 {@code deviceBootstrap} (계정 LLD §2.1).
 *
 * <p>{@code isNewUser} · raw provider subject · internal nonce · sessionEpoch 를 담지 <b>않는다</b>.
 * 내부 DTO 에는 담아 두고 Business 에서 거르는 방식은, 거르는 줄 하나가 빠지면 그대로 노출된다 —
 * 애초에 담지 않으면 그 사고가 불가능하다.
 *
 * <p>{@code deviceBootstrap} 은 <b>예외</b>다. LLD §2.1 이 「기존 {@code deviceBootstrap} 전달은 신규
 * 응답의 {@code X-Device-Bootstrap} 헤더로 보존한다」고 못박았고, 본문 4필드는 그대로 둬야 한다.
 * 그래서 값은 여기 실어 보내되 Business 가 <b>본문이 아니라 헤더로</b> 내보낸다(GROMO-2037).
 * 이 값은 1회용 자격이므로 저장·로그·공용 캐시 어디에도 남기지 않는다 — {@link #toString()} 이
 * 토큰과 함께 이 값을 가린다.
 *
 * @param deviceBootstrap 이 세션의 1회용 자격 원문. <b>없을 수 있다</b> — 결과 재생(응답 유실 복구)은
 *                        원문을 보관하지 않아 되살리지 못하고, 그때 앱은 자격 없는 기존 기기 등록
 *                        경로로 내려간다
 */
public record LoginSessionResponse(
        String accessToken,
        String refreshToken,
        UUID userId,
        boolean onboardingComplete,
        String deviceBootstrap) {

    @Override
    public String toString() {
        return "LoginSessionResponse[userId=" + userId
                + ", onboardingComplete=" + onboardingComplete + ", credentials=redacted]";
    }
}
