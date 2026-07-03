package com.oneorthree.phone.user.dto;

import com.oneorthree.phone.user.domain.StatVisibility;
import jakarta.validation.constraints.NotNull;

/**
 * 통계 공개 범위 수정 요청. 정의되지 않은 문자열은 역직렬화 실패로 400 처리된다.
 */
public record StatVisibilityUpdateRequest(
        @NotNull StatVisibility statVisibility
) {}
