package com.oneorthree.phone.user;

import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.dto.DeviceTokenRegisterRequest;
import com.oneorthree.phone.user.dto.FocusTimeGoalUpdateRequest;
import com.oneorthree.phone.user.dto.NicknameCheckResponse;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.OccupationUpdateRequest;
import com.oneorthree.phone.user.dto.ScreenTimeGoalUpdateRequest;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.StatVisibilityUpdateRequest;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.UUID;

/**
 * {@code UserController} 의 OpenAPI 문서 면(面) — Swagger 애노테이션만 둔다(GROMO-1621).
 *
 * <p>파라미터 단위 {@code @Parameter} 는 구현체에 남는다 — 자바가 파라미터 애노테이션을
 * 상속하지 않아 여기 붙이면 스펙에서 사라진다.
 */
@Tag(name = "user", description = "user 관련 API (생성, 조회, 변경)")
public interface UserControllerDocs {

    /**
     * @param userId 온보딩 중인 본인
     * @param body   프로필 초기값. 닉네임만 필수이고, 목표는 원시 int 라 생략과 0 이 구분되지 않는다
     * @return 본문 없는 204. 닉네임이 중복이면 409, 형식(공백 제외 2~10자) 위반이면 400
     */
    @Operation(summary = "유저 정보 등록", description = "신규 유저 정보 등록")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> setupProfile(UUID userId, UserProfileSetupRequest body);

    /**
     * @param userId 본인
     * @param body   바꿀 필드만 담는다 — <b>null 인 필드는 건드리지 않는다</b>
     * @return 본문 없는 204. 남이 쓰는 닉네임이면 409
     */
    @Operation(summary = "유저 정보 부분 수정", description = "기존 유저 정보 부분 수정")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateProfile(UUID userId, UserProfileUpdateRequest body);

