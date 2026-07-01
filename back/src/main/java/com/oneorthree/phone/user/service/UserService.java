package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.domain.Occupation;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserFocusTimeSettings;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.user.repository.UserFocusTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalTime;
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

    @Transactional
    public void updateNotificationSettings(UUID userId, NotificationSettingsRequest request) {
        UserNotificationSettings settings = userNotificationSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setNotificationEnabled(request.getNotificationEnabled());
        settings.setSoundEnabled(request.getSoundEnabled());
        settings.setNightModeEnabled(request.getNightModeEnabled());
        if (request.getNightStartTime() != null) {
            settings.setNightStartTime(LocalTime.parse(request.getNightStartTime()));
        }
        if (request.getNightEndTime() != null) {
            settings.setNightEndTime(LocalTime.parse(request.getNightEndTime()));
        }
    }
}
