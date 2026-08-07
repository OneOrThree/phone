package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.StatVisibility;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
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
import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
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

    @Mock
    private SocialAccountRepository socialAccountRepository;

    @Mock
    private OccupationInfoRepository occupationInfoRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private PinnedUserRepository pinnedUserRepository;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    // ── setupProfile ──────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 셋업 성공 → user 기본정보 + countryCode + screen/focus goal 반영")
    void setupProfileSuccess() {
        User user = User.builder().id(USER_ID).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder().userId(USER_ID).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileSetupRequest body = new UserProfileSetupRequest(
                "조재영", null, 120, 90, "KR");

        userService.setupProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("조재영");
        assertThat(user.getCountryCode()).isEqualTo("KR");
        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void setupProfileUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.setupProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("셋업 시 닉네임 중복 → UserException(NICKNAME_DUPLICATE), setNickname 미반영")
    void setupProfileDuplicateNickname() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        // 국가가 바뀌면 목표 이력의 발효일을 새 로컬 오늘로 정렬하므로 두 설정을 함께 읽는다(GROMO-1049).
        given(userScreenTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserScreenTimeSettings.builder().userId(USER_ID).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID))
                .willReturn(Optional.of(UserFocusTimeSettings.builder().userId(USER_ID).build()));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "새닉네임", null, null, "US");

        userService.updateProfile(USER_ID, body);

        assertThat(user.getNickname()).isEqualTo("새닉네임");
        assertThat(user.getCountryCode()).isEqualTo("US");
    }

    @Test
    @DisplayName("수정 시 타인이 쓰는 닉네임 → UserException(NICKNAME_DUPLICATE), 기존 닉네임 유지")
    void updateProfileDuplicateNickname() {
        User user = User.builder().id(USER_ID).nickname("기존닉네임").build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userRepository.existsByNicknameAndIdNot("남의닉", USER_ID)).willReturn(true);

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                "남의닉", null, null, null);

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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileUpdateRequest body = new UserProfileUpdateRequest(
                null, 150, 60, null);

        userService.updateProfile(USER_ID, body);

        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(150);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(60);
    }

    /**
     * 국가만 바꾸는 PATCH 에서도 목표 이력의 발효일을 새 로컬 오늘로 맞춰야 한다(코드리뷰) —
     * 안 맞추면 로컬 날짜가 뒤로 갈 때(KR→GB) 발효일이 미래로 남아 새 로컬 오늘이 직전 목표로
     * 판정된다. 단, 목표를 바꾼 게 아니므로 <b>직전 목표는 그대로 보존</b>해야 한다 —
     * changeGoal 을 현재값으로 부르면 previous 가 덮여 아직 지급 창 안에 있는 그 전날이
     * 틀린 목표로 지급된다(코드리뷰 후속).
     */
    @Test
    @DisplayName("국가만 바꾸면 발효일만 옮기고 직전 목표는 보존한다")
    void updateProfileCountryOnly_realignsDateButKeepsPreviousGoal() {
        User user = User.builder().id(USER_ID).countryCode("KR").build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(180).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(120).build();
        // 이미 목표를 바꿔 이력이 있는 상태 — 발효일은 미래(내일)로 둬서 정렬이 실제로 일어나게 한다.
        LocalDate tomorrow = LocalDate.now(CountryZoneResolver.resolve("GB")).plusDays(1);
        screen.changeGoal(60, tomorrow); // previous=180
        focus.changeGoal(30, tomorrow); // previous=120
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        // 목표 필드 없이 국가만 변경
        userService.updateProfile(USER_ID, new UserProfileUpdateRequest(null, null, null, "GB"));

        LocalDate today = LocalDate.now(CountryZoneResolver.resolve("GB"));
        // 현재 목표는 그대로, 발효일은 새 로컬 오늘로 당겨졌다.
        assertThat(screen.getDailyScreenTimeGoalMinutes()).isEqualTo(60);
        assertThat(focus.getDailyFocusTimeGoalMinutes()).isEqualTo(30);
        assertThat(screen.getGoalEffectiveFrom()).isEqualTo(today);
        assertThat(focus.getGoalEffectiveFrom()).isEqualTo(today);
        // 핵심 — 직전 목표가 보존돼 어제가 여전히 옛 목표로 판정된다.
        assertThat(screen.goalMinutesOn(today.minusDays(1))).isEqualTo(180);
        assertThat(focus.goalMinutesOn(today.minusDays(1))).isEqualTo(120);
    }

    /**
     * 이미 지난 발효일은 건드리지 않는다(코드리뷰) — 닉네임 저장 흐름이 countryCode 를 늘 함께
     * 보내므로, 과거 발효일까지 오늘로 당기면 목표를 바꾸고 며칠 뒤 닉네임만 고쳐도 그 사이의
     * 날들이 '변경 전'으로 잘못 라벨링돼 지급이 옛 목표로 나간다.
     */
    @Test
    @DisplayName("이미 지난 발효일은 국가 변경에도 그대로 둔다")
    void updateProfileCountryOnly_keepsPastEffectiveDate() {
        User user = User.builder().id(USER_ID).countryCode("GB").build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(180).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(120).build();
        // 며칠 전(5일 전)에 목표를 바꿔 둔 상태 — 그 이후 날들은 이미 새 목표가 적용된다.
        LocalDate changedAt = LocalDate.now(CountryZoneResolver.resolve("GB")).minusDays(5);
        screen.changeGoal(60, changedAt);
        focus.changeGoal(30, changedAt);
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        // 닉네임 저장 흐름은 countryCode 를 늘 함께 보낸다(ProfileEditScreen)
        userService.updateProfile(USER_ID, new UserProfileUpdateRequest("새닉", null, null, "GB"));

        LocalDate today = LocalDate.now(CountryZoneResolver.resolve("GB"));
        // 발효일이 당겨지지 않아 어제는 여전히 '변경 후'(새 목표)로 판정된다.
        assertThat(screen.getGoalEffectiveFrom()).isEqualTo(changedAt);
        assertThat(focus.getGoalEffectiveFrom()).isEqualTo(changedAt);
        assertThat(screen.goalMinutesOn(today.minusDays(1))).isEqualTo(60);
        assertThat(focus.goalMinutesOn(today.minusDays(1))).isEqualTo(30);
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateProfileUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateProfile(USER_ID, null))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── withdraw ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("탈퇴 성공 → focus·wallet·3 settings 정리 + 소셜연동 삭제·PII 파기·소프트딜리트 (하드삭제 X) GROMO-635")
    void withdrawSuccess() {
        User user = User.builder().id(USER_ID).nickname("조재영").refreshTokenHash("rt-hash").deviceToken("dt").build();
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsGroupOwnedBy(USER_ID)).willReturn(false);

        userService.withdraw(USER_ID);

        verify(focusSessionRepository).nullifyUser(USER_ID);
        verify(dailyFocusStatRepository).nullifyUser(USER_ID);
        verify(dailyScreenTimeStatRepository).nullifyUser(USER_ID);
        verify(userWalletRepository).deleteById(USER_ID);
        verify(userScreenTimeSettingsRepository).deleteById(USER_ID);
        verify(userFocusTimeSettingsRepository).deleteById(USER_ID);
        verify(userNotificationSettingsRepository).deleteById(USER_ID);
        verify(socialAccountRepository).deleteByUserId(USER_ID);
        verify(pinnedUserRepository).deleteAllInvolving(USER_ID);
        // 소프트딜리트 + PII 파기, 하드 삭제 안 함 (FK 위반 방지)
        assertThat(user.isDeleted()).isTrue();
        assertThat(user.getNickname()).isNull();
        assertThat(user.getRefreshTokenHash()).isNull();
        assertThat(user.getDeviceToken()).isNull();
        verify(userRepository, never()).delete(any());
    }

    @Test
    @DisplayName("탈퇴 시 친구 관계는 ACCEPTED·PENDING 모두 소프트 삭제된다 (GROMO-801)")
    void withdrawSoftDeletesFriendships() {
        User user = User.builder().id(USER_ID).build();
        User friend = User.builder().id(UUID.fromString("00000000-0000-0000-0000-000000000002")).build();
        // ACCEPTED = 이미 맺어진 친구, PENDING = 아직 수락 안 된 요청.
        // PENDING 을 안 끊으면 상대가 나중에 수락해 '탈퇴자와 친구'가 되는 경로가 열린다.
        Friendship accepted = Friendship.builder()
                .fromUser(user).toUser(friend).status(FriendshipStatus.ACCEPTED).build();
        Friendship pending = Friendship.builder()
                .fromUser(friend).toUser(user).status(FriendshipStatus.PENDING).build();
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsGroupOwnedBy(USER_ID)).willReturn(false);
        given(friendshipRepository.findActiveByUserId(USER_ID)).willReturn(List.of(accepted, pending));

        userService.withdraw(USER_ID);

        assertThat(accepted.getDeletedAt()).isNotNull();
        assertThat(pending.getDeletedAt()).isNotNull();
        // 배타 락으로 로드해야 정리 스캔 이후에 낀 친구요청·핀이 정리를 빠져나가지 않는다 (GROMO-801)
        verify(userRepository).findActiveByIdForUpdate(USER_ID);
        verify(userRepository, never()).findByIdAndIsDeletedFalse(USER_ID);
    }

    @Test
    @DisplayName("탈퇴가 막히면(방장) 친구·핀 정리도 일어나지 않는다 (GROMO-801)")
    void withdrawHostForbiddenSkipsFriendCleanup() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsGroupOwnedBy(USER_ID)).willReturn(true);

        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(GroupException.class);

        verify(friendshipRepository, never()).findActiveByUserId(any());
        verify(pinnedUserRepository, never()).deleteAllInvolving(any());
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void withdrawUserNotFound() {
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("소프트딜리트(탈퇴) 유저는 변경 경로에서 차단 — findByIdAndDeletedAtIsNull 로 404 (GROMO-635 리뷰)")
    void softDeletedUserBlockedOnUpdate() {
        // 탈퇴 유저는 deleted_at 세팅 → findByIdAndDeletedAtIsNull 빈 결과. 잔여 액세스토큰으로 재호출해도 차단됨.
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.CIVIL_SERVANT)).willReturn(true);
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.CIVIL_SERVANT))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("A-2 혼자 있는 소유 그룹은 탈퇴와 함께 자동 종료(ENDED)되고 탈퇴가 성공한다")
    void withdrawAutoEndsSoloOwnedGroup() {
        User user = User.builder().id(USER_ID).build();
        Group soloGroup = Group.builder().id(UUID.fromString("00000000-0000-0000-0000-0000000000aa"))
                .status(GroupStatus.WAITING).build();
        GroupMember ownerMembership = GroupMember.builder()
                .user(user).group(soloGroup).role(GroupMemberRole.OWNER).build();

        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findActiveOwnerMembershipsByUserId(USER_ID))
                .willReturn(List.of(ownerMembership));
        // 활성 멤버가 방장 1명뿐 → 자동 종료 대상
        given(groupMemberRepository.findByGroup(soloGroup)).willReturn(List.of(ownerMembership));
        // 자동 종료 후엔 활성 OWNER 행이 남지 않는다
        given(groupRepository.existsGroupOwnedBy(USER_ID)).willReturn(false);

        userService.withdraw(USER_ID);

        // 그룹은 ENDED, 방장 멤버십은 이탈 처리 → 탈퇴는 성공(소프트딜리트)
        assertThat(soloGroup.getStatus()).isEqualTo(GroupStatus.ENDED);
        assertThat(ownerMembership.isLeft()).isTrue();
        assertThat(user.isDeleted()).isTrue();
        verify(socialAccountRepository).deleteByUserId(USER_ID);
    }

    @Test
    @DisplayName("그룹 호스트인 유저 → GroupException(HOST_WITHDRAW), 삭제 안 함")
    void withdrawHostForbidden() {
        User user = User.builder().id(USER_ID).build();
        given(userRepository.findActiveByIdForUpdate(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.existsGroupOwnedBy(USER_ID)).willReturn(true);

        assertThatThrownBy(() -> userService.withdraw(USER_ID))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.HOST_WITHDRAW);
        // 호스트는 탈퇴 차단 → 소프트딜리트·소셜삭제 등 아무 변경 없음
        assertThat(user.isDeleted()).isFalse();
        verify(socialAccountRepository, never()).deleteByUserId(any());
    }

    // ── getProfile ────────────────────────────────────────────────────────

    @Test
    @DisplayName("프로필 조회 성공 → user·wallet·screen/focus settings 가 UserProfileResponse 로 매핑")
    void getProfileSuccess() {
        User user = User.builder()
                .id(USER_ID)
                .nickname("조재영")
                .countryCode("KR")
                .occupation(Occupation.UNIVERSITY)
                .build();
        UserWallet wallet = UserWallet.builder().userId(USER_ID).balance(500).build();
        UserScreenTimeSettings screen = UserScreenTimeSettings.builder()
                .userId(USER_ID).dailyScreenTimeGoalMinutes(120).build();
        UserFocusTimeSettings focus = UserFocusTimeSettings.builder()
                .userId(USER_ID).dailyFocusTimeGoalMinutes(90).build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileResponse response = userService.getProfile(USER_ID);

        assertThat(response.id()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
        assertThat(response.currency()).isEqualTo(500);
        assertThat(response.dailyScreenTimeGoalMinutes()).isEqualTo(120);
        assertThat(response.dailyFocusTimeGoalMinutes()).isEqualTo(90);
        assertThat(response.countryCode()).isEqualTo("KR");
        assertThat(response.statVisibility()).isEqualTo("FRIENDS"); // 기본값
        assertThat(response.occupation()).isEqualTo("UNIVERSITY"); // 준비 시험 enum name (GROMO-757)
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(userWalletRepository.findById(USER_ID)).willReturn(Optional.of(wallet));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(screen));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(focus));

        UserProfileResponse response = userService.getProfile(USER_ID);

        assertThat(response.occupation()).isNull();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getProfileUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));

        userService.registerDeviceToken(USER_ID, "apns-device-token");

        assertThat(user.getDeviceToken()).isEqualTo("apns-device-token");
    }

    @Test
    @DisplayName("디바이스 토큰 해제 → user.deviceToken null (등록 케이스와 대칭)")
    void clearDeviceToken() {
        User user = User.builder().id(USER_ID).deviceToken("fcm-registration-token").build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));

        userService.clearDeviceToken(USER_ID);

        assertThat(user.getDeviceToken()).isNull();
    }

    @Test
    @DisplayName("디바이스 토큰 해제 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void clearDeviceTokenUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.clearDeviceToken(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("디바이스 토큰 등록 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void registerDeviceTokenUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

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
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.UNIVERSITY)).willReturn(true);
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));

        userService.updateOccupation(USER_ID, Occupation.UNIVERSITY);

        assertThat(user.getOccupation()).isEqualTo(Occupation.UNIVERSITY);
    }

    @Test
    @DisplayName("occupation 저장 - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void updateOccupationUserNotFound() {
        given(occupationInfoRepository.existsByCodeAndDeletedAtIsNull(Occupation.UNIVERSITY)).willReturn(true);
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateOccupation(USER_ID, Occupation.UNIVERSITY))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        userService.updateFocusTimeGoal(USER_ID, 90);

        assertThat(settings.getDailyFocusTimeGoalMinutes()).isEqualTo(90);
    }

    @Test
    @DisplayName("집중 목표 수정 - 설정 없음 → UserException(NOT_FOUND)")
    void updateFocusTimeGoalNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateFocusTimeGoal(USER_ID, 90))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("집중 목표 수정 → GOAL_SET(goal_type=focus_time, goal_minutes) 발행")
    void updateFocusTimeGoalEmitsGoalSet() {
        UserFocusTimeSettings settings = UserFocusTimeSettings.builder().userId(USER_ID).build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).build()));
        given(userFocusTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

        userService.updateFocusTimeGoal(USER_ID, 90);

        verify(userActivityEventLogger).log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "focus_time", "goal_minutes", 90));
    }

    // ── updateScreenTimeGoal ──────────────────────────────────────────────

    @Test
    @DisplayName("스크린타임 목표 수정 → 값 반영 + GOAL_SET(goal_type=screen_time, goal_minutes) 발행")
    void updateScreenTimeGoalEmitsGoalSet() {
        UserScreenTimeSettings settings = UserScreenTimeSettings.builder().userId(USER_ID).build();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID))
                .willReturn(Optional.of(User.builder().id(USER_ID).build()));
        given(userScreenTimeSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));

        userService.updateStatVisibility(USER_ID, StatVisibility.PUBLIC);

        assertThat(user.getStatVisibility()).isEqualTo(StatVisibility.PUBLIC);
        verify(userActivityEventLogger).log(UserActivityEvent.STAT_VISIBILITY_UPDATED,
                Map.of("visibility", "PUBLIC"));
    }

    @Test
    @DisplayName("공개 범위 수정 - 존재하지 않는 유저 → UserException(NOT_FOUND), 이벤트 미발행")
    void updateStatVisibilityUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.updateStatVisibility(USER_ID, StatVisibility.PUBLIC))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(userActivityEventLogger, never())
                .log(any(UserActivityEvent.class), anyMap());
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

    @Test
    @DisplayName("알림 설정 저장 - nightStartTime·nightEndTime null 입력 → 기존 값 null 로 초기화")
    void updateNotificationSettingsNullNightTimesInitializeToNull() {
        // 기존에 시각이 설정된 settings
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID)
                .nightStartTime(LocalTime.of(22, 0))
                .nightEndTime(LocalTime.of(7, 0))
                .build();
        given(userNotificationSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

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
        given(userNotificationSettingsRepository.findById(USER_ID)).willReturn(Optional.of(settings));

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
        given(userNotificationSettingsRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.getNotificationSettings(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(socialAccountRepository.findAllByUserAndDeletedAtIsNull(user)).willReturn(List.of());

        List<SocialLinkResponse> result = userService.getSocialLinks(USER_ID);

        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("getSocialLinks - 존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getSocialLinksUserNotFound() {
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.getSocialLinks(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
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
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> userService.unlinkSocialAccount(USER_ID, Provider.APPLE))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }
}
