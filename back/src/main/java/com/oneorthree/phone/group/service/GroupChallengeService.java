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
import com.oneorthree.phone.group.dto.ChallengeMemberProgressResponse;
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
import com.oneorthree.phone.screentime.domain.DailyScreenTimeStat;
import com.oneorthree.phone.screentime.repository.DailyScreenTimeStatRepository;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
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
import java.time.LocalDate;
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
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final DailyScreenTimeStatRepository dailyScreenTimeStatRepository;

    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm:ss");

    /**
     * 그룹 챌린지 목록. {@code date} 를 주면 멤버별 당일 진행률({@code memberProgress})을 함께 채운다.
     *
     * @param date 클라 로컬 타임존 기준 오늘(그룹 상세의 focusTimeMinutes 와 같은 의미).
     *             null 이면 진행률을 계산하지 않는다(기존 클라이언트 호환).
     */
    public List<GroupChallengeResponse> getChallenges(UUID groupId, UUID userId, LocalDate date) {
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

        // 멤버·일별 통계도 챌린지 루프 밖에서 한 번씩만 로드한다(챌린지 수 × 멤버 수의 N+1 방지).
        ProgressSnapshot progress = loadProgressSnapshot(group, challenges, date);

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
                            .memberProgress(memberProgressOf(c, duration, progress))
                            .build();
                })
                .toList();
    }

    /**
     * 진행률 계산에 필요한 멤버·일별 통계를 배치 로드한다. {@code date} 가 없으면 null 을 반환해
     * 호출측이 {@code memberProgress = null}(미계산)로 응답하게 한다.
     *
     * <p>통계는 실제로 그 카테고리의 DURATION 챌린지가 있을 때만 조회한다 — FOCUS 챌린지만 있는 그룹이
     * 스크린타임 테이블을 훑지 않도록.
     */
    private ProgressSnapshot loadProgressSnapshot(Group group, List<GroupChallenge> challenges, LocalDate date) {
        if (date == null) {
            return null;
        }

        List<GroupMember> members = groupMemberRepository.findByGroup(group);
        List<User> users = members.stream().map(GroupMember::getUser).toList();
        if (users.isEmpty()) {
            return new ProgressSnapshot(members, Map.of(), Map.of());
        }

        Map<UUID, Integer> focusMinutes = hasDurationChallenge(challenges, MissionCategory.FOCUS)
                ? dailyFocusStatRepository.findByUserInAndDate(users, date).stream()
                        .collect(Collectors.toMap(
                                s -> s.getUser().getId(),
                                s -> s.getTotalFocusSeconds() / 60))   // GROMO-642: 초→분
                : Map.of();

        // 스크린타임은 권한에 동의한 멤버만 대상 — 권한을 철회한 멤버는 챌린지 비참여자
        // (canParticipate=false / nonParticipants)이므로, 철회 전에 쌓여 남아 있는 통계 행을
        // 진행률로 노출하지 않는다(맵에서 빠져 null = 판정 불가).
        Map<UUID, Integer> screenTimeMinutes = Map.of();
        if (hasDurationChallenge(challenges, MissionCategory.SCREEN_TIME)) {
            Set<UUID> grantedUserIds = grantedScreenTimeUserIds(users);
            List<User> participants = users.stream()
                    .filter(u -> grantedUserIds.contains(u.getId()))
                    .toList();
            if (!participants.isEmpty()) {
                screenTimeMinutes = dailyScreenTimeStatRepository.findByUserInAndDate(participants, date).stream()
                        .collect(Collectors.toMap(
                                s -> s.getUser().getId(),
                                DailyScreenTimeStat::getTotalScreenTimeMinutes));
            }
        }

        return new ProgressSnapshot(members, focusMinutes, screenTimeMinutes);
    }

    /** 스크린타임 권한에 동의한 유저 id 집합 — 비참여자 판정과 진행률 대상 필터가 같은 기준을 쓰도록 공유한다. */
    private Set<UUID> grantedScreenTimeUserIds(List<User> users) {
        return userScreenTimeSettingsRepository.findAllById(users.stream().map(User::getId).toList()).stream()
                .filter(UserScreenTimeSettings::isScreenTimePermissionGranted)
                .map(UserScreenTimeSettings::getUserId)
                .collect(Collectors.toSet());
    }

    private boolean hasDurationChallenge(List<GroupChallenge> challenges, MissionCategory category) {
        return challenges.stream()
                .anyMatch(c -> c.getType() == MissionType.DURATION && c.getCategory() == category);
    }

    /**
     * 챌린지 하나에 대한 멤버별 진행률. 진행률 미계산(date 없음)·TIME_WINDOW·상세 행 유실이면 null 이다.
     *
     * <p>TIME_WINDOW 는 시간대 내 세션 대조가 필요해 이번 범위에서 제외했다(명세 결정 3).
     */
    private List<ChallengeMemberProgressResponse> memberProgressOf(
            GroupChallenge challenge, GroupChallengeDuration duration, ProgressSnapshot progress) {
        if (progress == null || challenge.getType() != MissionType.DURATION || duration == null) {
            return null;
        }

        boolean screenTime = challenge.getCategory() == MissionCategory.SCREEN_TIME;
        int goalMinutes = duration.getDurationMinutes();

        return progress.members().stream()
                .map(member -> {
                    UUID memberId = member.getUser().getId();
                    // FOCUS 는 통계가 없으면 "0분 집중"이 사실이지만, SCREEN_TIME 은 데이터 미수집과
                    // "0분 사용"을 구분할 수 없어 null(판정 불가)로 남긴다.
                    // 한계: null 은 "통계 행 없음/권한 미동의"까지만 덮는다. 앱이 actualScreenTimeMinutes 없이
                    // 보고하면 ScreenTimeService 가 0 으로 저장해 실제 0분과 구분되지 않는다(쓰기 모델 이슈 —
                    // 컬럼 nullable 화가 필요해 이 범위 밖).
                    Integer progressMinutes = screenTime
                            ? progress.screenTimeMinutes().get(memberId)
                            : progress.focusMinutes().getOrDefault(memberId, 0);
                    Boolean achieved = progressMinutes == null
                            ? null
                            : (screenTime ? progressMinutes <= goalMinutes : progressMinutes >= goalMinutes);
                    return ChallengeMemberProgressResponse.builder()
                            .userId(memberId)
                            .nickname(member.getUser().getNickname())
                            .progressMinutes(progressMinutes)
                            .achieved(achieved)
                            .build();
                })
                .toList();
    }

    /** 진행률 계산용 배치 로드 결과 — 그룹 멤버 전원과 userId → 당일 분 맵(통계 없는 유저는 키 없음). */
    private record ProgressSnapshot(
            List<GroupMember> members,
            Map<UUID, Integer> focusMinutes,
            Map<UUID, Integer> screenTimeMinutes) {
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
            Set<UUID> grantedUserIds = grantedScreenTimeUserIds(members);
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
