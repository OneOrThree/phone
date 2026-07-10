package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.GroupNoticeGrant;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupDetailMemberResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
import com.oneorthree.phone.group.dto.GroupSearchResponse;
import com.oneorthree.phone.group.dto.GroupSettingsResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.dto.RenewGroupCodeResponse;
import com.oneorthree.phone.group.dto.UpdateGroupRequest;
import com.oneorthree.phone.group.dto.UpdateGroupSettingsRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupNoticeGrantRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final GroupNoticeGrantRepository groupNoticeGrantRepository;
    private final UserActivityEventLogger userActivityEventLogger;

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Transactional
    public CreateGroupResponse createGroup(UUID userId, CreateGroupRequest request) {
        // 1) 게스트 검증
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.GUEST_FORBIDDEN));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        // 2) 미션 타입별 필수값 검증
        if (request.getMissionType() == MissionType.DURATION && request.getDurationMinutes() == null) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }
        if (request.getMissionType() == MissionType.TIME_WINDOW
                && (request.getWindowStart() == null || request.getWindowEnd() == null)) {
            throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
        }

        // 3) 유니크 코드 생성 (충돌 시 만료 여부 확인 후 재사용 or 재시도)
        String uniqueCode = generateUniqueCode();

        // 4) 비밀번호 BCrypt 해시
        String hashedPassword = null;
        if (request.getPassword() != null) {
            hashedPassword = passwordEncoder.encode(request.getPassword());
        }

        // 5) Group 저장 (GROMO-674: 미션 정보는 groups 컬럼이 아니라 대표 챌린지가 소유)
        Group group = groupRepository.save(Group.builder()
                .name(request.getName())
                .password(hashedPassword)
                .description(request.getDescription())
                .maxMembers(request.getMaxMembers() != null ? request.getMaxMembers() : 10)
                .hostId(userId)
                .code(uniqueCode)
                .codeExpiresAt(Instant.now().plus(3, ChronoUnit.HOURS))
                .build());

        // 5-1) 대표 GroupChallenge + type별 상세(CTI) 저장
        createRepresentativeChallenge(group, request);

        // GroupMember(OWNER) 저장
        groupMemberRepository.save(GroupMember.builder()
                .user(user)
                .group(group)
                .role(GroupMemberRole.OWNER)
                .build());

        // 6) 응답 반환
        return new CreateGroupResponse(group.getId(), uniqueCode);
    }

    public List<GroupSummaryResponse> getMyGroups(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        List<GroupMember> groupMembers = groupMemberRepository.findByUser(user);

        return groupMembers.stream()
                .map(member -> {
                    Group group = member.getGroup();
                    int currentMembers = groupMemberRepository.findByGroup(group).size();
                    return new GroupSummaryResponse(
                            group.getId(),
                            group.getName(),
                            group.getCode(),
                            currentMembers,
                            group.getMaxMembers(),
                            member.getRole(),
                            group.getStatus()
                    );
                })
                .toList();
    }

    /*
    @todo 페이지네이션 필요함 나중에
    */
    public List<GroupSearchResponse> searchGroups(String query) {
        if (query == null || query.isEmpty()) {
            return List.of();
        }

        List<GroupSearchResponse> result = new ArrayList<>();

        Optional<Group> groupByCode = groupRepository.findByCode(query.toUpperCase());
        if (groupByCode.isPresent()) {
            Group group = groupByCode.get();
            if (group.getCodeExpiresAt() != null &&
                    group.getCodeExpiresAt().isAfter(Instant.now())) {
                result.add(toSearchResponse(group));
            }
        }

        groupRepository.findByNameContainingIgnoreCase(query)
                .stream()
                .filter(g -> result.isEmpty() || !g.getId().equals(result.get(0).getGroupId()))
                .map(this::toSearchResponse)
                .forEach(result::add);
        return result;
    }

    private GroupSearchResponse toSearchResponse(Group group) {
        int currentMembers = groupMemberRepository.findByGroup(group).size();
        return new GroupSearchResponse(
                group.getId(),
                group.getName(),
                currentMembers,
                group.getMaxMembers(),
                group.getStatus(),
                group.getPassword() != null
        );
    }

    @Transactional
    public void joinGroup(UUID groupId, UUID userId, JoinGroupRequest request) {
        // 1. 게스트 검증
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        // 2. 그룹 조회 → NOT_FOUND
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 3. 이미 멤버 확인 → ALREADY_MEMBER
        if (groupMemberRepository.findByUserAndGroup(user, group).isPresent()) {
            throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
        }

        // 4. 정원 확인 → ROOM_FULL
        if (group.getMaxMembers() <= groupMemberRepository.findByGroup(group).size()) {
            throw new GroupException(GroupErrorCode.ROOM_FULL);
        }

        // 5. 비밀번호 검증 → WRONG_PASSWORD (password 있는 그룹만)
        if (group.getPassword() != null &&
                !passwordEncoder.matches(request.getPassword(), group.getPassword())) {
            throw new GroupException(GroupErrorCode.WRONG_PASSWORD);
        }

        // 6. GroupMember 저장 (role = MEMBER)
        groupMemberRepository.save(GroupMember.builder()
                .user(user)
                .group(group)
                .role(GroupMemberRole.MEMBER)
                .build());

        // todo: 그룹 들어온 방식 (code, search) 나중에 추가하기
        userActivityEventLogger.log(UserActivityEvent.GROUP_JOINED, Map.of("group_id", group.getId().toString()));
    }

    public GroupOverviewResponse getGroupOverview(UUID groupId, UUID userId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        boolean isMember = groupMemberRepository.findByUserAndGroup(user, group).isPresent();

        int memberCount = groupMemberRepository.findByGroup(group).size();

        // GROMO-674: 미션 정보는 대표 챌린지(최신 ACTIVE)에서 조회
        RepresentativeMission mission = resolveRepresentativeMission(group);

        return GroupOverviewResponse.builder()
                .id(group.getId())
                .name(group.getName())
                .description(group.getDescription())
                .missionCategory(mission.missionCategory())
                .missionType(mission.missionType())
                .durationMinutes(mission.durationMinutes())
                .windowStart(mission.windowStart())
                .windowEnd(mission.windowEnd())
                .maxMembers(group.getMaxMembers())
                .memberCount(memberCount)
                .status(group.getStatus())
                .hasPassword(group.getPassword() != null)
                .isMember(isMember)
                .build();
    }

    @Transactional
    public RenewGroupCodeResponse renewGroupCode(UUID groupId, UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        Optional<GroupMember> groupMember = groupMemberRepository.findByUserAndGroup(user, group);

        if (!(groupMember.isPresent() && groupMember.get().getRole() == GroupMemberRole.OWNER)) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        group.renewCode(generateUniqueCode());
        return new RenewGroupCodeResponse(group.getCode(), group.getCodeExpiresAt());
    }

    public GroupDetailResponse getGroupDetail(UUID groupId, UUID userId, LocalDate date) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        List<GroupMember> groupMembers = groupMemberRepository.findByGroup(group);

        List<User> users = groupMembers.stream().map(GroupMember::getUser).toList();
        // GROMO-643: 클라 로컬 날짜(date)로 오늘 집계 조회 (UTC 산정 제거)
        List<DailyFocusStat> focusStats = dailyFocusStatRepository.findByUserInAndDate(users, date);
        Map<UUID, Integer> focusMap = focusStats.stream()
                .collect((Collectors.toMap(
                        s -> s.getUser().getId(),
                        s -> s.getTotalFocusSeconds() / 60   // GROMO-642: 초→분
                )));
        List<GroupDetailMemberResponse> list = groupMembers.stream()
                .map(m -> GroupDetailMemberResponse.builder()
                        .userId(m.getUser().getId())
                        .nickname(m.getUser().getNickname())
                        .role(m.getRole())
                        .focusTimeMinutes(focusMap.getOrDefault(m.getUser().getId(), 0))
                        .build())
                .toList();

        List<UUID> granteUsers = groupNoticeGrantRepository.findByGroup(group).stream()
                .map(u -> u.getUserId())
                .toList();

        // GROMO-674: 미션 정보는 대표 챌린지(최신 ACTIVE)에서 조회
        RepresentativeMission mission = resolveRepresentativeMission(group);

        return GroupDetailResponse.builder()
                .id(group.getId())
                .name(group.getName())
                .description(group.getDescription())
                .missionCategory(mission.missionCategory())
                .missionType(mission.missionType())
                .durationMinutes(mission.durationMinutes())
                .windowStart(mission.windowStart())
                .windowEnd(mission.windowEnd())
                .maxMembers(group.getMaxMembers())
                .status(group.getStatus())
                .members(list)
                .code(groupMember.getRole() == GroupMemberRole.OWNER ?
                        group.getCode() : null)
                .codeExpiresAt(groupMember.getRole() == GroupMemberRole.OWNER ?
                        group.getCodeExpiresAt() : null)
                .noticeGrantedUserIds(granteUsers)
                .build();
    }

    @Transactional
    public void updateGroup(UUID groupId, UUID userId, UpdateGroupRequest request) {
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

        if (request.getName() != null) {
            group.updateName(request.getName());
        }

        if (request.getMaxMembers() != null) {
            int currentCount = groupMemberRepository.findByGroup(group).size();
            if (request.getMaxMembers() < 1 || request.getMaxMembers() < currentCount) {
                throw new GroupException(GroupErrorCode.MAX_MEMBERS_TOO_SMALL);
            }
            group.updateMaxMembers(request.getMaxMembers());
        }

        if (request.getPasswordAction() == UpdateGroupRequest.PasswordAction.SET) {
            if (request.getPassword() == null || request.getPassword().isBlank()) {
                throw new GroupException(GroupErrorCode.INVALID_MISSION_PARAMS);
            }
            group.updatePassword(passwordEncoder.encode(request.getPassword()));
        } else if (request.getPasswordAction() == UpdateGroupRequest.PasswordAction.REMOVE) {
            group.removePassword();
        }

        if (request.getDescription() != null) {
            group.updateDescription(request.getDescription());
        }
    }

    public GroupSettingsResponse getGroupSettings(UUID groupId, UUID userId) {
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

        List<UUID> grantedUserIds = groupNoticeGrantRepository.findByGroup(group).stream()
                .map(GroupNoticeGrant::getUserId)
                .toList();

        return GroupSettingsResponse.builder()
                .chatEnabled(group.isChatEnabled())
                .chatLimitPerPerson(group.getChatLimitPerPerson())
                .noticePermission(group.getNoticePermission())
                .invitePermission(group.getInvitePermission())
                .noticeGrantedUserIds(grantedUserIds)
                .build();
    }

    @Transactional
    public void updateGroupSettings(UUID groupId, UUID userId, UpdateGroupSettingsRequest request) {
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

        group.updateSettings(
                request.getChatEnabled(),
                request.getChatLimitPerPerson(),
                request.getNoticePermission(),
                request.getInvitePermission()
        );

        if (request.getNoticeGrantedUserIds() != null) {
            groupNoticeGrantRepository.deleteByGroup(group);
            if (!request.getNoticeGrantedUserIds().isEmpty()) {
                List<GroupNoticeGrant> grants = request.getNoticeGrantedUserIds().stream()
                        .filter(granteeId -> groupMemberRepository.existsByUserIdAndGroup(granteeId, group))
                        .map(granteeId -> GroupNoticeGrant.builder()
                                .group(group)
                                .userId(granteeId)
                                .build())
                        .toList();
                groupNoticeGrantRepository.saveAll(grants);
            }
        }
    }

    // ── GROMO-674: 그룹 미션 정보는 group_challenges(+CTI 상세)가 소유 ──────────────

    /** 그룹 생성 시 대표 챌린지(status=ACTIVE) + type별 상세(Duration/Window) 행을 저장한다. */
    private void createRepresentativeChallenge(Group group, CreateGroupRequest request) {
        GroupChallenge challenge = GroupChallenge.builder()
                .group(group)
                .type(request.getMissionType())
                .category(request.getMissionCategory())
                .status(GroupChallengeStatus.ACTIVE)
                .build();
        groupChallengeRepository.save(challenge);

        if (request.getMissionType() == MissionType.DURATION) {
            groupChallengeDurationRepository.save(GroupChallengeDuration.builder()
                    .challenge(challenge)
                    .durationMinutes(request.getDurationMinutes())
                    .build());
        } else if (request.getMissionType() == MissionType.TIME_WINDOW) {
            groupChallengeWindowRepository.save(GroupChallengeWindow.builder()
                    .challenge(challenge)
                    .windowStartAt(request.getWindowStart())
                    .windowEndAt(request.getWindowEnd())
                    .build());
        }
    }

    /** 대표 챌린지(최신 ACTIVE, 미삭제) + type별 상세에서 상세/오버뷰 응답의 미션 필드를 채운다. */
    private RepresentativeMission resolveRepresentativeMission(Group group) {
        return groupChallengeRepository
                .findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(group, GroupChallengeStatus.ACTIVE)
                .map(this::toRepresentativeMission)
                .orElse(RepresentativeMission.EMPTY);
    }

    private RepresentativeMission toRepresentativeMission(GroupChallenge challenge) {
        Integer durationMinutes = null;
        Instant windowStart = null;
        Instant windowEnd = null;
        if (challenge.getType() == MissionType.DURATION) {
            durationMinutes = groupChallengeDurationRepository.findById(challenge.getId())
                    .map(GroupChallengeDuration::getDurationMinutes)
                    .orElse(null);
        } else if (challenge.getType() == MissionType.TIME_WINDOW) {
            Optional<GroupChallengeWindow> window = groupChallengeWindowRepository.findById(challenge.getId());
            windowStart = window.map(GroupChallengeWindow::getWindowStartAt).orElse(null);
            windowEnd = window.map(GroupChallengeWindow::getWindowEndAt).orElse(null);
        }
        return new RepresentativeMission(
                challenge.getCategory(), challenge.getType(), durationMinutes, windowStart, windowEnd);
    }

    /** 상세/오버뷰 JSON 계약(missionCategory/missionType/durationMinutes/windowStart/windowEnd) 유지용 뷰. */
    private record RepresentativeMission(
            MissionCategory missionCategory,
            MissionType missionType,
            Integer durationMinutes,
            Instant windowStart,
            Instant windowEnd) {

        private static final RepresentativeMission EMPTY = new RepresentativeMission(null, null, null, null, null);
    }

    private String generateUniqueCode() {
        StringBuilder sb = new StringBuilder(8);
        for (int i = 0; i < 10; i++) {
            sb.setLength(0);
            for (int j = 0; j < 8; j++) {
                sb.append(CHARS.charAt(RANDOM.nextInt(CHARS.length())));
            }
            String code = sb.toString();

            if (!groupRepository.existsByCode(code)) {
                return code;
            }

            // 충돌: 만료된 코드면 NULL로 정리하고 재사용
            groupRepository.findByCode(code).ifPresent(existing -> {
                if (existing.getCodeExpiresAt() != null
                        && existing.getCodeExpiresAt().isBefore(Instant.now())) {
                    existing.expireCode();
                }
            });
        }
        throw new GroupException(GroupErrorCode.CODE_GENERATION_FAILED);
    }
}
