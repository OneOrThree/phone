package com.oneorthree.phone.screentime;

import com.oneorthree.phone.screentime.dto.ScreenTimeRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

/**
 * {@code ScreenTimeController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "ScreenTime", description = "스크린 타임 목표 달성 저장 API")
public interface ScreenTimeControllerDocs {

    /**
     * @param request 하루치 측정값과 달성 여부
     * @param userId  보고 주체
     * @return 본문 없는 204
     */
    @Operation(summary = "스크린 타임 저장",
            description = "매일 23:59 iOS 앱이 당일 스크린타임 달성 여부를 전송. 달성 여부는 iOS에서 계산.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패 또는 잘못된 타임존"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> saveScreenTime(ScreenTimeRequest request, UUID userId);
}
