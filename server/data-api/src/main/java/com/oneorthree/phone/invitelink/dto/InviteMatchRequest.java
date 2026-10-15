package com.oneorthree.phone.invitelink.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * deferred 매치 요청 (스펙 §4-2 ③). 설치 직후 첫 실행 때 앱이 <b>무인증</b>으로 보낸다.
 *
 * @param os            기기 OS — 클릭의 os 와 일치해야 매치된다
 * @param deviceId      앱 자체 device_id. 컬럼 길이(64)를 넘는 값은 저장 단계에서 터지므로 입력에서 막는다
 * @param appInstanceId GA4 app_instance_id — 없으면 null(앱이 아직 못 받아온 경우)
 */
public record InviteMatchRequest(
        @NotBlank @Pattern(regexp = "ios|android|other") String os,
        @NotBlank @Size(max = 64) String deviceId,
        @Size(max = 64) String appInstanceId) {
}
