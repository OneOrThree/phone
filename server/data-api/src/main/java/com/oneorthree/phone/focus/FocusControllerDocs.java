package com.oneorthree.phone.focus;

import com.oneorthree.phone.focus.dto.FocusSessionCancelRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionEndResponse;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionSliceResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.dto.FocusTagResponse;
import com.oneorthree.phone.focus.dto.FocusTagSetupRequest;
import com.oneorthree.phone.focus.dto.FocusTagUpdateRequest;
import com.oneorthree.phone.focus.dto.OccupationDefaultTagsResponse;
import com.oneorthree.phone.user.repository.domain.Occupation;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * {@code FocusController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 */
@Tag(name = "focus", description = "focus 세션 관련 API (태그, 포커스 타임 등)")
public interface FocusControllerDocs {

    @Operation(summary = "TAG 조회", description = "유저별 TAG 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<List<FocusTagResponse>> getTag(UUID userId);

    @Operation(summary = "기본(추천) TAG 조회",
            description = "occupation별 기본(추천) 포커스 태그 목록. occupation 미지정 시 로그인 유저의 저장 occupation 사용. "
                    + "tagId 없음 — 유저가 선택 시 name 을 POST /api/v1/tag 로 넘겨 실제 태그 생성.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 파라미터 형식 오류 또는 유저 occupation 미설정"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<OccupationDefaultTagsResponse> getDefaultTags(UUID userId, Occupation occupation);

    @Operation(summary = "TAG 초기 등록", description = "TAG, 설명 등록")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> setupTag(UUID userId, FocusTagSetupRequest body);

    @Operation(summary = "TAG 수정",
            description = "TAG 이름 수정. rename 시 옛 태그를 참조하던 과거 세션을 새 태그로 재연결한다(동작 변경, GROMO-754). "
                    + "직군 프리셋(occupation) 태그는 이름 변경 불가(400).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패 또는 직군 프리셋 태그 rename 시도"),
        @ApiResponse(responseCode = "404", description = "태그 없음")
    })
    ResponseEntity<Void> updateTag(UUID userId, FocusTagUpdateRequest body);

    @Operation(summary = "TAG 삭제", description = "TAG 삭제")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "삭제 성공"),
        @ApiResponse(responseCode = "403", description = "권한 없음"),
        @ApiResponse(responseCode = "404", description = "태그 없음")
    })
    ResponseEntity<Void> deleteTag(UUID userId, UUID tagId);

    @Operation(summary = "Focus Session 저장",
            description = "Focus Session 정보 저장. 완료 후 그날 누적 집중 초·스트릭 인정 여부(GROMO-806)를 함께 반환한다. "
                    + "기존 빈 바디에 필드를 추가한 additive 변경 — 구버전 앱은 무시한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "201", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<FocusSessionSaveResponse> saveFocusSession(UUID userId, FocusSessionRequest body);

    @Operation(summary = "Focus Session 시작(라이브)",
            description = "startedAt 만 기록한 진행 중(endedAt NULL) 세션을 생성한다. 생성 세션 id 를 반환해 "
                    + "이후 PATCH /focus-session 으로 종료할 때 참조한다. 통계·스트릭은 종료 시점에 귀속. "
                    + "startedAt 이 서버 수신 시각 기준 [-5분, 0] 창을 벗어나면 서버 시각으로 대체한다(GROMO-1214).\n\n"
                    + "라이브 마커는 **유저당 1개**다(GROMO-1287). 이미 열린 마커가 이 요청보다 논리적으로 "
                    + "나중에 시작한 경우(백그라운드 복귀 리플레이의 과거 블록·요청 도착 역전·재전송) 서버는 "
                    + "마커를 만들지 않고 **sessionId = null** 로 201 을 돌려준다. 그때 클라는 그 블록을 "
                    + "마커 없이 POST /focus-session 으로 올린다 — **열려 있는 다른 마커의 id 를 대신 쓰면 "
                    + "안 된다**(서로 다른 블록이 같은 마커를 PATCH 하면 첫 요청만 적립되고 나머지는 "
                    + "SESSION_ALREADY_ENDED 를 받아 그 블록의 시간·코인이 영구 유실된다).")
    @ApiResponses({
        @ApiResponse(responseCode = "201",
                description = "시작 성공. sessionId 가 null 이면 마커 미생성 — 그 블록은 POST /focus-session 으로"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "타인 태그 지정"),
        @ApiResponse(responseCode = "404", description = "유저·태그 없음")
    })
    ResponseEntity<FocusSessionStartResponse> startFocusSession(UUID userId, FocusSessionStartRequest body);

    @Operation(summary = "Focus Session 종료(라이브)",
            description = "진행 중(endedAt NULL) 세션에 종료 시각을 채워 완료 처리한다. endedAt 생략 시 서버 수신 시각. "
                    + "완료 시점에 통계·스트릭·세션 보상 코인(집중 1분당 1코인)이 귀속되고 응답에 지급액이 실린다. "
                    + "endedAt 이 서버 수신 시각 기준 [-5분, 0] 창을 벗어나면 서버 시각으로 대체한다(GROMO-1214). "
                    + "이미 종료된 세션 재요청은 409 — 코드로 원인을 가른다: SESSION_ALREADY_ENDED(이미 완료, "
                    + "통계·지급 커밋됨) / SESSION_DISCARDED(취소·자동마감, 통계 미반영이라 앱이 POST 로 폴백 가능).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "종료 성공"),
        @ApiResponse(responseCode = "400", description = "sessionId 누락·endedAt < startedAt"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "세션·태그 소유자 불일치"),
        @ApiResponse(responseCode = "404", description = "유저·세션 없음"),
        @ApiResponse(responseCode = "409", description = "이미 종료된 세션")
    })
    ResponseEntity<FocusSessionEndResponse> endFocusSession(UUID userId, FocusSessionEndRequest body);

    @Operation(summary = "Focus Session 취소",
            description = "진행 중(endedAt NULL) 세션을 취소해 status=CANCELED 로 마감한다. 취소 시각은 서버 수신 시각. "
                    + "통계·스트릭은 귀속하지 않는다. 이미 종료/취소된 세션 재취소는 409(멱등).")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "취소 성공"),
        @ApiResponse(responseCode = "400", description = "sessionId 누락"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "403", description = "세션 소유자 불일치"),
        @ApiResponse(responseCode = "404", description = "세션 없음"),
        @ApiResponse(responseCode = "409", description = "이미 종료/취소된 세션")
    })
    ResponseEntity<Void> cancelFocusSession(UUID userId, FocusSessionCancelRequest body);

    @Operation(summary = "Focus Session 조회",
            description = "기간(from~to, UTC Instant) 필터 + 커서(keyset) 페이지네이션. "
                    + "cursor 생략 시 첫 페이지. 정렬은 id(UUID v7) 내림차순=최신순.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "400", description = "파라미터 누락·형식 오류·기간 역전·size 범위 밖"),
        @ApiResponse(responseCode = "401", description = "인증 필요"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<FocusSessionSliceResponse> getFocusSessions(UUID userId, Instant from, Instant to,
            UUID cursor, int size);
}
