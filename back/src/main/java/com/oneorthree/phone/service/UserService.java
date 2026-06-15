package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.request.UserProfileSetupRequest;
import com.oneorthree.phone.api.dto.request.UserProfileUpdateRequest;
import com.oneorthree.phone.domain.room.Room;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.RoomHostCannotWithdrawException;
import com.oneorthree.phone.exception.UserNotFoundException;
import com.oneorthree.phone.repository.focus.DailyFocusStatRepository;
import com.oneorthree.phone.repository.focus.FocusSessionRepository;
import com.oneorthree.phone.repository.room.RoomRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.user.UserProfileResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.LocalTime;
import java.time.ZoneId;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;
    private final RoomRepository roomRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;

    @Transactional
    public void setupProfile(Long userId, UserProfileSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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
    public void updateProfile(Long userId, UserProfileUpdateRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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
    public void withdraw(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        if (roomRepository.existsByHostId(userId)) {
            throw new RoomHostCannotWithdrawException();
        }

        focusSessionRepository.nullifyUser(userId);
        dailyFocusStatRepository.nullifyUser(userId);
        userRepository.delete(user);
    }

    public UserProfileResponse getProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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
}
