package com.oneorthree.phone.user.service;

import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.Gender;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserService;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * UserService 단위 테스트 골격.
 *
 * <p>대상: 프로필 셋업/수정, 회원 탈퇴, 프로필 조회, 스크린타임 권한 변경.
 * 협력 객체는 모두 @Mock 으로 대체하고, given/when/then 으로 작성한다.
 *
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @InjectMocks
    private UserService userService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── setupProfile ──────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 셋업 성공 → 닉네임/생일/성별/목표시간 및 타임존·시간 필드 반영")
    void setupProfileSuccess() {
        // given: userRepository.findById(USER_ID) 가 User 반환, 모든 필드 채운 SetupRequest
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "조재영", LocalDate.of(2001, 3, 3), Gender.MALE, 120,
                "Asia/Seoul", "09:00", "23:00", "21:00");

        // when: userService.setupProfile(USER_ID, body)
        userService.setupProfile(USER_ID, body);

        // then: user 의 setter 들이 요청 값으로 반영됐는지 검증(필드 확인 또는 상태 검증)
        assertThat(user.getNickname()).isEqualTo("조재영");
        assertThat(user.getBirthDate()).isEqualTo(LocalDate.of(2001, 3, 3));
        assertThat(user.getGender()).isEqualTo(Gender.MALE);
        assertThat(user.getDailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(user.getTimeZone()).isEqualTo("Asia/Seoul");
        assertThat(user.getDayStartTime()).isEqualTo(LocalTime.of(9, 0));
        assertThat(user.getDayEndTime()).isEqualTo(LocalTime.of(23, 0));
        assertThat(user.getReportTime()).isEqualTo(LocalTime.of(21, 0));
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void setupProfileUserNotFound() {
        // given: userRepository.findById 가 Optional.empty()
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then: setupProfile 호출 시 UserException(UserErrorCode.NOT_FOUND)
        assertThatThrownBy(() -> userService.setupProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("유효하지 않은 타임존 → IllegalArgumentException")
    void setupProfileInvalidTimeZone() {
        // given: 유저는 존재하지만, body.getTimeZone() 이 "Invalid/Zone" 같은 잘못된 값
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "조재영", LocalDate.of(2001, 3, 3), Gender.MALE, 120,
                "Invalid/Zone", "09:00", "23:00", "21:00");

        // when & then: IllegalArgumentException, user.setTimeZone 미반영
        assertThatThrownBy(() -> userService.setupProfile(USER_ID, body))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(user.getTimeZone()).isNull();
    }

    // ── updateProfile ─────────────────────────────────────────────────────

    @Test
    @DisplayName("부분 수정 → null 필드는 무시하고 전달된 필드만 갱신")
    void updateProfilePartial() {
        // given: 기존 값이 채워진 user + nickname 만 채우고 나머지는 null 인 UpdateRequest
        User user = User.builder()
                .id(USER_ID)
                .nickname("기존닉네임")
                .gender(Gender.FEMALE)
                .dailyScreenTimeGoalMinutes(60)
                .timeZone("Asia/Seoul")
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "새닉네임", null, null, null, null, null, null, null);

        // when: updateProfile
        userService.updateProfile(USER_ID, body);

        // then: nickname 만 변경, 나머지 기존 값 유지
        assertThat(user.getNickname()).isEqualTo("새닉네임");             // 변경됨
        assertThat(user.getGender()).isEqualTo(Gender.FEMALE);                   // 유지
        assertThat(user.getDailyScreenTimeGoalMinutes()).isEqualTo(60); // 유지
        assertThat(user.getTimeZone()).isEqualTo("Asia/Seoul");         // 유지
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateProfileUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> userService.updateProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("유효하지 않은 타임존 → IllegalArgumentException")
    void updateProfileInvalidTimeZone() {
        // given: 유저는 존재하지만 timeZone 이 잘못된 값
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                null, null, null, null, "Invalid/Zone", null, null, null);

        // when & then
        assertThatThrownBy(() -> userService.updateProfile(USER_ID, body))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(user.getTimeZone()).isNull();
    }

    // ── withdraw ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("탈퇴 성공 → focusSession·dailyStat 유저 참조 해제 후 유저 삭제")
    void withdrawSuccess() {
        // given: 유저 존재 + 어떤 그룹의 방장도 아님
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsByHostId(USER_ID)).willReturn(false);

        // when
        userService.withdraw(USER_ID);

        // then: 집중 데이터 유저 참조 해제 후 유저 삭제
        verify(focusSessionRepository).nullifyUser(USER_ID);
        verify(dailyFocusStatRepository).nullifyUser(USER_ID);
        verify(userRepository).delete(user);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void withdrawUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("그룹 호스트인 유저 → GroupException(HOST_WITHDRAW), 삭제 안 함")
    void withdrawHostForbidden() {
        // given: 유저는 존재하지만 어떤 그룹의 방장임
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsByHostId(USER_ID)).willReturn(true);

        // when & then: 예외 발생 + 삭제 미호출
        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);
        verify(userRepository, never()).delete(user);
    }

    // ── getProfile ────────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 조회 성공 → User 필드가 UserProfileResponse 로 매핑")
    void getProfileSuccess() {
        // given: 모든 필드가 채워진 User
        User user = User.builder()
                .id(USER_ID)
                .nickname("조재영")
                .gender(Gender.MALE)
                .birthDate(LocalDate.of(2001, 3, 3))
                .profileImageUrl("http://img/profile.png")
                .currency(500)
                .currentTier(3)
                .dailyScreenTimeGoalMinutes(120)
                .timeZone("Asia/Seoul")
                .dayStartTime(LocalTime.of(9, 0))
                .dayEndTime(LocalTime.of(23, 0))
                .reportTime(LocalTime.of(21, 0))
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        // when
        UserProfileResponse response = userService.getProfile(USER_ID);

        // then: enum 은 name(), LocalTime 은 toString() 으로 매핑됨
        assertThat(response.id()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
        assertThat(response.gender()).isEqualTo("MALE");
        assertThat(response.birthDate()).isEqualTo(LocalDate.of(2001, 3, 3));
        assertThat(response.profileImageUrl()).isEqualTo("http://img/profile.png");
        assertThat(response.currency()).isEqualTo(500);
        assertThat(response.currentTier()).isEqualTo(3);
        assertThat(response.dailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(response.timeZone()).isEqualTo("Asia/Seoul");
        assertThat(response.dayStartTime()).isEqualTo("09:00");
        assertThat(response.dayEndTime()).isEqualTo("23:00");
        assertThat(response.reportTime()).isEqualTo("21:00");
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getProfileUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> userService.getProfile(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── updateScreenTimePermission ────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 권한 변경 성공 → granted 값 반영")
    void updateScreenTimePermissionSuccess() {
        // given: 유저 존재 + granted=true 요청 (request 는 all-args 생성자가 없어 mock 사용)
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));

        UpdateScreenTimePermissionRequest request = mock(UpdateScreenTimePermissionRequest.class);
        given(request.getGranted()).willReturn(true);

        // when
        userService.updateScreenTimePermission(USER_ID, request);

        // then
        assertThat(user.isScreenTimePermissionGranted()).isTrue();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateScreenTimePermissionUserNotFound() {
        // given
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> userService.updateScreenTimePermission(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }
}
