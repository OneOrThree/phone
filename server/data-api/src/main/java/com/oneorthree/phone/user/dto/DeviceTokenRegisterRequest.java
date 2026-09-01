package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 푸시 기기 토큰 등록 요청. 토큰은 기기·재설치·앱 갱신마다 회전하므로 <b>같은 유저가 반복해서</b> 보낸다 —
 * 서버는 마지막 값만 들고 있고, 무효 판정된 토큰은 그 토큰과 일치할 때만 지운다(회전 중인 새 토큰을
 * 날리지 않기 위해).
 */
@Getter
@NoArgsConstructor
public class DeviceTokenRegisterRequest {
    /**
     * FCM registration token — User.deviceToken length(512) 와 동기 (GROMO-528)
     */
    @NotBlank
    @Size(max = 512)
    private String deviceToken;
}
