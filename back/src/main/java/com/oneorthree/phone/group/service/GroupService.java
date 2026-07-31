package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.domain.GroupJoinCode;
import com.oneorthree.phone.group.domain.GroupJoinCodeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
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
import com.oneorthree.phone.group.repository.GroupJoinCodeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
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
    private final GroupJoinCodeRepository groupJoinCodeRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final GroupChallengeRepository groupChallengeRepository;
    private final GroupChallengeDurationRepository groupChallengeDurationRepository;
    private final GroupChallengeWindowRepository groupChallengeWindowRepository;
    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final UserActivityEventLogger userActivityEventLogger;

    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** 그룹 이름 검색 최대 반환 수 — 닉네임 검색(NicknameSearchStrategy)과 동일 값. */
    private static final int SEARCH_LIMIT = 20;

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
                .isPrivate(request.isPrivate())
                .build());

        // GROMO-672: 참가 코드는 1:1 테이블(group_join_codes)에 저장 (발급 + 3시간 유효, ACTIVE)
        groupJoinCodeRepository.save(GroupJoinCode.builder()
                .group(group)
                .code(uniqueCode)
                .status(GroupJoinCodeStatus.ACTIVE)
                .expiresAt(Instant.now().plus(3, ChronoUnit.HOURS))
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

        // GROMO-672: 참가 코드는 1:1 테이블(PK=group_id)에서 일괄 조회 — 그룹당 findById N+1 방지
        List<UUID> groupIds = groupMembers.stream()
                .map(member -> member.getGroup().getId())
                .toList();
        Map<UUID, String> codeByGroupId = groupJoinCodeRepository.findAllById(groupIds).stream()
                .collect(Collectors.toMap(GroupJoinCode::getGroupId, GroupJoinCode::getCode));

        return groupMembers.stream()
                .map(member -> {
                    Group group = member.getGroup();
                    int currentMembers = groupMemberRepository.findByGroup(group).size();
                    String code = codeByGroupId.get(group.getId());
                    return new GroupSummaryResponse(
                            group.getId(),
                            group.getName(),
                            code,
                            currentMembers,
                            group.getMaxMembers(),
                            member.getRole(),
                            group.getStatus(),
                            group.isPrivate()
                    );
                })
                .toList();
    }

    /**
     * 공개 그룹 이름 유사도 검색. 비공개 그룹은 초대 링크(groupId)로만 참여하므로 결과에서 제외한다.
     *
     * <p>참가 코드 정확 매칭 분기는 코드 체계 폐기(2026-07-31)와 함께 제거됐다.
     * 무제한 반환(구 findByNameContainingIgnoreCase)도 LIMIT 으로 닫았다 — 커서 페이지네이션은 후속.
     */
    public List<GroupSearchResponse> searchGroups(String query) {
        if (query == null || query.isBlank()) {
            return List.of();
        }
        return groupRepository.searchPublicByNameTrgm(query, SEARCH_LIMIT).stream()
                .map(this::toSearchResponse)
                .toList();
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

        // GROMO-672: 참가 코드 재발급은 group_join_codes 의 같은 행 UPDATE (code/status/expiresAt 갱신)
        GroupJoinCode joinCode = groupJoinCodeRepository.findById(group.getId())
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
        joinCode.renew(generateUniqueCode());
        return new RenewGroupCodeResponse(joinCode.getCode(), joinCode.getExpiresAt());
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

        // GROMO-676: 공지 권한은 group_members.announcement_permission 기준 (방장 제외)
        List<UUID> granteUsers = noticeGrantedUserIds(groupMembers);

        // GROMO-674: 미션 정보는 대표 챌린지(최초 ACTIVE)에서 조회
        RepresentativeMission mission = resolveRepresentativeMission(group);

        // GROMO-672: OWNER 에게만 노출하는 참가 코드/만료시각은 group_join_codes 에서 조회
        boolean isOwner = groupMember.getRole() == GroupMemberRole.OWNER;
        GroupJoinCode joinCode = isOwner
                ? groupJoinCodeRepository.findById(group.getId()).orElse(null)
                : null;

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
                .isPrivate(group.isPrivate())
                .members(list)
                .code(joinCode != null ? joinCode.getCode() : null)
                .codeExpiresAt(joinCode != null ? joinCode.getExpiresAt() : null)
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

        // GROMO-676: 공지 권한은 group_members.announcement_permission 기준 (방장 제외)
        List<UUID> grantedUserIds = noticeGrantedUserIds(groupMemberRepository.findByGroup(group));

        return GroupSettingsResponse.builder()
                .chatEnabled(group.isChatEnabled())
                .chatLimitPerPerson(group.getChatLimitPerPerson())
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
                request.getInvitePermission()
        );

        // GROMO-676: 공지 권한 부여/회수 — group_members.announcement_permission 로 일괄 반영.
        // null = 미변경, 빈 리스트 = 권한 초기화(방장만), 목록에 없는 멤버는 회수, 비멤버 id 는 무시.
        if (request.getNoticeGrantedUserIds() != null) {
            List<UUID> granteeIds = request.getNoticeGrantedUserIds();
            groupMemberRepository.findByGroup(group).stream()
                    .filter(member -> member.getRole() != GroupMemberRole.OWNER)
                    .forEach(member -> {
                        if (granteeIds.contains(member.getUser().getId())) {
                            member.allowAnnouncement();
                        } else {
                            member.disallowAnnouncement();
                        }
                    });
        }
    }

    /** 공지 작성 권한(ALLOW)을 가진 멤버 id 목록 — 방장은 컬럼과 무관하게 항상 가능하므로 제외한다. */
    private List<UUID> noticeGrantedUserIds(List<GroupMember> members) {
        return members.stream()
                .filter(member -> member.getRole() != GroupMemberRole.OWNER)
                .filter(member -> member.getAnnouncementPermission() == GroupAnnouncementGrant.ALLOW)
                .map(member -> member.getUser().getId())
                .toList();
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

            // GROMO-672: 유일성 검사는 group_join_codes 기준
            if (!groupJoinCodeRepository.existsByCode(code)) {
                return code;
            }

            // 충돌: 만료된 코드면 ENDED 로 정리하고 다른 코드로 재시도.
            // 의도된 동작 — code 는 NOT NULL UNIQUE 라 구 스키마처럼 null 로 비워 재사용하지 않는다.
            // 즉 한 번 발급된 코드 문자열은 영구히 재발급되지 않음(36^8 공간이라 고갈 우려 없음).
            groupJoinCodeRepository.findByCode(code).ifPresent(existing -> {
                if (existing.getExpiresAt() != null
                        && existing.getExpiresAt().isBefore(Instant.now())) {
                    existing.expire();
                }
            });
        }
        throw new GroupException(GroupErrorCode.CODE_GENERATION_FAILED);
    }
}
