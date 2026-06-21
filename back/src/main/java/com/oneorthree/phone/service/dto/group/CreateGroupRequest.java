package com.oneorthree.phone.service.dto.group;

import com.oneorthree.phone.domain.group.MissionCategory;
import com.oneorthree.phone.domain.group.MissionType;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

@Getter
@NoArgsConstructor
@AllArgsConstructor
public class CreateGroupRequest {

    @NotBlank
    @Size(max = 50)
    private String name;

    private String password;

    @Size(max = 200)
    private String description;

    @Min(1)
    @Max(10)
    private Integer maxMembers;

    @NotNull
    private MissionType missionType;

    @NotNull
    private MissionCategory missionCategory;

    private Integer durationMinutes;
    private Instant windowStart;
    private Instant windowEnd;
}
