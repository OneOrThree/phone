package com.oneorthree.phone.construction.dto;

import java.util.Map;

/** 섬 배치 정본 응답 (GROMO-2232) — {@code layout} 은 저장된 JSON 그대로다. */
public record IslandLayoutView(long layoutRevision, Map<String, Object> layout) {
}
