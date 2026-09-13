package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.Provider;
import com.oneorthree.phone.user.repository.domain.SocialAccount;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.repository.domain.UserWallet;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.willThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * UserService 단위 테스트. GROMO-561 로 설정이 스크린타임·포커스·알림 3테이블로 분리됨.
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    /**
     * 닉네임 변경 사실을 위로 올리는 통로 (GROMO-1660 · A22 ㋡) — 소비자(링크 표시정보 갱신)는
     * group 도메인에 있고, 이 클래스가 보는 것은 user 쪽 저장 규칙이라 발행만 목으로 확인한다.
     */
    @Mock
    private org.springframework.context.ApplicationEventPublisher eventPublisher;

    @InjectMocks
    private UserService userService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserQueryService userQueryService;

    @Mock
    private UserWalletRepository userWalletRepository;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;

    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;





    @Mock
    private SocialAccountRepository socialAccountRepository;

    @Mock
    private OccupationInfoRepository occupationInfoRepository;



    @Mock
    private UserActivityEventLogger userActivityEventLogger;



    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── setupProfile ──────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 셋업 성공 → user 기본정보 + countryCode + screen/focus goal 반영")
    void setupProfileSuccess() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(screen);
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(focus);

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "조재영", null, 120, 90, "KR");

        userService.setupProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("조재영");
        assertThat(user.getCountryCode()).isEqualTo("KR");
        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
        // 락 규율 (GROMO-1237): users 행 변경 트랜잭션은 처음부터 배타 락 — 무락 로드 금지(승급 교착 방지).
        verify(userQueryService).getCallerForUpdate(USER_ID);
        verify(userQueryService, never()).getTarget(USER_ID);
        verify(userQueryService, never()).getTargetForShare(USER_ID);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void setupProfileUserNotFound() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.setupProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("셋업 시 닉네임 중복 → UserException(NICKNAME_DUPLICATE), setNickname 미반영")
    void setupProfileDuplicateNickname() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userRepository.existsByNicknameAndIdNot("중복닉", USER_ID)).willReturn(true);

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "중복닉", null, 120, 90, "KR");

        assertThatThrownBy(() -> userService.setupProfile(USER_ID, body))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
        assertThat(user.getNickname()).isNull();
    }

    // ── updateProfile ─────────────────────────────────────────────────────

    @Test
    @DisplayName("부분 수정 → null 필드는 무시하고 전달된 필드만 갱신")
    void updateProfilePartial() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "새닉네임", null, null, "US", null);

        userService.updateProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("새닉네임");
        assertThat(user.getCountryCode()).isEqualTo("US");
    }

    @Test
    @DisplayName("수정 시 타인이 쓰는 닉네임 → UserException(NICKNAME_DUPLICATE), 기존 닉네임 유지")
    void updateProfileDuplicateNickname() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userRepository.existsByNicknameAndIdNot("남의닉", USER_ID)).willReturn(true);

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "남의닉", null, null, null, null);

        assertThatThrownBy(() -> userService.updateProfile(USER_ID, body))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
        assertThat(user.getNickname()).isEqualTo("기존닉네임");
    }

    @Test
    @DisplayName("목표 수정 → 전달된 screen/focus goal 만 해당 settings 에 반영")
    void updateProfileGoals() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(screen);
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(focus);

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                null, 150, 60, null, null);

        userService.updateProfile(USER_ID, body);

        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(150);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateProfileUserNotFound() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── 닉네임 규칙·중복확인 (GROMO-1215) ──────────────────────────────────

    @Test
    @DisplayName("닉네임 체크 — 미사용 닉네임 → available=true, trim 후 본인 제외로 조회")
    void nicknameCheckAvailable() {
        given(userRepository.existsByNicknameAndIdNot("새닉네임", USER_ID)).willReturn(false);

        assertThat(userService.isNicknameAvailable(USER_ID, " 새닉네임 ")).isTrue();

        // trim 된 값으로, 본인(userId) 제외 조건으로 조회했는지 — 저장 경로와 같은 규칙
        verify(userRepository).existsByNicknameAndIdNot("새닉네임", USER_ID);
    }

    @Test
    @DisplayName("닉네임 체크 — 타인이 쓰는 닉네임 → available=false")
    void nicknameCheckDuplicateUnavailable() {
        given(userRepository.existsByNicknameAndIdNot("남의닉", USER_ID)).willReturn(true);

        assertThat(userService.isNicknameAvailable(USER_ID, "남의닉")).isFalse();
    }

    @Test
    @DisplayName("닉네임 체크 — 자기 자신의 현재 닉네임 → available=true (본인 행 제외라 중복 아님)")
    void nicknameCheckSelfNicknameAvailable() {
        // 프로필 편집에서 자기 닉네임 그대로 저장이 "사용 불가"로 뜨면 안 된다 —
        // existsByNicknameAndIdNot 이 본인 행을 제외하므로 false 가 온다.
        given(userRepository.existsByNicknameAndIdNot("내닉네임", USER_ID)).willReturn(false);

        assertThat(userService.isNicknameAvailable(USER_ID, "내닉네임")).isTrue();

        verify(userRepository).existsByNicknameAndIdNot("내닉네임", USER_ID);
    }

    @Test
    @DisplayName("닉네임 체크 — 형식 위반(1자·11자·공백-only·null) → DB 조회 없이 available=false")
    void nicknameCheckFormatViolationsUnavailable() {
        assertThat(userService.isNicknameAvailable(USER_ID, "가")).isFalse();
        assertThat(userService.isNicknameAvailable(USER_ID, "가".repeat(11))).isFalse();
        assertThat(userService.isNicknameAvailable(USER_ID, "   ")).isFalse();
        assertThat(userService.isNicknameAvailable(USER_ID, null)).isFalse();

        verify(userRepository, never()).existsByNicknameAndIdNot(any(), any());
    }

    @Test
    @DisplayName("닉네임 체크 — 경계값 2자·10자는 형식 통과 → 중복 검사까지 진행")
    void nicknameCheckBoundaryLengthsValid() {
        given(userRepository.existsByNicknameAndIdNot("가나", USER_ID)).willReturn(false);
        given(userRepository.existsByNicknameAndIdNot("가".repeat(10), USER_ID)).willReturn(false);

        assertThat(userService.isNicknameAvailable(USER_ID, "가나")).isTrue();
        assertThat(userService.isNicknameAvailable(USER_ID, "가".repeat(10))).isTrue();
    }

    @Test
    @DisplayName("셋업 — 닉네임은 trim 되어 저장된다 (검사 규칙과 저장 값 일치)")
    void setupProfileTrimsNickname() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(screen);
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(focus);

        userService.setupProfile(USER_ID, new UserProfileSetupRequest(" 조재영 ", null, 120, 90, "KR"));

        assertThat(user.getNickname()).isEqualTo("조재영");
    }

    @Test
    @DisplayName("셋업 — 형식 위반 닉네임(1자) → NICKNAME_INVALID, 중복 검사·저장 안 함")
    void setupProfileInvalidNicknameRejected() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        assertThatThrownBy(() -> userService.setupProfile(
                USER_ID, new UserProfileSetupRequest("가", null, 120, 90, "KR")))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_INVALID);
        assertThat(user.getNickname()).isNull();
        verify(userRepository, never()).existsByNicknameAndIdNot(any(), any());
    }

    @Test
    @DisplayName("PATCH — 빈문자열 닉네임 → NICKNAME_INVALID, 기존 닉네임 유지 (회귀: 이전엔 \"\" 가 저장됐다)")
    void updateProfileEmptyNicknameBlocked() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        assertThatThrownBy(() -> userService.updateProfile(
                USER_ID, new UserProfileUpdateRequest("", null, null, null, null)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_INVALID);
        assertThat(user.getNickname()).isEqualTo("기존닉네임");
    }

    @Test
    @DisplayName("PATCH — 공백-only 닉네임 → NICKNAME_INVALID, 기존 닉네임 유지")
    void updateProfileBlankNicknameBlocked() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        assertThatThrownBy(() -> userService.updateProfile(
                USER_ID, new UserProfileUpdateRequest("   ", null, null, null, null)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_INVALID);
        assertThat(user.getNickname()).isEqualTo("기존닉네임");
    }

    @Test
    @DisplayName("PATCH — 11자 닉네임 → NICKNAME_INVALID (검사 API 와 같은 상한)")
    void updateProfileTooLongNicknameBlocked() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        assertThatThrownBy(() -> userService.updateProfile(
                USER_ID, new UserProfileUpdateRequest("가".repeat(11), null, null, null, null)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_INVALID);
        assertThat(user.getNickname()).isEqualTo("기존닉네임");
    }

    @Test
    @DisplayName("PATCH — 사전 검사 통과 후 유니크 제약 위반(TOCTOU 레이스) → NICKNAME_DUPLICATE 로 강하")
    void updateProfileToctouRaceDegradesToNicknameDuplicate() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userRepository.existsByNicknameAndIdNot("경합닉", USER_ID)).willReturn(false);
        // 체크와 저장 사이에 다른 유저가 같은 닉네임을 커밋 → flush 에서 uq_users_nickname 위반
        willThrow(new DataIntegrityViolationException("uq_users_nickname"))
                .given(userRepository).flush();

        assertThatThrownBy(() -> userService.updateProfile(
                USER_ID, new UserProfileUpdateRequest("경합닉", null, null, null, null)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
    }

    @Test
    @DisplayName("셋업 — 유니크 제약 위반(TOCTOU 레이스) → NICKNAME_DUPLICATE 로 강하")
    void setupProfileToctouRaceDegradesToNicknameDuplicate() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);
        given(userRepository.existsByNicknameAndIdNot("경합닉", USER_ID)).willReturn(false);
        willThrow(new DataIntegrityViolationException("uq_users_nickname"))
                .given(userRepository).flush();

        assertThatThrownBy(() -> userService.setupProfile(
                USER_ID, new UserProfileSetupRequest("경합닉", null, 120, 90, "KR")))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NICKNAME_DUPLICATE);
    }

    // ── language (GROMO-1659 D11 · 1692 계약) ────────────────────────────

    @Test
    @DisplayName("PATCH 에 language 가 오면 users.language 에 저장된다 — 푸시 렌더 언어의 정본")
    void updateProfileStoresLanguage() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updateProfile(USER_ID, new UserProfileUpdateRequest(null, null, null, null, "zh-Hant"));

        assertThat(user.getLanguage()).isEqualTo("zh-Hant");
    }

    @Test
    @DisplayName("language 가 null 이면 기존 값을 건드리지 않는다 — PATCH 의미론")
    void updateProfileLeavesLanguageWhenAbsent() {
        User user = User.builder().id(USER_ID).language("ja").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updateProfile(USER_ID, new UserProfileUpdateRequest(null, null, null, "KR", null));

        assertThat(user.getLanguage()).isEqualTo("ja");
        assertThat(user.getCountryCode()).isEqualTo("KR");
    }

    // ── 탈퇴 시 user 도메인이 맡는 몫 ────────────────────────────────────
    //
    // 탈퇴 절차 전체(그룹 정리 → 익명화 → 지갑·설정 → 친구 → PII)의 순서는
    // AccountWithdrawalServiceTest 가 지킨다. 여기서는 그중 user 가 실제로 하는 두 조각만 본다.

    @Test
    @DisplayName("지갑·설정 3종은 하드 삭제된다 — 남기면 재가입 시 옛 목표·권한이 되살아난다")
    void deleteWalletAndSettingsRemovesAllFour() {
        userService.deleteWalletAndSettings(USER_ID);

        verify(userWalletRepository).deleteById(USER_ID);
        verify(userScreenTimeSettingsRepository).deleteById(USER_ID);
        verify(userFocusTimeSettingsRepository).deleteById(USER_ID);
        verify(userNotificationSettingsRepository).deleteById(USER_ID);
    }

    @Test
    @DisplayName("PII 파기 + 소프트딜리트 + 소셜연동 삭제 — user 행은 지우지 않는다 (GROMO-635)")
    void erasePersonalDataKeepsRowButDestroysPii() {
        User user = User.builder().id(USER_ID)
                .nickname("조재영").refreshTokenHash("rt-hash").deviceToken("dt").countryCode("KR")
                .language("ja").build();

        userService.erasePersonalData(user);

        assertThat(user.isDeleted()).isTrue();
        assertThat(user.getNickname()).isNull();
        assertThat(user.getRefreshTokenHash()).isNull();
        assertThat(user.getDeviceToken()).isNull();
        assertThat(user.getCountryCode()).isNull();
        assertThat(user.getLanguage()).isNull();
        // 하드 삭제는 불가능하다 — 다수 테이블이 NOT NULL FK 로 이 행을 참조한다
        verify(userRepository, never()).delete(any());
        // 소셜 연동만 하드 삭제 — provider_id 가 PII 이고 같은 계정으로 재가입할 수 있어야 한다
        verify(socialAccountRepository).deleteByUserId(USER_ID);
    }


    @Test
    @DisplayName("소프트딜리트(탈퇴) 유저는 변경 경로에서 차단 — findByIdAndDeletedAtIsNull 로 404 (GROMO-635 리뷰)")
    void softDeletedUserBlockedOnUpdate() {
        // 탈퇴 유저는 deleted_at 세팅 → findByIdAndDeletedAtIsNull 빈 결과. 잔여 액세스토큰으로 재호출해도 차단됨.
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.CIVIL_SERVANT)).willReturn(true);
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.CIVIL_SERVANT))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── getProfile ────────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 조회 성공 → user·wallet·screen/focus settings 가 UserProfileResponse 로 매핑")
    void getProfileSuccess() {
        User user = User.builder()
                .id(USER_ID)
                .nickname("조재영")
                .countryCode("KR")
                .language("ja")
                .occupation(Occupation.UNIVERSITY)
                .build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(90).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(screen);
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(focus);

        UserProfileResponse response = userService.getProfile(USER_ID);

        assertThat(response.id()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
        assertThat(response.currency()).isEqualTo(500);
        assertThat(response.dailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(response.dailyFocusTimeGoalMinutes()).isEqualTo(90);
        assertThat(response.countryCode()).isEqualTo("KR");
        assertThat(response.statVisibility()).isEqualTo("FRIENDS"); // 기본값
        assertThat(response.occupation()).isEqualTo("UNIVERSITY"); // 준비 시험 enum name (GROMO-757)
        assertThat(response.timeZone()).isEqualTo("Asia/Seoul"); // 서버 날짜 버킷 존 (GROMO-1252)
        assertThat(response.language()).isEqualTo("ja"); // 앱이 보고한 표시 언어 그대로 (GROMO-1659, claude 리뷰)
    }

    @Test
    @DisplayName("GB 유저 프로필도 timeZone 은 Asia/Seoul — 날짜 축 KST 고정(GROMO-1259, 해외 유저는 L5 수용)")
    void getProfileReturnsKstZoneForGb() {
        User user = User.builder().id(USER_ID).nickname("oscar").countryCode("GB").build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID))
                .willReturn(UserWallet.builder().userId(USER_ID).balance(0).build());
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(
                UserScreenTimeSettings.builder().userId(USER_ID).dailyScreenTimeGoalMinutes(120).build());
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(
                UserFocusTimeSettings.builder().userId(USER_ID).dailyFocusTimeGoalMinutes(90).build());

        assertThat(userService.getProfile(USER_ID).timeZone()).isEqualTo("Asia/Seoul");
    }

    @Test
    @DisplayName("occupation 미설정 유저 → response.occupation() 은 null")
    void getProfileWithoutOccupationReturnsNull() {
        User user = User.builder()
                .id(USER_ID)
                .nickname("조재영")
                .countryCode("KR")
                .build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(90).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(userQueryService.getWallet(USER_ID)).willReturn(wallet);
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(screen);
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(focus);

        UserProfileResponse response = userService.getProfile(USER_ID);

        assertThat(response.occupation()).isNull();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getProfileUserNotFound() {
        given(userQueryService.getCaller(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.getProfile(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── updateScreenTimePermission ────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 권한 변경 성공 → screen settings 에 granted 값 반영")
    void updateScreenTimePermissionSuccess() {
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder().userId(USER_ID).build();
        // 배타 잠금 조회 (GROMO-1409·N50) — 내기 참여의 권한 가드(공유 잠금)와 설정 행에서 직렬화한다.
        given(userQueryService.getScreenTimeSettingsForUpdate(USER_ID)).willReturn(settings);

        UpdateScreenTimePermissionRequest request = mock(UpdateScreenTimePermissionRequest.class);
        given(request.getGranted()).willReturn(true);

        userService.updateScreenTimePermission(USER_ID, request);

        assertThat(settings.isScreenTimePermissionGranted()).isTrue();
        // 진입점이 둘(getScreenTimeSettings/…ForUpdate)이라 배타 잠금 쪽만 쓰였는지 둘 다 단언한다.
        verify(userQueryService).getScreenTimeSettingsForUpdate(USER_ID);
        verify(userQueryService, never()).getScreenTimeSettings(USER_ID);
    }

    @Test
    @DisplayName("스크린타임 권한 변경 - 설정 없음 → UserException(NOT_FOUND)")
    void updateScreenTimePermissionNotFound() {
        given(userQueryService.getScreenTimeSettingsForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateScreenTimePermission(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── registerDeviceToken ───────────────────────────────────────────────

    @Test
    @DisplayName("디바이스 토큰 등록 → user.deviceToken 갱신")
    void registerDeviceToken() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.registerDeviceToken(USER_ID, "apns-device-token");

        assertThat(user.getDeviceToken()).isEqualTo("apns-device-token");
    }

    @Test
    @DisplayName("디바이스 토큰 해제 → user.deviceToken null (등록 케이스와 대칭)")
    void clearDeviceToken() {
        User user = User.builder().id(USER_ID).deviceToken("fcm-registration-token").build();
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.clearDeviceToken(USER_ID);

        assertThat(user.getDeviceToken()).isNull();
    }

    @Test
    @DisplayName("디바이스 토큰 해제 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void clearDeviceTokenUserNotFound() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.clearDeviceToken(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("디바이스 토큰 등록 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void registerDeviceTokenUserNotFound() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.registerDeviceToken(USER_ID, "apns-device-token"))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── updateOccupation ──────────────────────────────────────────────────

    @Test
    @DisplayName("occupation 저장 → user.occupation 반영")
    void updateOccupationSuccess() {
        User user = User.builder().id(USER_ID).build();
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.UNIVERSITY)).willReturn(true);
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updateOccupation(USER_ID, Occupation.UNIVERSITY);

        assertThat(user.getOccupation()).isEqualTo(Occupation.UNIVERSITY);
    }

    @Test
    @DisplayName("occupation 저장 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateOccupationUserNotFound() {
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.UNIVERSITY)).willReturn(true);
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.UNIVERSITY))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("occupation 저장 - 비활성(soft-deleted) occupation → UserException(OCCUPATION_NOT_AVAILABLE) (GROMO-626 Codex P2)")
    void updateOccupationInactiveRejected() {
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.ETC)).willReturn(false);

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.ETC))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.OCCUPATION_NOT_AVAILABLE);
    }

    // ── updateFocusTimeGoal ───────────────────────────────────────────────

    @Test
    @DisplayName("집중 목표 수정 성공 → focus settings 에 반영")
    void updateFocusTimeGoalSuccess() {
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder().userId(USER_ID).build();
        // 목표 이력(GROMO-1049)의 발효일을 유저 로컬 기준으로 잡으려 유저를 함께 조회한다.
        given(userQueryService.getCallerForShare(USER_ID))
                .willReturn(User.builder().id(USER_ID).build());
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(settings);

        userService.updateFocusTimeGoal(USER_ID, 90);

        assertThat(settings.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
        // 락 규율 (GROMO-1237): users 는 읽기만(설정 테이블만 변경) — 공유 락, 배타 락·무락 로드 금지.
        verify(userQueryService).getCallerForShare(USER_ID);
        verify(userQueryService, never()).getTargetForUpdate(USER_ID);
        verify(userQueryService, never()).getTarget(USER_ID);
    }

    @Test
    @DisplayName("집중 목표 수정 - 설정 없음 → UserException(NOT_FOUND)")
    void updateFocusTimeGoalNotFound() {
        given(userQueryService.getCallerForShare(USER_ID))
                .willReturn(User.builder().id(USER_ID).build());
        given(userQueryService.getFocusTimeSettings(USER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateFocusTimeGoal(USER_ID, 90))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("집중 목표 수정 → GOAL_SET(goal_type=focus_time, goal_minutes) 발행")
    void updateFocusTimeGoalEmitsGoalSet() {
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userQueryService.getCallerForShare(USER_ID))
                .willReturn(User.builder().id(USER_ID).build());
        given(userQueryService.getFocusTimeSettings(USER_ID)).willReturn(settings);

        userService.updateFocusTimeGoal(USER_ID, 90);

        verify(userActivityEventLogger).log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "focus_time", "goal_minutes", 90));
    }

    // ── updateScreenTimeGoal ──────────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 목표 수정 → 값 반영 + GOAL_SET(goal_type=screen_time, goal_minutes) 발행")
    void updateScreenTimeGoalEmitsGoalSet() {
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder().userId(USER_ID).build();
        given(userQueryService.getCallerForShare(USER_ID))
                .willReturn(User.builder().id(USER_ID).build());
        given(userQueryService.getScreenTimeSettings(USER_ID)).willReturn(settings);

        userService.updateScreenTimeGoal(USER_ID, 120);

        assertThat(settings.getDailyScreenTimeGoalMinutes()).isEqualTo(120);
        verify(userActivityEventLogger).log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "screen_time", "goal_minutes", 120));
    }

    // ── updateStatVisibility ──────────────────────────────────────────────

    @Test
    @DisplayName("공개 범위 수정 → user.statVisibility 반영 + STAT_VISIBILITY_UPDATED(visibility) 발행")
    void updateStatVisibilityEmitsEvent() {
        User user = User.builder().id(USER_ID).build(); // 기본값 FRIENDS
        given(userQueryService.getCallerForUpdate(USER_ID)).willReturn(user);

        userService.updateStatVisibility(USER_ID, StatVisibility.PUBLIC);

        assertThat(user.getStatVisibility()).isEqualTo(StatVisibility.PUBLIC);
        verify(userActivityEventLogger).log(UserActivityEvent.STAT_VISIBILITY_UPDATED,
                Map.of("visibility", "PUBLIC"));
    }

    @Test
    @DisplayName("공개 범위 수정 - 존재하지 않는 유저 → UserException(NOT_FOUND), 이벤트 미발행")
    void updateStatVisibilityUserNotFound() {
        given(userQueryService.getCallerForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.updateStatVisibility(USER_ID, StatVisibility.PUBLIC))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
        verify(userActivityEventLogger, never())
                .log(any(UserActivityEvent.class), anyMap());
    }

    // ── updateNotificationSettings ────────────────────────────────────────

    @Test
    @DisplayName("알림·심야·소리 설정 저장 → notification settings 필드 반영")
    void updateNotificationSettings() {
        UserNotificationSettings settings = UserNotificationSettings.builder().userId(USER_ID).build();
        // 저장 경로는 배타 락 조회를 쓴다 (GROMO-1659) — 락 없는 조회로 스텁하면 직렬화가 빠져도 초록이 된다.
        given(userQueryService.getNotificationSettingsForUpdate(USER_ID)).willReturn(settings);

        NotificationSettingsRequest request = mock(NotificationSettingsRequest.class);
        given(request.getNotificationEnabled()).willReturn(true);
        given(request.getSoundEnabled()).willReturn(false);
        given(request.getNightModeEnabled()).willReturn(true);
        given(request.getNightStartTime()).willReturn("22:00");
        given(request.getNightEndTime()).willReturn("07:00");

        userService.updateNotificationSettings(USER_ID, request);

        assertThat(settings.isNotificationEnabled()).isTrue();
        assertThat(settings.isSoundEnabled()).isFalse();
        assertThat(settings.isNightModeEnabled()).isTrue();
        assertThat(settings.getNightStartTime()).isEqualTo(LocalTime.of(22, 0));
        assertThat(settings.getNightEndTime()).isEqualTo(LocalTime.of(7, 0));
    }

    @Test
    @DisplayName("알림 설정 저장 - 설정 없음 → UserException(NOT_FOUND)")
    void updateNotificationSettingsNotFound() {
        given(userQueryService.getNotificationSettingsForUpdate(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() ->
                userService.updateNotificationSettings(USER_ID, mock(NotificationSettingsRequest.class)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    @Test
    @DisplayName("알림 설정 저장 - nightStartTime·nightEndTime null 입력 → 기존 값 null 로 초기화")
    void updateNotificationSettingsNullNightTimesInitializeToNull() {
        // 기존에 시각이 설정된 settings
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID)
                .nightStartTime(LocalTime.of(22, 0))
                .nightEndTime(LocalTime.of(7, 0))
                .build();
        given(userQueryService.getNotificationSettingsForUpdate(USER_ID)).willReturn(settings);

        NotificationSettingsRequest request = mock(NotificationSettingsRequest.class);
        given(request.getNotificationEnabled()).willReturn(true);
        given(request.getSoundEnabled()).willReturn(true);
        given(request.getNightModeEnabled()).willReturn(false);
        given(request.getNightStartTime()).willReturn(null);
        given(request.getNightEndTime()).willReturn(null);

        userService.updateNotificationSettings(USER_ID, request);

        // null 입력 시 기존 값이 null 로 초기화되어야 함
        assertThat(settings.getNightStartTime()).isNull();
        assertThat(settings.getNightEndTime()).isNull();
    }

    // ── getNotificationSettings ───────────────────────────────────────────

    @Test
    @DisplayName("알림 설정 조회 성공 → notification settings 가 응답으로 매핑(시각은 HH:mm)")
    void getNotificationSettingsSuccess() {
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID)
                .notificationEnabled(true)
                .soundEnabled(false)
                .nightModeEnabled(true)
                .nightStartTime(LocalTime.of(22, 0))
                .nightEndTime(LocalTime.of(7, 0))
                .build();
        given(userQueryService.getNotificationSettings(USER_ID)).willReturn(settings);

        NotificationSettingsResponse response = userService.getNotificationSettings(USER_ID);

        assertThat(response.notificationEnabled()).isTrue();
        assertThat(response.soundEnabled()).isFalse();
        assertThat(response.nightModeEnabled()).isTrue();
        assertThat(response.nightStartTime()).isEqualTo("22:00");
        assertThat(response.nightEndTime()).isEqualTo("07:00");
    }

    @Test
    @DisplayName("알림 설정 조회 - 설정 없음 → UserException(NOT_FOUND)")
    void getNotificationSettingsNotFound() {
        given(userQueryService.getNotificationSettings(USER_ID)).willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.getNotificationSettings(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── getSocialLinks ────────────────────────────────────────────────────

    @Test
    @DisplayName("활성 연동 2개 유저 → getSocialLinks → 리스트 2개 반환, provider·linkedAt 필드 매핑")
    void getSocialLinksReturnsTwoAccounts() {
        User user = User.builder().id(USER_ID).build();
        Instant appleTime = Instant.parse("2025-03-01T12:00:00Z");
        Instant googleTime = Instant.parse("2025-04-10T09:30:00Z");
        SocialAccount appleAccount = SocialAccount.builder()
                .user(user).provider(Provider.APPLE).providerId("apple-sub")
                .createdAt(appleTime).build();
        SocialAccount googleAccount = SocialAccount.builder()
                .user(user).provider(Provider.GOOGLE).providerId("google-sub")
                .createdAt(googleTime).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNull(user))
                .willReturn(List.of(appleAccount, googleAccount));

        List<SocialLinkResponse> result = userService.getSocialLinks(USER_ID);

        assertThat(result).hasSize(2);
        assertThat(result.get(0).provider()).isEqualTo("APPLE");
        assertThat(result.get(0).linkedAt()).isEqualTo(appleTime);
        assertThat(result.get(1).provider()).isEqualTo("GOOGLE");
        assertThat(result.get(1).linkedAt()).isEqualTo(googleTime);
    }

    @Test
    @DisplayName("게스트 유저(소셜 연동 0개) → getSocialLinks → 빈 리스트 반환")
    void getSocialLinksReturnsEmptyForGuest() {
        User user = User.builder().id(USER_ID).isGuest(true).build();
        given(userQueryService.getCaller(USER_ID)).willReturn(user);
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNull(user)).willReturn(List.of());

        List<SocialLinkResponse> result = userService.getSocialLinks(USER_ID);

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("getSocialLinks - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getSocialLinksUserNotFound() {
        given(userQueryService.getCaller(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.getSocialLinks(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }

    // ── unlinkSocialAccount ───────────────────────────────────────────────

    @Test
    @DisplayName("활성 연동 2개 중 1개 해제 → 잠금 쿼리 호출, deletedAt 세팅, 나머지 유지")
    void unlinkSocialAccountSetsDeletedAt() {
        User user = User.builder().id(USER_ID).build();
        SocialAccount appleAccount = SocialAccount.builder()
                .user(user).provider(Provider.APPLE).providerId("apple-sub").build();
        SocialAccount googleAccount = SocialAccount.builder()
                .user(user).provider(Provider.GOOGLE).providerId("google-sub").build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        // 비관적 잠금 쿼리가 활성 연동 전체를 반환 — count·대상 계정 확보를 원자적으로 수행
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNullForUpdate(user))
                .willReturn(List.of(appleAccount, googleAccount));

        userService.unlinkSocialAccount(USER_ID, Provider.APPLE);

        // 잠금 쿼리가 실제로 호출되었는지 검증
        verify(socialAccountRepository).findAllByUserAndDeletedAtIsNullForUpdate(user);
        assertThat(appleAccount.getDeletedAt()).isNotNull();
        assertThat(googleAccount.getDeletedAt()).isNull();
    }

    @Test
    @DisplayName("마지막 활성 연동 1개 해제 시도 → UserException(LAST_SOCIAL_ACCOUNT) 409")
    void unlinkSocialAccountLastOneThrows409() {
        User user = User.builder().id(USER_ID).build();
        SocialAccount googleAccount = SocialAccount.builder()
                .user(user).provider(Provider.GOOGLE).providerId("google-sub").build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNullForUpdate(user))
                .willReturn(List.of(googleAccount));

        assertThatThrownBy(() -> userService.unlinkSocialAccount(USER_ID, Provider.GOOGLE))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.LAST_SOCIAL_ACCOUNT);
        // deletedAt 이 세팅되지 않아야 함
        assertThat(googleAccount.getDeletedAt()).isNull();
    }

    @Test
    @DisplayName("미연동 provider 해제 시도 → UserException(SOCIAL_ACCOUNT_NOT_FOUND) 404")
    void unlinkSocialAccountNotLinkedThrows404() {
        User user = User.builder().id(USER_ID).build();
        given(userQueryService.getCallerForShare(USER_ID)).willReturn(user);
        // KAKAO 연동 없음 — 빈 리스트 반환
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNullForUpdate(user))
                .willReturn(List.of());

        assertThatThrownBy(() -> userService.unlinkSocialAccount(USER_ID, Provider.KAKAO))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.SOCIAL_ACCOUNT_NOT_FOUND);
    }

    @Test
    @DisplayName("unlinkSocialAccount - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void unlinkSocialAccountUserNotFound() {
        given(userQueryService.getCallerForShare(USER_ID))
                .willThrow(new UserException(UserErrorCode.USER_NOT_FOUND));

        assertThatThrownBy(() -> userService.unlinkSocialAccount(USER_ID, Provider.APPLE))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.USER_NOT_FOUND);
    }
}
