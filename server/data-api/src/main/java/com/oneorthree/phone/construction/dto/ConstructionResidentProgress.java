package com.oneorthree.phone.construction.dto;

import java.util.List;
import java.util.UUID;

/** 현재 목표의 대상 주민별 준비량. 목표 선택 이후의 기여이며 섬 통장 잔액과는 별개다. */
public record ConstructionResidentProgress(
        String buildingId,
        Integer requiredPerResident,
        List<Resident> residents) {

    /** remaining 은 초과 기여가 있어도 0 미만이 되지 않는다. */
    public record Resident(UUID userId, String name, int contributed, int remaining) {
    }
}
