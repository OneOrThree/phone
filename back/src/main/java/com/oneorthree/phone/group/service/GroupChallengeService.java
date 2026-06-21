package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserNotFoundException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupChallengeService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupChallengeRepository groupChallengeRepository;

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm:ss");

    public List<GroupChallengeResponse> getChallenges(Long groupId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        return groupChallengeRepository.findByGroupOrderByCreatedAtDesc(group)
                .stream()
                .map(c -> GroupChallengeResponse.builder()
                        .id(c.getId())
                        .missionType(c.getMissionType())
                        .missionCategory(c.getMissionCategory())
                        .durationMinutes(c.getDurationMinutes())
                        .windowStart(toLocalTimeString(c.getWindowStart(), c.getTimeZone()))
                        .windowEnd(toLocalTimeString(c.getWindowEnd(), c.getTimeZone()))
                        .timeZone(c.getTimeZone())
                        .canParticipate(c.getMissionCategory() == MissionCategory.FOCUS
                                || user.isScreenTimePermissionGranted())
                        .status(c.getStatus())
                        .createdAt(c.getCreatedAt())
                        .build())
                .toList();
    }

    @Transactional
    public CreateChallengeResponse createChallenge(Long groupId, Long userId, CreateChallengeRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        Optional<GroupMember> groupMember = groupMemberRepository.findByUserAndGroup(user, group);
        if (groupMember.isEmpty()) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
        if (groupMember.get().getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        if (request.getMissionType() == MissionType.DURATION) {
            if (request.getDurationMinutes() == null || request.getDurationMinutes() <= 0) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
        } else if (request.getMissionType() == MissionType.TIME_WINDOW) {
            if (request.getWindowStart() == null || request.getWindowEnd() == null || request.getTimeZone() == null) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
            if (!request.getWindowEnd().isAfter(request.getWindowStart())) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
            try {
                ZoneId.of(request.getTimeZone());
            } catch (DateTimeException e) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
        } else {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        if (request.getMissionType() == MissionType.DURATION) {
            if (groupChallengeRepository.existsByGroupAndMissionCategoryAndMissionTypeAndStatus(
                    group, request.getMissionCategory(), MissionType.DURATION, GroupChallengeStatus.ACTIVE)) {
                throw new GroupException(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
            }
        } else {
            if (groupChallengeRepository.existsOverlappingTimeWindow(
                    group, request.getMissionCategory(), request.getWindowStart(), request.getWindowEnd())) {
                throw new GroupException(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
            }
        }

        GroupChallenge savedChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .missionType(request.getMissionType())
                .missionCategory(request.getMissionCategory())
                .durationMinutes(request.getDurationMinutes())
                .windowStart(request.getWindowStart())
                .windowEnd(request.getWindowEnd())
                .timeZone(request.getTimeZone())
                .build());

        List<CreateChallengeResponse.NonParticipantDto> nonParticipants;
        if (request.getMissionCategory() == MissionCategory.SCREEN_TIME) {
            nonParticipants = groupMemberRepository.findByGroup(group).stream()
                    .map(GroupMember::getUser)
                    .filter(u -> !u.isScreenTimePermissionGranted())
                    .map(u -> CreateChallengeResponse.NonParticipantDto.builder()
                            .userId(u.getId())
                            .nickname(u.getNickname())
                            .build())
                    .toList();
        } else {
            nonParticipants = List.of();
        }

        return CreateChallengeResponse.builder()
                .id(savedChallenge.getId())
                .nonParticipants(nonParticipants)
                .build();
    }

    @Transactional
    public void deleteChallenge(Long groupId, Long challengeId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        if (groupMember.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        GroupChallenge groupChallenge = groupChallengeRepository.findByIdAndGroup(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupChallengeRepository.delete(groupChallenge);
    }

    // TIME_WINDOW 챌린지의 Instant를 timeZone 기준 "HH:mm:ss" 문자열로 변환.
    // DURATION 챌린지는 instant가 null → null 그대로 반환. timeZone이 null이면 UTC 기준.
    private String toLocalTimeString(Instant instant, String timeZone) {
        if (instant == null) {
            return null;
        }
        ZoneId zone = timeZone != null ? ZoneId.of(timeZone) : ZoneOffset.UTC;
        return LocalTime.ofInstant(instant, zone).format(TIME_FORMATTER);
    }
}
