package com.oneorthree.business.api.dto;

import com.oneorthree.business.common.validation.DeviceOwnershipTokens;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 푸시 기기 토큰 등록 요청.
 *
 * <p>{@code deviceToken} 은 기존 계약 그대로 필수 + 최대 512자({@code User.deviceToken} 길이와 동기,
 * GROMO-528). 나머지 두 필드는 <b>additive 이고 지금은 선택</b>이다 — 현 앱은
 * {@code {deviceToken}} 만 보낸다({@code userApi.ts:81-83}). 곧장 필수화하면 구 앱의 등록이 전부
 * 거부돼 푸시가 끊긴다(A22 ㊟ 의 롤아웃 ①→②→③).
 *
 * @param deviceToken     FCM registration token
 * @param ownershipToken  직전 등록 응답으로 받은 CAS 값(㊚). 없으면 부트스트랩 예외 경로(㊦).
 *                        있으면 <b>정규 UUID 표기</b>여야 한다 — 알림 서버가 {@code UUID} 로 발급해
 *                        돌려준 값이라 그 밖의 문자열은 어느 행에도 맞지 않는다. 빈 값·깨진 값을
 *                        「없음」으로 접으면 CAS 를 잃은 넓은 삭제·등록이 된다
 *                        ({@link DeviceOwnershipTokens})
 * @param deviceBootstrap 그 로그인 세션의 1회용 자격(㋞). 있으면 Data 에 세션 활성을 동기 확인한다
 */
public record DeviceTokenRegisterRequest(
        @NotBlank @Size(max = 512) String deviceToken,
        @Pattern(regexp = DeviceOwnershipTokens.CANONICAL_UUID_PATTERN,
                message = "소유권 값의 형식이 올바르지 않습니다.")
        @Size(max = 512) String ownershipToken,
        @Size(max = 512) String deviceBootstrap) {
}
