package com.oneorthree.phone.friend;

import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code PinController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Pin", description = "유저 핀 API (리그·친구 공용) — 친구 아닌 임의 유저도 핀 가능")
public interface PinControllerDocs {

    @Operation(summary = "유저 핀 설정",
            description = "임의 유저(친구 아니어도 가능)를 핀해 홈·집중·리그 화면에 표시. 이미 핀이면 멱등(204). "
                    + "자기 자신은 400.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 설정 성공"),
            @ApiResponse(responseCode = "400", description = "자기 자신 핀 시도"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음")
    })
    ResponseEntity<Void> pin(UUID userId, UUID me);

    @Operation(summary = "유저 핀 해제", description = "핀 해제. 핀이 없어도 멱등(204).")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "핀 해제 성공"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음")
    })
    ResponseEntity<Void> unpin(UUID userId, UUID me);

    @Operation(summary = "핀한 유저 조회",
            description = "내가 핀한 유저 목록(친구 아님 포함). 캐릭터 표시정보 + 오늘 집중분 + 현재 집중 여부 포함."
                    + " date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘(YYYY-MM-DD) — 기기 로컬 날짜가 아니다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류")
    })
    ResponseEntity<List<PinnedUserResponse>> getPins(LocalDate date, UUID me);
}
