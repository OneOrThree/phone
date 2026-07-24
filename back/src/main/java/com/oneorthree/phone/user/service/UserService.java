package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.Provider;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
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
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;
    private final SocialAccountRepository socialAccountRepository;
    private final OccupationInfoRepository occupationInfoRepository;
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

        UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        screenSettings.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());

        UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        focusSettings.setDailyFocusTimeGoalMinutes(body.getDailyFocusTimeGoalMinutes());
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

        if (body.getDailyScreenTimeGoalMinutes() != null) {
            UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
            screenSettings.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());
        }
        if (body.getDailyFocusTimeGoalMinutes() != null) {
            UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
            focusSettings.setDailyFocusTimeGoalMinutes(body.getDailyFocusTimeGoalMinutes());
        }
    }

    @Transactional
    public void withdraw(UUID userId) {
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

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
        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setDailyScreenTimeGoalMinutes(dailyScreenTimeGoalMinutes);
        userActivityEventLogger.log(UserActivityEvent.GOAL_SET,
                Map.of("goal_type", "screen_time", "goal_minutes", dailyScreenTimeGoalMinutes));
    }

    @Transactional
    public void updateFocusTimeGoal(UUID userId, int dailyFocusTimeGoalMinutes) {
        UserFocusTimeSettings settings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setDailyFocusTimeGoalMinutes(dailyFocusTimeGoalMinutes);
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
