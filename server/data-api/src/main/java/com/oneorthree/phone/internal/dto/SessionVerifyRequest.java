package com.oneorthree.phone.internal.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * 서명된 {@code sid} 로 하는 세션 확인 요청 (A22 ㋤ 의 구 앱 경로).
 *
 * <p>{@link DeviceSessionVerifyRequest} 와 <b>따로 둔다</b> — 확인의 근거가 다르다. 저쪽은 앱이 들고
 * 있는 1회용 자격이고, 이쪽은 <b>서버가 서명해 AT 에 실어 준 값</b>이다. 한 DTO 에 섞어 「둘 중
 * 하나」로 받으면 자격 없는 요청이 자격 있는 요청의 경로를 타는 것처럼 보이고, 비면 무엇으로
 * 판정했는지 로그에서도 갈리지 않는다.
 *
 * @param sessionId AT 의 {@code sid} claim
 */
public record SessionVerifyRequest(
        @NotNull UUID sessionId) {
}
