package com.oneorthree.phone.common.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * {@code HealthController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Health", description = "헬스 체크 API Test")
public interface HealthControllerDocs {

    /** @return 서버가 응답 가능함을 알리는 고정 문자열 */
    @Operation(summary = "서버 상태 확인", description = "서버 상태를 반환합니다.")
    String health();
}
