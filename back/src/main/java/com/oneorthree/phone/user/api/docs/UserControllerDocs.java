package com.oneorthree.phone.user.api.docs;

import com.oneorthree.phone.user.domain.Provider;
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

    @Operation(summary = "유저 정보 등록", description = "신규 유저 정보 등록")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> setupProfile(UUID userId, UserProfileSetupRequest body);

    @Operation(summary = "유저 정보 부분 수정", description = "기존 유저 정보 부분 수정")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "유효성 검사 실패"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateProfile(UUID userId, UserProfileUpdateRequest body);

    @Operation(summary = "닉네임 사용 가능 여부 확인",
            description = "닉네임이 사용 가능한지 판정한다 (GROMO-1215). 항상 200 + {available: boolean} — "
                    + "형식 위반(trim 후 2~10자 밖·빈문자열)도 available=false 로 내려간다(별도 4xx 없음). "
                    + "본인 제외 중복 검사라 자기 자신의 현재 닉네임은 available=true.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "판정 성공 — available 로 사용 가능 여부 반환"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<NicknameCheckResponse> checkNickname(String nickname, UUID userId);

    @Operation(summary = "유저 정보 조회", description = "기존 유저 정보 조회")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<UserProfileResponse> getProfile(UUID userId);

    @Operation(summary = "회원 탈퇴", description = "개인정보 파기 후 계정 삭제. 방장인 그룹은 위임 후 탈퇴 가능.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "탈퇴 완료"),
        @ApiResponse(responseCode = "400", description = "방장 위임 후 탈퇴 가능"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> withdraw(UUID userId);

    @Operation(summary = "스크린타임 권한 동의 상태 업데이트",
            description = "iOS Screen Time 권한 부여/취소 시 호출. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "업데이트 성공"),
        @ApiResponse(responseCode = "400", description = "granted 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateScreenTimePermission(UpdateScreenTimePermissionRequest body, UUID userId);

    @Operation(summary = "디바이스 토큰 등록",
            description = "앱 시작 시 FCM registration token 을 등록/갱신. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "등록 성공"),
        @ApiResponse(responseCode = "400", description = "deviceToken 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> registerDeviceToken(DeviceTokenRegisterRequest body, UUID userId);

    @Operation(summary = "디바이스 토큰 해제",
            description = "로그아웃/기기 변경 시 호출 — 이전 유저에게 푸시가 오발송되는 것 방지. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "해제 성공"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> clearDeviceToken(UUID userId);

    @Operation(summary = "알림·심야·소리 설정 저장",
            description = "유저 전역 알림/심야 모드/소리 설정 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "필수 필드 누락"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateNotificationSettings(NotificationSettingsRequest body, UUID userId);

    @Operation(summary = "알림·심야·소리 설정 조회",
            description = "유저 전역 알림/심야 모드/소리 설정 현재값 조회. 시각은 HH:mm 문자열(미설정 시 null).")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 없음"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<NotificationSettingsResponse> getNotificationSettings(UUID userId);

    @Operation(summary = "스크린타임 목표 수정",
            description = "일일 스크린타임 목표(분)를 수정. 음수는 400. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "목표값 누락/음수"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateScreenTimeGoal(ScreenTimeGoalUpdateRequest body, UUID userId);

    @Operation(summary = "집중 시간 목표 수정",
            description = "일일 집중 시간 목표(분)를 수정. 음수는 400. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "목표값 누락/음수"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateFocusTimeGoal(FocusTimeGoalUpdateRequest body, UUID userId);

    @Operation(summary = "준비 시험 카테고리(occupation) 저장",
            description = "온보딩에서 선택한 시험 카테고리를 users.occupation 에 저장. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "저장 성공"),
        @ApiResponse(responseCode = "400", description = "occupation 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateOccupation(OccupationUpdateRequest body, UUID userId);

    @Operation(summary = "통계 공개 범위 수정",
            description = "개인 통계 공개 범위(FRIENDS/PUBLIC)를 수정. 성공 시 204 반환.")
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "수정 성공"),
        @ApiResponse(responseCode = "400", description = "statVisibility 누락/유효하지 않은 값"),
        @ApiResponse(responseCode = "404", description = "유저 없음")
    })
    ResponseEntity<Void> updateStatVisibility(StatVisibilityUpdateRequest body, UUID userId);

    @Operation(summary = "소셜 연동 목록 조회",
            description = "연동된 소셜 계정 목록 반환. 게스트(연동 0개)는 빈 배열. 인증 없으면 401.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "조회 성공"),
        @ApiResponse(responseCode = "401", description = "인증 없음")
    })
    ResponseEntity<List<SocialLinkResponse>> getSocialLinks(UUID userId);

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
