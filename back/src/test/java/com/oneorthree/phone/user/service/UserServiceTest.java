package com.oneorthree.phone.user.service;

import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.Gender;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * UserService 단위 테스트. GROMO-561 로 설정이 스크린타임·포커스·알림 3테이블로 분리됨.
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @InjectMocks
    private UserService userService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private UserWalletRepository userWalletRepository;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    @Mock
    private UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;

    @Mock
    private UserNotificationSettingsRepository userNotificationSettingsRepository;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private DailyScreenTimeStatRepository dailyScreenTimeStatRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── setupProfile ──────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 셋업 성공 → user 기본정보 + countryCode·reportTime + screen/focus goal 반영")
    void setupProfileSuccess() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "조재영", LocalDate.of(2001, 3, 3), Gender.MALE, null, 120, 90, "KR", "21:00");

        userService.setupProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("조재영");
        assertThat(user.getBirthDate()).isEqualTo(LocalDate.of(2001, 3, 3));
        assertThat(user.getGender()).isEqualTo(Gender.MALE);
        assertThat(user.getCountryCode()).isEqualTo("KR");
        assertThat(user.getReportTime()).isEqualTo(LocalTime.of(21, 0));
        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void setupProfileUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.setupProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateProfile ─────────────────────────────────────────────────────

    @Test
    @DisplayName("부분 수정 → null 필드는 무시하고 전달된 필드만 갱신")
    void updateProfilePartial() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").gender(Gender.FEMALE).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "새닉네임", null, null, null, null, "US", null);

        userService.updateProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("새닉네임");
        assertThat(user.getGender()).isEqualTo(Gender.FEMALE);
        assertThat(user.getCountryCode()).isEqualTo("US");
    }

    @Test
    @DisplayName("목표 수정 → 전달된 screen/focus goal 만 해당 settings 에 반영")
    void updateProfileGoals() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                null, null, null, 150, 60, null, null);

        userService.updateProfile(USER_ID, body);

        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(150);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateProfileUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── withdraw ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("탈퇴 성공 → focus·wallet·3 settings 정리 후 유저 삭제")
    void withdrawSuccess() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsByHostId(USER_ID)).willReturn(false);

        userService.withdraw(USER_ID);

        verify(focusSessionRepository).nullifyUser(USER_ID);
        verify(dailyFocusStatRepository).nullifyUser(USER_ID);
        verify(dailyScreenTimeStatRepository).nullifyUser(USER_ID);
        verify(userWalletRepository).deleteById(USER_ID);
        verify(userScreenTimeSettingsRepository).deleteById(USER_ID);
        verify(userFocusTimeSettingsRepository).deleteById(USER_ID);
        verify(userNotificationSettingsRepository).deleteById(USER_ID);
        verify(userRepository).delete(user);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void withdrawUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("그룹 호스트인 유저 → GroupException(HOST_WITHDRAW), 삭제 안 함")
    void withdrawHostForbidden() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsByHostId(USER_ID)).willReturn(true);

        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);
        verify(userRepository, never()).delete(user);
    }

    // ── getProfile ────────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 조회 성공 → user·wallet·screen/focus settings 가 UserProfileResponse 로 매핑")
    void getProfileSuccess() {
        User user = User.builder()
                .id(USER_ID)
                .nickname("조재영")
                .gender(Gender.MALE)
                .birthDate(LocalDate.of(2001, 3, 3))
                .currentTier(3)
                .countryCode("KR")
                .reportTime(LocalTime.of(21, 0))
                .build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(90).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileResponse response = userService.getProfile(USER_ID);

        assertThat(response.id()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
        assertThat(response.gender()).isEqualTo("MALE");
        assertThat(response.birthDate()).isEqualTo(LocalDate.of(2001, 3, 3));
        assertThat(response.currency()).isEqualTo(500);
        assertThat(response.currentTier()).isEqualTo(3);
        assertThat(response.dailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(response.dailyFocusTimeGoalMinutes()).isEqualTo(90);
        assertThat(response.countryCode()).isEqualTo("KR");
        assertThat(response.reportTime()).isEqualTo("21:00");
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getProfileUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.getProfile(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateScreenTimePermission ────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 권한 변경 성공 → screen settings 에 granted 값 반영")
    void updateScreenTimePermissionSuccess() {
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder().userId(USER_ID).build();
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        UpdateScreenTimePermissionRequest request = mock(UpdateScreenTimePermissionRequest.class);
        given(request.getGranted()).willReturn(true);

        userService.updateScreenTimePermission(USER_ID, request);

        assertThat(settings.isScreenTimePermissionGranted()).isTrue();
    }

    @Test
    @DisplayName("스크린타임 권한 변경 - 설정 없음 → UserException(NOT_FOUND)")
    void updateScreenTimePermissionNotFound() {
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateScreenTimePermission(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── registerDeviceToken ───────────────────────────────────────────────

    @Test
    @DisplayName("디바이스 토큰 등록 → user.deviceToken 갱신")
    void registerDeviceToken() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        userService.registerDeviceToken(USER_ID, "apns-device-token");

        assertThat(user.getDeviceToken()).isEqualTo("apns-device-token");
    }

    @Test
    @DisplayName("디바이스 토큰 등록 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void registerDeviceTokenUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.registerDeviceToken(USER_ID, "apns-device-token"))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateOccupation ──────────────────────────────────────────────────

    @Test
    @DisplayName("occupation 저장 → user.occupation 반영")
    void updateOccupationSuccess() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        userService.updateOccupation(USER_ID, Occupation.UNIVERSITY);

        assertThat(user.getOccupation()).isEqualTo(Occupation.UNIVERSITY);
    }

    @Test
    @DisplayName("occupation 저장 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateOccupationUserNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.UNIVERSITY))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateFocusTimeGoal ───────────────────────────────────────────────

    @Test
    @DisplayName("집중 목표 수정 성공 → focus settings 에 반영")
    void updateFocusTimeGoalSuccess() {
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        userService.updateFocusTimeGoal(USER_ID, 90);

        assertThat(settings.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
    }

    @Test
    @DisplayName("집중 목표 수정 - 설정 없음 → UserException(NOT_FOUND)")
    void updateFocusTimeGoalNotFound() {
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateFocusTimeGoal(USER_ID, 90))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateNotificationSettings ────────────────────────────────────────

    @Test
    @DisplayName("알림·심야·소리 설정 저장 → notification settings 필드 반영")
    void updateNotificationSettings() {
        UserNotificationSettings settings = UserNotificationSettings.builder().userId(USER_ID).build();
        given(userNotificationSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

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
        given(userNotificationSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() ->
                userService.updateNotificationSettings(USER_ID, mock(NotificationSettingsRequest.class)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }
}
