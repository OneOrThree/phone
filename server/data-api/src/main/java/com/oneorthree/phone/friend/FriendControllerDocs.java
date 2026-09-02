package com.oneorthree.phone.friend;

import com.oneorthree.phone.friend.dto.FriendRequestCreateRequest;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.service.search.SearchType;
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

    /**
     * PENDING 친구 요청을 만든다. 같은 상대와 REJECTED 로 끝난 행이 남아 있으면 새 행을 넣지 않고 그 행을
     * PENDING 으로 되돌려 재요청으로 삼는다.
     *
     * @param request 요청 대상({@code targetUserId}). 자기 자신이면 400
     * @param userId  요청을 보내는 로그인 유저 — 토큰에서 주입되며 본문으로는 받지 않는다
     * @return 본문 없는 201. 이미 친구거나 보낸 요청이 살아 있으면 409
     */
    @Operation(summary = "친구 요청 생성",
            description = "targetUserId에게 친구 요청. 자기자신·중복·이미친구 검증, REJECTED면 재요청으로 재전환.")
    @ApiResponses({
            @ApiResponse(responseCode = "201", description = "요청 생성 성공"),
            @ApiResponse(responseCode = "400", description = "자기 자신에게 요청"),
            @ApiResponse(responseCode = "404", description = "대상 유저 없음"),
            @ApiResponse(responseCode = "409", description = "이미 친구 / 이미 보낸 요청 존재")
    })
    ResponseEntity<Void> createFriendRequest(FriendRequestCreateRequest request, UUID userId);

    /**
     * 받은 친구 요청을 수락해 PENDING → ACCEPTED 로 바꾼다.
     *
     * @param id     수락할 요청 행 id — 상대 유저 id 가 아니다
     * @param userId 로그인 유저. 요청의 <b>수신자</b>만 수락할 수 있어 발신자가 부르면 403
     * @return 본문 없는 200
     */
    @Operation(summary = "친구 요청 수락", description = "요청 수신자만 수락 가능. PENDING → ACCEPTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "수락 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    ResponseEntity<Void> acceptFriendRequest(UUID id, UUID userId);

    /**
     * 받은 친구 요청을 거절해 PENDING → REJECTED 로 바꾼다. 행을 지우지 않으므로 같은 상대의 재요청은
     * 이 행을 다시 PENDING 으로 되살려 쓴다.
     *
     * @param id     거절할 요청 행 id — 상대 유저 id 가 아니다
     * @param userId 로그인 유저. 요청의 <b>수신자</b>만 거절할 수 있어 발신자가 부르면 403
     * @return 본문 없는 200
     */
    @Operation(summary = "친구 요청 거절", description = "요청 수신자만 거절 가능. PENDING → REJECTED.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "거절 성공"),
            @ApiResponse(responseCode = "403", description = "수신자 아님"),
            @ApiResponse(responseCode = "404", description = "요청 없음")
    })
    ResponseEntity<Void> rejectFriendRequest(UUID id, UUID userId);

    /**
     * 성립된 친구 관계를 끊는다. 물리 삭제가 아니라 soft delete 라 관계 행은 남고, 양쪽 누구든 끊을 수 있다.
     *
     * @param friendUserId 끊을 상대 유저
     * @param userId       로그인 유저
     * @return 본문 없는 204. ACCEPTED 관계가 아니면 404
     */
    @Operation(summary = "친구 삭제", description = "ACCEPTED 관계를 양측 누구나 soft delete. 성공 시 204 반환.")
    @ApiResponses({
            @ApiResponse(responseCode = "204", description = "삭제 성공"),
            @ApiResponse(responseCode = "404", description = "친구 관계 아님")
    })
    ResponseEntity<Void> deleteFriend(UUID friendUserId, UUID userId);

    /**
     * 성립된 친구 목록을 화면이 바로 그릴 수 있는 형태로 돌려준다 — 티어·직업·핀 여부에 상대의 집중 라이브
     * 상태(현재 집중 중인지, 그날 집중분, 세션 시작 시각·태그)를 합쳐 실는다.
     *
     * @param date   집중분을 집계할 날짜. 서버 판정 축인 KST 기준 오늘이어야 하며, 기기 로컬 날짜를 그대로
     *               보내면 자정 근처에서 하루가 어긋난다({@link com.oneorthree.phone.common.util.ZonePolicy})
     * @param userId 로그인 유저
     * @return 친구 목록. 친구가 없으면 404 가 아니라 빈 배열
     */
    @Operation(summary = "친구 목록 조회",
            description = "ACCEPTED·미삭제 친구 목록. isPinned는 내가 핀한 친구면 true. 각 친구의 집중 라이브 정보"
                    + "(isFocusing·focusTimeMinutes·focusStartedAt·focusTagName) 포함. "
                    + "date 는 서버 판정 축(KST 고정, GROMO-1259) 기준 오늘(YYYY-MM-DD) — 기기 로컬 날짜가 아니다.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공"),
            @ApiResponse(responseCode = "400", description = "date 누락·형식 오류")
    })
    ResponseEntity<List<FriendResponse>> getFriends(LocalDate date, UUID userId);

    /**
     * 아직 처리되지 않은(PENDING) 친구 요청 목록.
     *
     * @param type   {@code received} 면 내가 받은 요청, {@code sent} 면 내가 보낸 요청
     * @param userId 로그인 유저
     * @return 각 요청의 <b>상대</b> 유저 표시정보와 요청 시각. 시각은 행 생성 시각이 아니라 이번 요청 사이클이
     *         시작된 시각이다 — 거절 뒤 재요청은 같은 행을 되살리기 때문
     */
    @Operation(summary = "친구 요청 목록 조회", description = "type=received(받은) | sent(보낸) PENDING 요청 목록.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "조회 성공")
    })
    ResponseEntity<List<FriendRequestResponse>> getFriendRequests(String type, UUID userId);

    /**
     * 친구로 추가할 유저를 검색한다. {@code type} 이 고른 검색 전략이 매칭 방식을 정한다.
     *
     * @param type   검색 수단. 등록된 전략이 없는 값이면 400
     * @param q      검색어 — 해석은 전략 몫이고, 닉네임 검색은 pg_trgm 유사도로 매칭한다
     * @param userId 로그인 유저. 결과에서 자기 자신은 빠지고, 나머지 각 건에는 나와의 기존 관계
     *               (없음·요청중·친구)가 채워져 앱이 버튼과 배지를 갈라 그릴 수 있다
     * @return 검색 결과 목록
     */
    @Operation(summary = "친구 검색",
            description = "type별 검색 전략(NICKNAME=trgm)으로 검색. 자기자신 제외, 기존 관계(relation) 표기.")
    @ApiResponses({
            @ApiResponse(responseCode = "200", description = "검색 성공"),
            @ApiResponse(responseCode = "400", description = "지원하지 않는 검색 수단")
    })
    ResponseEntity<List<FriendSearchResultResponse>> searchFriends(SearchType type, String q, UUID userId);
}
