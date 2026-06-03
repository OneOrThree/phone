package com.oneorthree.phone.service;

import com.oneorthree.phone.api.dto.request.UserProfileSetupRequest;
import com.oneorthree.phone.api.dto.request.UserProfileUpdateRequest;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.UserProfileResponse;
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

    @Transactional
    public void setupProfile(Long userId, UserProfileSetupRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("존재하지 않는 유저"));

        user.setNickname(body.getNickname());
        user.setBirthDate(body.getBirthDate());
        user.setGender(body.getGender());
        user.setDailyScreenTimeGoalMinutes(body.getDailyScreenTimeGoalMinutes());

        if ((body.getDayResetTime() == null) != (body.getTimeZone() == null)) {
            throw new IllegalArgumentException("dayResetTime과 timeZone은 함께 설정해야 합니다");
        }

        if (body.getDayResetTime() != null) {
            user.setDayResetTime(LocalTime.parse(body.getDayResetTime()));
        }

        if (body.getTimeZone() != null) {
            try {
                ZoneId.of(body.getTimeZone());
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("유효하지 않은 타임존: " + body.getTimeZone());
            }
            user.setTimeZone(body.getTimeZone());
        }
    }

    @Transactional
    public void updateProfile(Long userId, UserProfileUpdateRequest body) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("존재하지 않는 유저"));

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

        if (body.getDayResetTime() != null) {
            user.setDayResetTime(LocalTime.parse(body.getDayResetTime()));
        }

        if (body.getTimeZone() != null) {
            try {
                ZoneId.of(body.getTimeZone());
            } catch (DateTimeException e) {
                throw new IllegalArgumentException("유효하지 않은 타임존: " + body.getTimeZone());
            }
            user.setTimeZone(body.getTimeZone());
        }
    }

    public UserProfileResponse getProfile(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new RuntimeException("존재하지 않는 유저"));

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
                user.getDayResetTime() != null ? user.getDayResetTime().toString() : null
        );
    }
}
