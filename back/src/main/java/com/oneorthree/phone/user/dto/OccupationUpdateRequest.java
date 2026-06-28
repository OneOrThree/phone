package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.Occupation;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
public class OccupationUpdateRequest {
    @NotNull
    private Occupation occupation;
}
