package com.oneorthree.phone.service;

import com.oneorthree.phone.domain.group.Group;
import com.oneorthree.phone.domain.group.GroupAnnouncement;
import com.oneorthree.phone.domain.group.GroupChallenge;
import com.oneorthree.phone.domain.group.GroupChallengeStatus;
import com.oneorthree.phone.domain.group.GroupMember;
import com.oneorthree.phone.domain.group.GroupMemberRole;
import com.oneorthree.phone.domain.group.MissionType;
import com.oneorthree.phone.domain.user.User;
import com.oneorthree.phone.exception.GroupErrorCode;
import com.oneorthree.phone.exception.GroupException;
import com.oneorthree.phone.exception.UserNotFoundException;
import com.oneorthree.phone.repository.group.GroupAnnouncementRepository;
import com.oneorthree.phone.repository.group.GroupChallengeRepository;
import com.oneorthree.phone.repository.group.GroupMemberRepository;
import com.oneorthree.phone.repository.group.GroupRepository;
import com.oneorthree.phone.repository.user.UserRepository;
import com.oneorthree.phone.service.dto.group.CreateAnnouncementRequest;
import com.oneorthree.phone.service.dto.group.CreateChallengeRequest;
import com.oneorthree.phone.service.dto.group.CreateChallengeResponse;
import com.oneorthree.phone.service.dto.group.CreateGroupRequest;
import com.oneorthree.phone.service.dto.group.CreateGroupResponse;
import com.oneorthree.phone.service.dto.group.GroupAnnouncementResponse;
import com.oneorthree.phone.service.dto.group.GroupChallengeResponse;
import com.oneorthree.phone.service.dto.group.GroupDetailMemberResponse;
import com.oneorthree.phone.service.dto.group.GroupDetailResponse;
import com.oneorthree.phone.service.dto.group.GroupOverviewResponse;
import com.oneorthree.phone.service.dto.group.GroupSearchResponse;
import com.oneorthree.phone.service.dto.group.GroupSummaryResponse;
import com.oneorthree.phone.service.dto.group.JoinGroupRequest;
import com.oneorthree.phone.service.dto.group.RenewGroupCodeResponse;
import com.oneorthree.phone.service.dto.group.UpdateGroupRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class GroupService {

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final GroupAnnouncementRepository groupAnnouncementRepository;
    private final GroupChallengeRepository groupChallengeRepository;

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    @Transactional
    public CreateGroupResponse createGroup(Long userId, CreateGroupRequest request) {
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

        // 5) Group 저장
        Group group = groupRepository.save(Group.builder()
                .name(request.getName())
                .password(hashedPassword)
                .description(request.getDescription())
                .maxMembers(request.getMaxMembers() != null ? request.getMaxMembers() : 10)
                .missionType(request.getMissionType())
                .missionCategory(request.getMissionCategory())
                .durationMinutes(request.getDurationMinutes())
                .windowStart(request.getWindowStart())
                .windowEnd(request.getWindowEnd())
                .hostId(userId)
                .code(uniqueCode)
                .codeExpiresAt(Instant.now().plus(3, ChronoUnit.HOURS))
                .build());

        // GroupMember(OWNER) 저장
        groupMemberRepository.save(GroupMember.builder()
                .user(user)
                .group(group)
                .role(GroupMemberRole.OWNER)
                .build());

        // 6) 응답 반환
        return new CreateGroupResponse(group.getId(), uniqueCode);
    }

    public List<GroupSummaryResponse> getMyGroups(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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
    public void joinGroup(Long groupId, Long userId, JoinGroupRequest request) {
        // 1. 게스트 검증
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);
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
    }

    public GroupOverviewResponse getGroupOverview(Long groupId, Long userId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        boolean isMember = groupMemberRepository.findByUserAndGroup(user, group).isPresent();

        int memberCount = groupMemberRepository.findByGroup(group).size();

        return GroupOverviewResponse.builder()
                .id(group.getId())
                .name(group.getName())
                .description(group.getDescription())
                .missionCategory(group.getMissionCategory())
                .missionType(group.getMissionType())
                .durationMinutes(group.getDurationMinutes())
                .windowStart(group.getWindowStart())
                .windowEnd(group.getWindowEnd())
                .maxMembers(group.getMaxMembers())
                .memberCount(memberCount)
                .status(group.getStatus())
                .hasPassword(group.getPassword() != null)
                .isMember(isMember)
                .build();
    }

    @Transactional
    public RenewGroupCodeResponse renewGroupCode(Long groupId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

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

    public GroupDetailResponse getGroupDetail(Long groupId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        List<GroupDetailMemberResponse> list = groupMemberRepository.findByGroup(group)
                .stream()
                .map(m -> GroupDetailMemberResponse.builder()
                        .userId(m.getUser().getId())
                        .nickname(m.getUser().getNickname())
                        .role(m.getRole())
                        .build())
                .toList();

        return GroupDetailResponse.builder()
                .id(group.getId())
                .name(group.getName())
                .description(group.getDescription())
                .missionCategory(group.getMissionCategory())
                .missionType(group.getMissionType())
                .durationMinutes(group.getDurationMinutes())
                .windowStart(group.getWindowStart())
                .windowEnd(group.getWindowEnd())
                .maxMembers(group.getMaxMembers())
                .status(group.getStatus())
                .members(list)
                .code(groupMember.getRole() == GroupMemberRole.OWNER ?
                        group.getCode() : null)
                .codeExpiresAt(groupMember.getRole() == GroupMemberRole.OWNER ?
                        group.getCodeExpiresAt() : null)
                .build();
    }

    @Transactional
    public void createAnnouncement(Long groupId, Long userId, CreateAnnouncementRequest request) {
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

        groupAnnouncementRepository.save(
                GroupAnnouncement.builder()
                        .group(group)
                        .author(user)
                        .title(request.getTitle())
                        .content(request.getContent())
                        .build()
        );
    }

    public List<GroupAnnouncementResponse> getAnnouncements(Long groupId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        return groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group)
                .stream()
                .map(a -> GroupAnnouncementResponse.builder()
                        .id(a.getId())
                        .title(a.getTitle())
                        .content(a.getContent())
                        .createdAt(a.getCreatedAt())
                        .build())
                .toList();
    }

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
                        .durationMinutes(c.getDurationMinutes())
                        .windowStart(c.getWindowStart())
                        .windowEnd(c.getWindowEnd())
                        .status(c.getStatus())
                        .createdAt(c.getCreatedAt())
                        // TODO GROMO-358: .missionCategory(c.getMissionCategory())
                        // TODO GROMO-358: .canParticipate(c.getMissionCategory() == MissionCategory.FOCUS || user.isScreenTimePermissionGranted())
                        .build())
                .toList();
    }

    @Transactional
    public void updateGroup(Long groupId, Long userId, UpdateGroupRequest request) {
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
    }

    @Transactional
    public void transferOwner(Long groupId, Long targetUserId, Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(UserNotFoundException::new);
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        User targetUser = userRepository.findById(targetUserId)
                .orElseThrow(UserNotFoundException::new);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember hostGroupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .filter(m -> m.getRole() == GroupMemberRole.OWNER)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_OWNER));

        GroupMember targetGroupMember = groupMemberRepository.findByUserAndGroup(targetUser, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        hostGroupMember.demoteToMember();
        targetGroupMember.promoteToOwner();
        group.transferOwner(targetUserId);
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
                java.time.ZoneId.of(request.getTimeZone());
            } catch (java.time.DateTimeException e) {
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

        // TODO GROMO-357: SCREEN_TIME이면 권한 없는 그룹원 목록 조회 후 nonParticipants에 포함
        return CreateChallengeResponse.builder()
                .id(savedChallenge.getId())
                .build();
    }
}
