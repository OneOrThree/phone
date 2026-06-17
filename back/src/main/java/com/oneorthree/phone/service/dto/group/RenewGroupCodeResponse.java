package com.oneorthree.phone.service.dto.group;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class RenewGroupCodeResponse {
    private String code;
    private Instant codeExpiresAt;
}
