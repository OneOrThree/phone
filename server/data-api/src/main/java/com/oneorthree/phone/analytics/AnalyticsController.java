package com.oneorthree.phone.analytics;

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

/**
 * 앱이 올린 계측 이벤트를 받아 서버 로그 스트림에 합류시키는 수집 창구.
 * 검증·발행 규칙은 전부 {@link AnalyticsService} 에 있고 여기서는 HTTP 계약만 잡는다.
 */
@Tag(name = "analytics", description = "클라 이벤트 수집 API (Track 2 로그 합류)")
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AnalyticsController {

    private final AnalyticsService analyticsService;

    /**
     * 화이트리스트에 등록된 이벤트만 통과시켜 user-activity 로그로 흘려보낸다.
     *
     * @param body 이벤트 이름과 부가 payload — 미등록 이름이거나 payload 가 가드(25키·스칼라 값)를
     *             넘으면 400 으로 거절된다
     * @return 본문 없는 204. 수집은 단방향이라 적재 결과를 돌려주지 않는다
     */
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
