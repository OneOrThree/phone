package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.common.support.DeviceOwnershipTokens;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 기기 토큰 삭제 outbox 기록 요청 (A22 ㊲ · ㊨ · ㊪).
 *
 * <p><b>세 값이 모두 없을 수 있다</b> — 현 앱의 {@code DELETE /users/me/device-token} 에는 본문이
 * 아예 없고, 구 AT 에는 {@code gen} claim 이 없다. 그래도 <b>요청을 거절하지 않는다</b>: 거절하면
 * 구 앱의 로그아웃이 전부 실패하고, 앱은 그 실패를 삼킨 뒤 로컬 인증을 지워 아무도 재시도하지 않는다.
 *
 * @param deviceToken    대상 FCM 토큰({@code X-Device-Token}). 없으면 유저 단위 삭제로 처리된다
 * @param ownershipToken CAS 값({@code X-Device-Ownership}). 롤아웃 기간엔 없을 수 있다. <b>있으면</b>
 *                       정규 UUID 표기여야 한다 — 이 값은 그대로 outbox 봉투에 실려 영구 보관되고,
 *                       깨진 값은 알림 서버가 소비할 수 없어 그 유저의 순서 축을 막는다. 「없음」으로
 *                       접지 않는 이유는 {@link DeviceOwnershipTokens} 에 있다
 * @param authGeneration AT 의 {@code gen} claim. <b>없으면 null 그대로</b> 싣는다 — 현재 세대로 채우면
 *                       tombstone 을 우회한다(㊍)
 */
public record DeviceTokenDeletionRequest(
        @Size(max = 512) String deviceToken,
        @Pattern(regexp = DeviceOwnershipTokens.CANONICAL_UUID_PATTERN,
                message = "기기 소유권 값의 형식이 올바르지 않습니다.")
        @Size(max = 512) String ownershipToken,
        Long authGeneration) {
}
