package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.domain.UserWallet;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.user.repository.UserWalletRepository;
import com.oneorthree.phone.user.dto.NotificationSettingsRequest;
import com.oneorthree.phone.user.dto.UpdateScreenTimePermissionRequest;
import com.oneorthree.phone.user.dto.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final UserWalletRepository userWalletRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;
    private final GroupRepository groupRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;

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

        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        settings.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());
        applyScreenTimeFields(settings, body.getTimeZone(),
                body.getDayStartTime(), body.getDayEndTime(), body.getReportTime());
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

        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (body.getDailyScreenTimeGoalMinutes() != null) {
            settings.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());
        }
        applyScreenTimeFields(settings, body.getTimeZone(),
                body.getDayStartTime(), body.getDayEndTime(), body.getReportTime());
    }

    private void applyScreenTimeFields(UserScreenTimeSettings settings, String timeZone,
                                       String dayStartTime, String dayEndTime, String reportTime) {
        if (timeZone != null) {
            try {
                ZoneId.of(timeZone);
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("유효하지 않은 타임존: " + timeZone);
            }
            settings.setTimeZone(timeZone);
        }
        if (dayStartTime != null) {
            settings.setDayStartTime(LocalTime.parse(dayStartTime));
        }
        if (dayEndTime != null) {
            settings.setDayEndTime(LocalTime.parse(dayEndTime));
        }
        if (reportTime != null) {
            settings.setReportTime(LocalTime.parse(reportTime));
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
        userWalletRepository.deleteById(userId);
        userScreenTimeSettingsRepository.deleteById(userId);
        userRepository.delete(user);
    }

    public UserProfileResponse getProfile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserWallet wallet = userWalletRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return new UserProfileResponse(
                user.getId(),
                user.getNickname(),
                user.getGender() != null ? user.getGender().name() : null,
                user.getBirthDate(),
                wallet.getBalance(),
                user.getCurrentTier(),
                settings.getDailyScreenTimeGoalMinutes(),
                settings.getTimeZone(),
                settings.getDayStartTime() != null ? settings.getDayStartTime().toString() : null,
                settings.getDayEndTime() != null ? settings.getDayEndTime().toString() : null,
                settings.getReportTime() != null ? settings.getReportTime().toString() : null
        );
    }

    @Transactional
    public void updateScreenTimePermission(UUID userId, UpdateScreenTimePermissionRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setScreenTimePermissionGranted(request.getGranted());
    }

    @Transactional
    public void registerDeviceToken(UUID userId, String deviceToken) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setDeviceToken(deviceToken);
    }

    @Transactional
    public void updateNotificationSettings(UUID userId, NotificationSettingsRequest request) {
        UserScreenTimeSettings settings = userScreenTimeSettingsRepository.findById(userId)
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
