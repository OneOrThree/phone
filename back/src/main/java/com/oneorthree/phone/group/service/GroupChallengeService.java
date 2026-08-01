package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateChallengeRequest;
import com.oneorthree.phone.group.dto.CreateChallengeResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserScreenTimeSettings;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupChallengeService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm:ss");

    public List<GroupChallengeResponse> getChallenges(UUID groupId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        boolean screenTimePermissionGranted = userScreenTimeSettingsRepository.findById(userId)
                .map(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .orElse(false);

        List<GroupChallenge> challenges =
                groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group);
        if (challenges.isEmpty()) {
            return List.of();
        }

        // N+1 방지: type 별 상세(duration/window)를 IN 절로 배치 로드해 challengeId 맵으로 조합
        List<UUID> challengeIds = challenges.stream().map(GroupChallenge::getId).toList();
        Map<UUID, GroupChallengeDuration> durations = groupChallengeDurationRepository
                .findByChallengeIdIn(challengeIds).stream()
                .collect(Collectors.toMap(GroupChallengeDuration::getChallengeId, Function.identity()));
        Map<UUID, GroupChallengeWindow> windows = groupChallengeWindowRepository
                .findByChallengeIdIn(challengeIds).stream()
                .collect(Collectors.toMap(GroupChallengeWindow::getChallengeId, Function.identity()));

        return challenges.stream()
                .map(c -> {
                    GroupChallengeDuration duration = durations.get(c.getId());
                    GroupChallengeWindow window = windows.get(c.getId());
                    return GroupChallengeResponse.builder()
                            .id(c.getId())
                            .missionType(c.getType())
                            .missionCategory(c.getCategory())
                            .durationMinutes(duration != null ? duration.getDurationMinutes() : null)
                            .windowStart(window != null ? toLocalTimeString(window.getWindowStartAt()) : null)
                            .windowEnd(window != null ? toLocalTimeString(window.getWindowEndAt()) : null)
                            .canParticipate(c.getCategory() == MissionCategory.FOCUS
                                    || screenTimePermissionGranted)
                            .status(c.getStatus())
                            .createdAt(c.getCreatedAt())
                            .build();
                })
                .toList();
    }

    @Transactional
    public CreateChallengeResponse createChallenge(UUID groupId, UUID userId, CreateChallengeRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
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
            if (request.getWindowStart() == null || request.getWindowEnd() == null) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
            if (!request.getWindowEnd().isAfter(request.getWindowStart())) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
        } else {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        if (request.getMissionType() == MissionType.DURATION) {
            if (groupChallengeRepository.existsByGroupAndCategoryAndTypeAndStatusAndDeletedAtIsNull(
                    group, request.getMissionCategory(), MissionType.DURATION, GroupChallengeStatus.ACTIVE)) {
                throw new GroupException(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
            }
        } else {
            if (groupChallengeWindowRepository.existsOverlappingTimeWindow(
                    group, request.getMissionCategory(), request.getWindowStart(), request.getWindowEnd())) {
                throw new GroupException(GroupErrorCode.ACTIVE_CHALLENGE_EXISTS);
            }
        }

        GroupChallenge savedChallenge = groupChallengeRepository.save(GroupChallenge.builder()
                .group(group)
                .type(request.getMissionType())
                .category(request.getMissionCategory())
                .build());

        // CTI 상세: type 별 파라미터를 전용 테이블에 저장 (@MapsId 로 challenge_id 공유)
        if (request.getMissionType() == MissionType.DURATION) {
            groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                    .challenge(savedChallenge)
                    .durationMinutes(request.getDurationMinutes())
                    .build());
        } else {
            groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                    .challenge(savedChallenge)
                    .windowStartAt(request.getWindowStart())
                    .windowEndAt(request.getWindowEnd())
                    .build());
        }

        List<CreateChallengeResponse.NonParticipantDto> nonParticipants;
        if (request.getMissionCategory() == MissionCategory.SCREEN_TIME) {
            List<User> members = groupMemberRepository.findByGroup(group).stream()
                    .map(GroupMember::getUser)
                    .toList();
            Set<UUID> grantedUserIds = userScreenTimeSettingsRepository.findAllById(
                            members.stream().map(User::getId).toList()).stream()
                    .filter(UserScreenTimeSettings::isScreenTimePermissionGranted)
                    .map(UserScreenTimeSettings::getUserId)
                    .collect(Collectors.toSet());
            nonParticipants = members.stream()
                    .filter(u -> !grantedUserIds.contains(u.getId()))
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
    public void deleteChallenge(UUID groupId, UUID challengeId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
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

        // 이미 삭제된 챌린지는 조회 단계에서 걸러져 NOT_FOUND — 중복 DELETE 가 404 로 떨어진다.
        GroupChallenge groupChallenge = groupChallengeRepository
                .findByIdAndGroupAndDeletedAtIsNull(challengeId, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupChallenge.softDelete();
    }

    // TIME_WINDOW 상세의 Instant를 UTC 기준 "HH:mm:ss" 문자열로 변환 (time_zone 컬럼 제거에 따라 UTC 고정).
    private String toLocalTimeString(Instant instant) {
        return LocalTime.ofInstant(instant, ZoneOffset.UTC).format(TIME_FORMATTER);
    }
}
