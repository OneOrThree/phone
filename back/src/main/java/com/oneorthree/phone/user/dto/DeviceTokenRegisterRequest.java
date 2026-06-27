package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class DeviceTokenRegisterRequest {
    @NotBlank
    @Size(max = 255)
    private String deviceToken;
}
