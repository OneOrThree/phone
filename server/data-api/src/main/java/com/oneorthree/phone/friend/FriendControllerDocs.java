package com.oneorthree.phone.friend;

import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.search.SearchType;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * {@code FriendController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "Friend", description = "친구 요청·수락·거절·삭제·목록·검색 API")
public interface FriendControllerDocs {

    @Operation(summary = "친구 요청 생성",
            description = "targetUserId에게 친구 요청. 자기자신·중복·이미친구 검증, REJECTED면 재요청으로 재전환.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "요청 생성 성공"),
            @ApiResponse(responseCode = "400", description = "자기 자신에게 요청"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음"),
            @ApiResponse(responseCode = "409", description = "이미 친구 / 이미 보낸 요청 존재")
    })
    ResponseEntity<Void> createFriendRequest(FriendRequestCreateRequest request, UUID userId);

    @Operation(summary = "친구 요청 수락", description = "요청 수신자만 수락 가능. PENDING → ACCEPTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "수락 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    ResponseEntity<Void> acceptFriendRequest(UUID id, UUID userId);

    @Operation(summary = "친구 요청 거절", description = "요청 수신자만 거절 가능. PENDING → REJECTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "거절 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    ResponseEntity<Void> rejectFriendRequest(UUID id, UUID userId);

    @Operation(summary = "친구 삭제", description = "ACCEPTED 관계를 양측 누구나 soft delete. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "404", description = "친구 관계 아님")
    })
    ResponseEntity<Void> deleteFriend(UUID friendUserId, UUID userId);

    @Operation(summary = "친구 목록 조회",
            description = "ACCEPTED·미삭제 친구 목록. isPinned는 내가 핀한 친구면 true. 각 친구의 집중 라이브 정보"
                    + "(isFocusing·focusTimeMinutes·focusStartedAt·focusTagName) 포함. "
                    + "date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘(YYYY-MM-DD) — 기기 로컬 날짜가 아니다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류")
    })
    ResponseEntity<List<FriendResponse>> getFriends(LocalDate date, UUID userId);

    @Operation(summary = "친구 요청 목록 조회", description = "type=received(받은) | sent(보낸) PENDING 요청 목록.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<List<FriendRequestResponse>> getFriendRequests(String type, UUID userId);

    @Operation(summary = "친구 검색",
            description = "type별 검색 전략(NICKNAME=trgm)으로 검색. 자기자신 제외, 기존 관계(relation) 표기.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "검색 성공"),
            @ApiResponse(responseCode = "400", description = "지원하지 않는 검색 수단")
    })
    ResponseEntity<List<FriendSearchResultResponse>> searchFriends(SearchType type, String q, UUID userId);
}
