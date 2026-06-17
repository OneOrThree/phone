package com.oneorthree.phone.service.dto.user;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class UpdateScreenTimePermissionRequest {
    @NotNull
    private Boolean granted;
}
