package com.oneorthree.phone.analytics;

import com.oneorthree.phone.analytics.dto.AnalyticsEventRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

/**
 * {@code AnalyticsController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "analytics", description = "클라 이벤트 수집 API (Track 2 로그 합류)")
public interface AnalyticsControllerDocs {

    /**
     * @param body 수집할 이벤트
     * @return 본문 없는 204
     */
    @Operation(summary = "클라 이벤트 수신",
            description = "FE 계측 이벤트를 화이트리스트 검증 후 user-activity 로그에 source=client 로 발행. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수신 성공"),
        @ApiResponse(responseCode = "400", description = "event 누락/화이트리스트 외 이벤트/payload 형식 오류"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<Void> recordEvent(AnalyticsEventRequest body);
}