    /**
     * @param nickname 검사할 닉네임 원문(공백 제거 전)
     * @param userId   본인 — 자기 현재 닉네임을 그대로 검사하면 사용 가능으로 나온다
     * @return 항상 200 이고 판정은 본문의 available 에만 실린다 — 형식 위반도 4xx 가 아니라 false 다
     */
    @Operation(summary = "닉네임 사용 가능 여부 확인",
            description = "닉네임이 사용 가능한지 판정한다 (GROMO-1215). 항상 200 + {available: boolean} — "
                    + "형식 위반(trim 후 2~10자 밖·빈문자열)도 available=false 로 내려간다(별도 4xx 없음). "
                    + "본인 제외 중복 검사라 자기 자신의 현재 닉네임은 available=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "판정 성공 — available 로 사용 가능 여부 반환"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<NicknameCheckResponse> checkNickname(String nickname, UUID userId);

    /**
     * @param userId 본인
     * @return 프로필·잔액·목표와 함께 <b>서버 날짜 버킷 존</b>(KST 고정)을 내려준다 —
     *         앱이 업로드 날짜 키를 같은 축으로 만들게 하려는 것이다(200)
     */
    @Operation(summary = "유저 정보 조회", description = "기존 유저 정보 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<UserProfileResponse> getProfile(UUID userId);

    /**
     * @param body   OS 권한 보유 여부. 앱의 보고이지 서버가 검증하는 값이 아니다
     * @param userId 본인
     * @return 본문 없는 204. 이 플래그가 스크린타임 유료 회차 참여 가드에 걸려 있어,
     *         회수와 참여는 서버에서 잠금으로 직렬화된다
     */
    @Operation(summary = "스크린타임 권한 동의 상태 업데이트",
            description = "iOS Screen Time 권한 부여/취소 시 호출. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "업데이트 성공"),
        @ApiResponse(responseCode = "400", description = "granted 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateScreenTimePermission(UpdateScreenTimePermissionRequest body, UUID userId);

    /**
     * @param body   FCM 등록 토큰. 기기·재설치마다 회전하므로 같은 유저가 반복 호출한다
     * @param userId 본인
     * @return 본문 없는 204. 유저당 <b>토큰 1개</b>만 보관하므로 새 값이 옛 값을 덮는다
     */
    @Operation(summary = "디바이스 토큰 등록",
            description = "앱 시작 시 FCM registration token 을 등록/갱신. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "deviceToken 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> registerDeviceToken(DeviceTokenRegisterRequest body, UUID userId);

    /**
     * @param userId 본인
     * @return 본문 없는 204. 해제 후에는 이 유저에게 푸시가 가지 않는다
     */
    @Operation(summary = "디바이스 토큰 해제",
            description = "로그아웃/기기 변경 시 호출 — 이전 유저에게 푸시가 오발송되는 것 방지. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> clearDeviceToken(UUID userId);

    /**
     * @param body   설정 <b>전체 교체</b> — 한 항목만 바꾸려 해도 나머지를 현재값으로 함께 보내야 한다
     * @param userId 본인
     * @param idempotencyKey 선택 재시도 키. 없으면 기존처럼 각 요청을 별도 명령으로 처리한다
     * @return 본문 없는 204
     */
    @Operation(summary = "알림·심야·소리 설정 저장",
            description = "유저 전역 알림/심야 모드/소리 설정 저장. 성공 시 204 반환. "
                    + "선택 Idempotency-Key를 재시도에서 유지하면 같은 명령을 재생한다.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "필수 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음"),
        @ApiResponse(responseCode = "409", description = "같은 멱등 키에 다른 설정 본문")
    })
    ResponseEntity<Void> updateNotificationSettings(NotificationSettingsRequest body, UUID userId,
            String idempotencyKey);

    /**
     * @param userId 본인
     * @return 현재 설정(200). 심야 시각은 {@code "HH:mm"} 문자열이고 <b>시간대를 담지 않는다</b>(KST 축) —
     *         미설정이면 null 이다
     */
    @Operation(summary = "알림·심야·소리 설정 조회",
            description = "유저 전역 알림/심야 모드/소리 설정 현재값 조회. 시각은 HH:mm 문자열(미설정 시 null).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 없음"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<NotificationSettingsResponse> getNotificationSettings(UUID userId);

    /**
     * @param body   새 목표(분). 음수·24시간 초과는 400
     * @param userId 본인
     * @return 본문 없는 204. 서버가 직전 목표를 <b>하루치만</b> 보존하므로, 지연 업로드된 어제 데이터는
     *         어제의 목표로 판정된다
     */
    @Operation(summary = "스크린타임 목표 수정",
            description = "일일 스크린타임 목표(분)를 수정. 음수는 400. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "목표값 누락/음수"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateScreenTimeGoal(ScreenTimeGoalUpdateRequest body, UUID userId);

    /**
     * @param body   새 목표(분). 음수·24시간 초과는 400
     * @param userId 본인
     * @return 본문 없는 204. 직전 목표는 하루치만 보존된다(스크린타임 목표와 같은 규칙)
     */
    @Operation(summary = "집중 시간 목표 수정",
            description = "일일 집중 시간 목표(분)를 수정. 음수는 400. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "목표값 누락/음수"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateFocusTimeGoal(FocusTimeGoalUpdateRequest body, UUID userId);

    /**
     * @param body   선택한 직군. 폐기된 직군이면 400
     * @param userId 본인
     * @return 본문 없는 204. 직군을 바꿔도 <b>이미 채택한 집중 태그는 그대로</b>다 —
     *         직군은 추천 프리셋만 가른다
     */
    @Operation(summary = "준비 시험 카테고리(occupation) 저장",
            description = "온보딩에서 선택한 시험 카테고리를 users.occupation 에 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateOccupation(OccupationUpdateRequest body, UUID userId);

    /**
     * @param body   공개 범위(FRIENDS/PUBLIC)
     * @param userId 본인
     * @return 본문 없는 204. 이 값은 <b>세부 차트(heatmap)</b>에만 걸린다 —
     *         스트릭·오늘 집중 요약은 범위와 무관하게 공개된다
     */
    @Operation(summary = "통계 공개 범위 수정",
            description = "개인 통계 공개 범위(FRIENDS/PUBLIC)를 수정. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "statVisibility 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateStatVisibility(StatVisibilityUpdateRequest body, UUID userId);

    /**
     * @param userId 본인
     * @return 활성 연동 목록(200). 해제한 연동은 빠지고, 게스트는 빈 배열이다
     */
    @Operation(summary = "소셜 연동 목록 조회",
            description = "연동된 소셜 계정 목록 반환. 게스트(연동 0개)는 빈 배열. 인증 없으면 401.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<List<SocialLinkResponse>> getSocialLinks(UUID userId);

    /**
     * @param provider 해제할 제공자
     * @param userId   본인
     * @return 본문 없는 204. 소프트딜리트라 같은 계정으로 다시 로그인하면 연동이 되살아난다.
     *         <b>마지막 하나는 해제할 수 없다</b>(409) — 로그인 수단이 사라지기 때문이다
     */
    @Operation(summary = "소셜 연동 해제",
            description = "소셜 연동을 소프트딜리트로 해제. 마지막 활성 연동 해제 시도 시 409.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "400", description = "유효하지 않은 provider 값"),
        @ApiResponse(responseCode = "404", description = "연동 없음"),
        @ApiResponse(responseCode = "409", description = "마지막 소셜 연동"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<Void> unlinkSocialAccount(Provider provider, UUID userId);
}
