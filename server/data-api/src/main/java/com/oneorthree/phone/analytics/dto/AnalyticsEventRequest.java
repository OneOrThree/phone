package com.oneorthree.phone.analytics.dto;

import jakarta.validation.constraints.NotBlank;

import java.util.Map;

/**
 * 클라 이벤트 수신 요청. payload 키 스키마는 FE 계약 —
 * 서버는 화이트리스트·크기(≤25키)·스칼라 값만 검증한다(AnalyticsService).
 */
public record AnalyticsEventRequest(
        @NotBlank String event,
        Map<String, Object> payload
) {}
