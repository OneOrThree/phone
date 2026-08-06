package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.common.util.CountryZoneResolver;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.user.domain.SocialAccount;
import com.oneorthree.phone.user.domain.StatVisibility;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.OccupationInfoRepository;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.NotificationSettingsResponse;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final UserFocusTimeSettingsRepository userFocusTimeSettingsRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final OccupationInfoRepository occupationInfoRepository;
    private final FriendshipRepository friendshipRepository;
    private final PinnedUserRepository pinnedUserRepository;
    private final UserActivityEventLogger userActivityEventLogger;

    @Transactional
    public void setupProfile(UUID userId, UserProfileSetupRequest body) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 닉네임 중복 방지 (GROMO-584) — 사전 검사로 409, 동시 요청 레이스는 DB 유니크 제약이 최종 방어
        if (userRepository.existsByNicknameAndIdNot(body.getNickname(), userId)) {
            throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
        }
        user.setNickname(body.getNickname());
        if (body.getOccupation() != null) {
            requireActiveOccupation(body.getOccupation());
            user.setOccupation(body.getOccupation());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }

        LocalDate today = todayOf(user);
        UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        screenSettings.changeGoal(body.getDailyScreenTimeGoalMinutes(), today);

        UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        focusSettings.changeGoal(body.getDailyFocusTimeGoalMinutes(), today);
    }

    @Transactional
    public void updateProfile(UUID userId, UserProfileUpdateRequest body) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (body.getNickname() != null) {
            // 본인 제외 중복 검사 — 자기 닉네임 재사용은 허용 (GROMO-584)
            if (userRepository.existsByNicknameAndIdNot(body.getNickname(), userId)) {
                throw new UserException(UserErrorCode.NICKNAME_DUPLICATE);
            }
            user.setNickname(body.getNickname());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }

        // 날짜는 한 번만 구해 두 설정에 같은 값을 넘긴다(코드리뷰) — 각자 todayOf 를 부르면
        // 자정을 걸칠 때 두 설정의 발효일이 하루 어긋나, 방금 끝난 날짜의 리포트가 한쪽은 새 목표로
        // 다른 쪽은 직전 목표로 판정된다. 국가 변경을 먼저 반영한 뒤 계산하는 것도 setupProfile 과 동일.
        LocalDate today = todayOf(user);
        // 국가가 바뀌면 목표를 안 바꿔도 발효일을 새 로컬 오늘로 맞춘다(코드리뷰) — 목표 필드가
        // 빠진 국가-only PATCH 에서는 changeGoal 이 아예 안 불려, 로컬 날짜가 뒤로 갈 때(KR→GB)
        // 발효일이 미래로 남고 새 로컬 오늘이 직전 목표로 판정된다. 목표값은 현재값 그대로 넘겨
        // 이력만 정렬한다(previous == current 가 되어 판정에 영향이 없다).
        boolean countryChanged = body.getCountryCode() != null;
        if (body.getDailyScreenTimeGoalMinutes() != null || countryChanged) {
            UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
            Integer requested = body.getDailyScreenTimeGoalMinutes();
            screenSettings.changeGoal(
                    requested != null ? requested : screenSettings.getDailyScreenTimeGoalMinutes(), today);
        }
        if (body.getDailyFocusTimeGoalMinutes() != null || countryChanged) {
            UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
            Integer requested = body.getDailyFocusTimeGoalMinutes();
            focusSettings.changeGoal(
                    requested != null ? requested : focusSettings.getDailyFocusTimeGoalMinutes(), today);
        }
    }

    /**
     * 목표 이력(GROMO-1049)의 기준일 — 유저 country_code 파생 존의 오늘.
     * 지급·판정이 유저 로컬 날짜 버킷을 쓰므로 발효일도 같은 기준이어야 어긋나지 않는다.
     */
    private LocalDate todayOf(User user) {
        return LocalDate.now(CountryZoneResolver.resolve(user.getCountryCode()));
    }

    @Transactional
    public void withdraw(UUID userId) {
        // 배타 락으로 로드 (GROMO-801) — 아래 소셜 관계 정리와 새 관계 생성(친구 요청·핀)을 직렬화한다.
        // 락이 없으면 READ COMMITTED 에서 정리 스캔 이후·커밋 이전에 낀 요청이 정리를 빠져나가 유령으로 남는다.
        User user = userRepository.findActiveByIdForUpdate(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // A-2: 계정 탈퇴 시 방장으로 남은 그룹 처리. 혼자 있는(활성 멤버 1명) 소유 그룹은 자동
        // 종료(ENDED)하고, 다른 멤버가 남은 소유 그룹이 있으면 위임이 필요하므로 아래에서 막는다.
        for (GroupMember ownerMembership : groupMemberRepository.findActiveOwnerMembershipsByUserId(userId)) {
            if (groupMemberRepository.findByGroup(ownerMembership.getGroup()).size() <= 1) {
                ownerMembership.leave();
                ownerMembership.getGroup().close();
            }
        }

        if (groupRepository.existsGroupOwnedBy(userId)) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }

        focusSessionRepository.nullifyUser(userId);
        dailyFocusStatRepository.nullifyUser(userId);
        dailyScreenTimeStatRepository.nullifyUser(userId);
        userWalletRepository.deleteById(userId);
        userScreenTimeSettingsRepository.deleteById(userId);
        userFocusTimeSettingsRepository.deleteById(userId);
        userNotificationSettingsRepository.deleteById(userId);

        // 소셜 관계 정리 (GROMO-801) — 친구는 소프트딜리트, 핀은 하드 삭제.
        // 탈퇴 자체는 이 정리가 없어도 성공한다(user row 가 남아 FK 가 유지되므로). 다만 정리하지 않으면
        // 상대방 화면에 닉네임이 파기된 '유령 친구'가 남고, 탈퇴자의 PENDING 요청을 수락하면 유령과 친구가 된다.
        // 조회 시점 필터가 아니라 여기서 끊는 이유: friendships 를 읽는 경로가 목록·카운트·요청·검색으로 흩어져 있어
        // 새 조회가 생길 때마다 필터를 빠뜨릴 위험이 크다. 한 번 끊으면 deletedAt IS NULL 이 이미 걸러준다.
        //
        // 위치가 메서드 끝인 이유: findActiveByUserId 가 friendships N 행에 배타 락을 건다. 그 유저가 낀 관계의
        // 동시 수락·거절이 이 락을 기다리므로, 관계와 무관한 정리(nullify·설정 삭제)를 먼저 끝내 락 보유 구간을 줄인다.
        // 앞의 벌크 쿼리들과는 대상 테이블이 겹치지 않아(auto-flush 미발생) 순서를 바꿔도 결과는 동일하다.
        Instant now = Instant.now();
        for (Friendship friendship : friendshipRepository.findActiveByUserId(userId)) {
            friendship.softDelete(now);
        }
        pinnedUserRepository.deleteAllInvolving(userId);

        // 개인정보 파기 + 소프트딜리트 (GROMO-635) — 하드 삭제 시 다수 FK(NOT NULL: social_accounts·focus_tags·
        // user_items·currency_transactions·group_members·league_arena_users 등) 위반으로 409(이력 있는 유저 탈퇴 불가).
        // → user row 는 남겨 소프트딜리트, 소셜연동·PII 만 파기. 집중 이력은 위 nullify 로 익명화.
        socialAccountRepository.deleteByUserId(userId);   // 소셜 연동 삭제 → 재로그인 차단 + provider_id 파기
        user.setNickname(null);
        user.setDeviceToken(null);
        user.setRefreshTokenHash(null);
        user.setCountryCode(null);
        user.setDeleted(true);
    }

    public UserProfileResponse getProfile(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserWallet wallet = userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 준비 시험(occupation) — enum name 문자열, 미설정이면 null (GROMO-757, 타 유저 공개 프로필과 동일 매핑)
        String occupation = user.getOccupation() != null ? user.getOccupation().name() : null;

        return new UserProfileResponse(
                user.getId(),
                user.getNickname(),
                wallet.getBalance(),
                screenSettings.getDailyScreenTimeGoalMinutes(),
                focusSettings.getDailyFocusTimeGoalMinutes(),
                user.getCountryCode(),
                user.getStatVisibility() != null ? user.getStatVisibility().name() : null,
                occupation
        );
    }

    /**
     * 개인 통계 공개 범위(FRIENDS/PUBLIC) 수정 + STAT_VISIBILITY_UPDATED 이벤트 발행.
     */
    @Transactional
    public void updateStatVisibility(UUID userId, StatVisibility statVisibility) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setStatVisibility(statVisibility);
        userActivityEventLogger.log(UserActivityEvent.STAT_VISIBILITY_UPDATED,
                Map.of("visibility", statVisibility.name()));
    }

    @Transactional
    public void updateScreenTimePermission(UUID userId, UpdateScreenTimePermissionRequest request) {
        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setScreenTimePermissionGranted(request.getGranted());
    }

    @Transactional
    public void updateScreenTimeGoal(UUID userId, int dailyScreenTimeGoalMinutes) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.changeGoal(dailyScreenTimeGoalMinutes, todayOf(user));
        userActivityEventLogger.log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "screen_time", "goal_minutes", dailyScreenTimeGoalMinutes));
    }

    @Transactional
    public void updateFocusTimeGoal(UUID userId, int dailyFocusTimeGoalMinutes) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserFocusTimeSettings settings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.changeGoal(dailyFocusTimeGoalMinutes, todayOf(user));
        userActivityEventLogger.log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "focus_time", "goal_minutes", dailyFocusTimeGoalMinutes));
    }

    @Transactional
    public void updateOccupation(UUID userId, Occupation occupation) {
        requireActiveOccupation(occupation);
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setOccupation(occupation);
    }

    // occupation 마스터(occupations)에서 활성(deleted_at IS NULL)인 값만 저장 허용 (GROMO-626, Codex P2).
    // soft-deleted 되어 GET /occupations 에서 빠진 직업을 저장 경로에서도 막아 목록↔저장 정합을 맞춘다.
    private void requireActiveOccupation(Occupation occupation) {
        if (occupation != null && !occupationInfoRepository.existsByCodeAndDeletedAtIsNull(occupation)) {
            throw new UserException(UserErrorCode.OCCUPATION_NOT_AVAILABLE);
        }
    }

    @Transactional
    public void registerDeviceToken(UUID userId, String deviceToken) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setDeviceToken(deviceToken);
    }

    // 토큰 해제 — 로그아웃/기기 변경 시 이전 유저에게 오발송되는 것 방지 (GROMO-528)
    @Transactional
    public void clearDeviceToken(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setDeviceToken(null);
    }

    /**
     * 유저의 활성 소셜 연동 목록 조회 (deletedAt IS NULL).
     * 게스트(연동 0개)는 빈 리스트 반환.
     */
    public List<SocialLinkResponse> getSocialLinks(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        return socialAccountRepository.findAllByUserAndDeletedAtIsNull(user).stream()
                .map(account -> new SocialLinkResponse(account.getProvider().name(), account.getCreatedAt()))
                .toList();
    }

    /**
     * 소셜 연동 해제 (소프트딜리트: deletedAt = now()).
     * 마지막 활성 연동 해제 시 409, 미연동 provider 해제 시 404.
     * 비관적 잠금(SELECT FOR UPDATE)으로 count-then-delete TOCTOU race condition 방지:
     * 동시 DELETE 2건이 각각 count를 읽어 409 가드를 우회하는 상황을 차단.
     */
    @Transactional
    public void unlinkSocialAccount(UUID userId, Provider provider) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        // 비관적 잠금으로 활성 연동 전체 조회 — count와 대상 계정을 한 번에 확보해 원자성 보장
        List<SocialAccount> activeAccounts = socialAccountRepository.findAllByUserAndDeletedAtIsNullForUpdate(user);
        SocialAccount socialAccount = activeAccounts.stream()
                .filter(a -> a.getProvider() == provider)
                .findFirst()
                .orElseThrow(() -> new UserException(UserErrorCode.SOCIAL_ACCOUNT_NOT_FOUND));
        if (activeAccounts.size() == 1) {
            throw new UserException(UserErrorCode.LAST_SOCIAL_ACCOUNT);
        }
        socialAccount.setDeletedAt(Instant.now());
    }

    /**
     * 알림 설정 현재값 조회 (GROMO-612).
     * LocalTime → "HH:mm" 매핑 (null 허용).
     */
    public NotificationSettingsResponse getNotificationSettings(UUID userId) {
        UserNotificationSettings s = userNotificationSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        return new NotificationSettingsResponse(
                s.isNotificationEnabled(),
                s.isSoundEnabled(),
                s.isNightModeEnabled(),
                s.getNightStartTime() != null ? s.getNightStartTime().toString() : null,
                s.getNightEndTime() != null ? s.getNightEndTime().toString() : null
        );
    }

    @Transactional
    public void updateNotificationSettings(UUID userId, NotificationSettingsRequest request) {
        UserNotificationSettings settings = userNotificationSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setNotificationEnabled(request.getNotificationEnabled());
        settings.setSoundEnabled(request.getSoundEnabled());
        settings.setNightModeEnabled(request.getNightModeEnabled());
        // null 입력 시 기존 값을 null 로 명시적 초기화; non-null 일 때만 parse 호출
        settings.setNightStartTime(
                request.getNightStartTime() == null ? null : LocalTime.parse(request.getNightStartTime()));
        settings.setNightEndTime(
                request.getNightEndTime() == null ? null : LocalTime.parse(request.getNightEndTime()));
    }
}
