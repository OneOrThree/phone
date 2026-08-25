package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

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
