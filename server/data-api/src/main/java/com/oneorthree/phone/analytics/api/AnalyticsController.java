package com.oneorthree.phone.analytics.api;

import com.oneorthree.phone.analytics.dto.AnalyticsEventRequest;
import com.oneorthree.phone.analytics.service.AnalyticsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "analytics", description = "클라 이벤트 수집 API (Track 2 로그 합류)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    @Operation(summary = "클라 이벤트 수신",
            description = "FE 계측 이벤트를 화이트리스트 검증 후 user-activity 로그에 source=client 로 발행. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수신 성공"),
        @ApiResponse(responseCode = "400", description = "event 누락/화이트리스트 외 이벤트/payload 형식 오류"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    @PostMapping("/analytics/events")
    public ResponseEntity<Void> recordEvent(@Valid @RequestBody AnalyticsEventRequest body) {
        analyticsService.record(body.event(), body.payload());
        return ResponseEntity.noContent().build();
    }
}
