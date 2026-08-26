package com.oneorthree.phone.user.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class UpdateScreenTimePermissionRequest {
    @NotNull
    private Boolean granted;
}
