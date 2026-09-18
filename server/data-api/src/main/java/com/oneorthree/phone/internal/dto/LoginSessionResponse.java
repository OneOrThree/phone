package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 로그인 결과 — 공개 201 의 네 필드와 <b>정확히 같다</b> (계정 LLD §2.1).
 *
 * <p>{@code isNewUser} · raw provider subject · internal nonce · sessionEpoch 를 담지 <b>않는다</b>.
 * 내부 DTO 에는 담아 두고 Business 에서 거르는 방식은, 거르는 줄 하나가 빠지면 그대로 노출된다 —
 * 애초에 담지 않으면 그 사고가 불가능하다.
 *
 * <p>{@code deviceBootstrap} 도 여기 없다. LLD 는 그 값을 응답 <b>헤더</b>({@code X-Device-Bootstrap})
 * 로 보존하라고 하는데, 그 배선은 기기 등록 쪽 몫이라 이 계약에 미리 넣지 않는다.
 */
public record LoginSessionResponse(
        String accessToken,
        String refreshToken,
        UUID userId,
        boolean onboardingComplete) {
}
