package com.oneorthree.phone.user.service;

import com.oneorthree.phone.user.dto.UserProfileSetupRequest;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.focus.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.UserRepository;
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
        user.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());

        if (body.getTimeZone() != null) {
            try {
                ZoneId.of(body.getTimeZone());
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("유효하지 않은 타임존: " + body.getTimeZone());
            }
            user.setTimeZone(body.getTimeZone());
        }

        if (body.getDayStartTime() != null) {
            user.setDayStartTime(LocalTime.parse(body.getDayStartTime()));
        }
        if (body.getDayEndTime() != null) {
            user.setDayEndTime(LocalTime.parse(body.getDayEndTime()));
        }
        if (body.getReportTime() != null) {
            user.setReportTime(LocalTime.parse(body.getReportTime()));
        }
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
        if (body.getDailyScreenTimeGoalMinutes() != null) {
            user.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());
        }

        if (body.getTimeZone() != null) {
            try {
                ZoneId.of(body.getTimeZone());
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("유효하지 않은 타임존: " + body.getTimeZone());
            }
            user.setTimeZone(body.getTimeZone());
        }

        if (body.getDayStartTime() != null) {
            user.setDayStartTime(LocalTime.parse(body.getDayStartTime()));
        }
        if (body.getDayEndTime() != null) {
            user.setDayEndTime(LocalTime.parse(body.getDayEndTime()));
        }
        if (body.getReportTime() != null) {
            user.setReportTime(LocalTime.parse(body.getReportTime()));
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
        userRepository.delete(user);
    }

    public UserProfileResponse getProfile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        return new UserProfileResponse(
                user.getId(),
                user.getNickname(),
                user.getGender() != null ? user.getGender().name() : null,
                user.getBirthDate(),
                user.getProfileImageUrl(),
                user.getCurrency(),
                user.getCurrentTier() != null ? user.getCurrentTier().name() : null,
                user.getDailyScreenTimeGoalMinutes(),
                user.getTimeZone(),
                user.getDayStartTime() != null ? user.getDayStartTime().toString() : null,
                user.getDayEndTime() != null ? user.getDayEndTime().toString() : null,
                user.getReportTime() != null ? user.getReportTime().toString() : null
        );
    }

    @Transactional
    public void updateScreenTimePermission(UUID userId, UpdateScreenTimePermissionRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        user.setScreenTimePermissionGranted(request.getGranted());
    }
}
