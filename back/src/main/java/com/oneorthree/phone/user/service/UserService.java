package com.oneorthree.phone.user.service;

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
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.SocialAccountRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.SocialLinkResponse;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalTime;
import java.util.List;
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

    @Transactional
    public void setupProfile(UUID userId, UserProfileSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        user.setNickname(body.getNickname());
        user.setBirthDate(body.getBirthDate());
        user.setGender(body.getGender());
        if (body.getOccupation() != null) {
            user.setOccupation(body.getOccupation());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }
        if (body.getReportTime() != null) {
            user.setReportTime(LocalTime.parse(body.getReportTime()));
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
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (body.getNickname() != null) {
            user.setNickname(body.getNickname());
        }
        if (body.getBirthDate() != null) {
            user.setBirthDate(body.getBirthDate());
        }
        if (body.getGender() != null) {
            user.setGender(body.getGender());
        }
        if (body.getCountryCode() != null) {
            user.setCountryCode(body.getCountryCode());
        }
        if (body.getReportTime() != null) {
            user.setReportTime(LocalTime.parse(body.getReportTime()));
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
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (groupRepository.existsByHostId(userId)) {
            throw new GroupException(GroupErrorCode.HOST_WITHDRAW);
        }

        focusSessionRepository.nullifyUser(userId);
        dailyFocusStatRepository.nullifyUser(userId);
        dailyScreenTimeStatRepository.nullifyUser(userId);
        userWalletRepository.deleteById(userId);
        userScreenTimeSettingsRepository.deleteById(userId);
        userFocusTimeSettingsRepository.deleteById(userId);
        userNotificationSettingsRepository.deleteById(userId);
        userRepository.delete(user);
    }

    public UserProfileResponse getProfile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserWallet wallet = userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserScreenTimeSettings screenSettings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserFocusTimeSettings focusSettings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return new UserProfileResponse(
                user.getId(),
                user.getNickname(),
                user.getGender() != null ? user.getGender().name() : null,
                user.getBirthDate(),
                wallet.getBalance(),
                user.getCurrentTier(),
                screenSettings.getDailyScreenTimeGoalMinutes(),
                focusSettings.getDailyFocusTimeGoalMinutes(),
                user.getCountryCode(),
                user.getReportTime() != null ? user.getReportTime().toString() : null
        );
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
    }

    @Transactional
    public void updateFocusTimeGoal(UUID userId, int dailyFocusTimeGoalMinutes) {
        UserFocusTimeSettings settings = userFocusTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setDailyFocusTimeGoalMinutes(dailyFocusTimeGoalMinutes);
    }

    @Transactional
    public void updateOccupation(UUID userId, Occupation occupation) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setOccupation(occupation);
    }

    @Transactional
    public void registerDeviceToken(UUID userId, String deviceToken) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setDeviceToken(deviceToken);
    }

    /**
     * 유저의 활성 소셜 연동 목록 조회 (deletedAt IS NULL).
     * 게스트(연동 0개)는 빈 리스트 반환.
     */
    public List<SocialLinkResponse> getSocialLinks(UUID userId) {
        User user = userRepository.findById(userId)
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
        User user = userRepository.findById(userId)
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
