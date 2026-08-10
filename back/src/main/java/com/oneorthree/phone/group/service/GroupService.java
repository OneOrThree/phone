package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.analytics.Ga4MeasurementClient;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
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
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
    private final GroupInviteLinkRepository groupInviteLinkRepository;
    private final Ga4MeasurementClient ga4MeasurementClient;

    // 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 참가 코드 생성 전용 상수다.
    private static final String CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** 그룹 이름 검색 최대 반환 수 — 닉네임 검색(NicknameSearchStrategy)과 동일 값. */
    private static final int SEARCH_LIMIT = 20;
    // A-10: 검색어 입력 전 기본 목록에 노출할 공개방 수
    private static final int DEFAULT_LIST_LIMIT = 10;

    /**
     * 한 유저가 동시에 소속될 수 있는 그룹 수 상한.
     *
     * <p>내 그룹 목록(getMyGroups)이 무페이지네이션이라 무제한 가입은 그대로 abuse 표면이 된다.
     * 10 은 실사용에서 사실상 무제한이면서 목록 응답 크기를 상수로 묶는 값.
     */
    private static final int MAX_JOINED_GROUPS = 10;

    /**
     * 계약(스펙 §4-2)에 정의된 join_method 전량 — 앱 {@code GroupJoinMethod} 타입과 1:1.
     * 새 참여 경로가 계약에 추가되면 여기에도 넣어야 {@code unknown} 으로 뭉개지지 않는다.
     */
    private static final Set<String> ALLOWED_JOIN_METHODS = Set.of("code", "search", "invite", "deferred_invite");
    private static final String UNKNOWN_JOIN_METHOD = "unknown";

    @Transactional
    public CreateGroupResponse createGroup(UUID userId, CreateGroupRequest request) {
        // 1) 활성 검증 + 공유 락 (GROMO-1226) — 락 없는 findById 면 계정 탈퇴(유저 행 배타 락)의
        //    정리 스캔(멤버십 0 확인) 이후·커밋 이전에 낀 생성이 정리를 빠져나가, 탈퇴자가 OWNER 인
        //    is_left=false 그룹이 영구 잔존한다(재탈퇴·위임 모두 불가 = 복구 불능). 유저 부재를
        //    GUEST_FORBIDDEN(403)으로 오분류하던 것도 형제 경로(joinGroup)와 같은 404 로 정정(D9).
        User user = requireActiveUser(userId);

        // 1-1) 소속 그룹 수 상한 — 생성도 곧 가입이므로 참가와 같은 기준으로 막는다
        ensureJoinedGroupLimit(user);

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
        // 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 발급은 계속되지만 조회하는 경로가 없다.
        // 3시간 상수는 GroupJoinCode#renew 에도 이중 정의돼 있다 — 제거 시 함께 정리할 것.
        groupJoinCodeRepository.save(GroupJoinCode.builder()
                .group(group)
                .code(uniqueCode)
                .status(GroupJoinCodeStatus.ACTIVE)
                .expiresAt(Instant.now().plus(3, ChronoUnit.HOURS))
                .build());

        // D18: 그룹 생성 시 대표 챌린지를 만들지 않는다 — 챌린지는 그룹방 '챌린지 생성'으로 별도 생성한다.

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
        // 순수 읽기(readOnly) — 무락 활성 검증 (GROMO-1237). readOnly 트랜잭션에선 FOR SHARE 불가.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        List<GroupMember> groupMembers = groupMemberRepository.findByUser(user);

        // GROMO-672: 참가 코드는 1:1 테이블(PK=group_id)에서 일괄 조회 — 그룹당 findById N+1 방지
        List<UUID> groupIds = groupMembers.stream()
                .map(member -> member.getGroup().getId())
                .toList();
        Map<UUID, String> codeByGroupId = groupJoinCodeRepository.findAllById(groupIds).stream()
                .collect(Collectors.toMap(GroupJoinCode::getGroupId, GroupJoinCode::getCode));

        // 멤버 수도 IN 집계 1회 — 그룹마다 findByGroup(group).size() 로 멤버 엔티티를 로드하던 N+1 제거
        Map<UUID, Integer> memberCountByGroupId = memberCountsOf(groupIds);

        return groupMembers.stream()
                .map(member -> {
                    Group group = member.getGroup();
                    int currentMembers = memberCountByGroupId.getOrDefault(group.getId(), 0);
                    String code = codeByGroupId.get(group.getId());
                    return new GroupSummaryResponse(
                            group.getId(),
                            group.getName(),
                            group.getDescription(),
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
        // A-10: 검색어가 비면 공개방 최신순 상위 10개(기본 목록), 있으면 trgm 검색.
        List<Group> groups = (query == null || query.isBlank())
                ? groupRepository.findTopPublicGroups(DEFAULT_LIST_LIMIT)
                : groupRepository.searchPublicByNameTrgm(query, SEARCH_LIMIT);

        // 멤버 수는 IN 집계 1회 — 결과 그룹마다 findByGroup(group).size() 를 돌던 N+1 제거
        Map<UUID, Integer> memberCountByGroupId = memberCountsOf(groups.stream().map(Group::getId).toList());

        return groups.stream()
                .map(group -> toSearchResponse(group, memberCountByGroupId.getOrDefault(group.getId(), 0)))
                .toList();
    }

    /**
     * 라이브 뷰의 활성 멤버 — 이탈(is_left)에 더해 <b>탈퇴 유저(is_deleted)를 제외</b>한 단일 기준
     * (GROMO-1220). 탈퇴자는 nickname 이 파기(null)돼 목록에 빈 타일로 뜨고 정원 한 자리를 차지한다
     * — #497(GROMO-801) 이전 탈퇴자의 유령 멤버십(is_left=false 잔존)은 V30 백필이 정리하지만,
     * 조회 층도 같은 기준으로 방어한다. 멤버 목록·정원 판정·설정 뷰가 전부 이 헬퍼를 타야
     * "N명인데 N-1 타일" 불일치가 안 생긴다({@code countByGroupIdIn} 집계도 같은 기준).
     * {@code findByGroup} 이 user 를 EntityGraph 로 함께 로드하므로 추가 쿼리는 없다.
     */
    private List<GroupMember> activeMembersOf(Group group) {
        return groupMemberRepository.findByGroup(group).stream()
                .filter(member -> !member.getUser().isDeleted())
                .toList();
    }

    /** 그룹 id 목록의 멤버 수를 집계 쿼리 1회로 조회한다. 멤버가 0인 그룹은 결과에 없으므로 호출측이 0으로 채운다. */
    private Map<UUID, Integer> memberCountsOf(List<UUID> groupIds) {
        if (groupIds.isEmpty()) {
            return Map.of();
        }
        return groupMemberRepository.countByGroupIdIn(groupIds).stream()
                .collect(Collectors.toMap(
                        GroupMemberRepository.GroupMemberCount::getGroupId,
                        count -> (int) count.getMemberCount()));
    }

    private GroupSearchResponse toSearchResponse(Group group, int currentMembers) {
        return new GroupSearchResponse(
                group.getId(),
                group.getName(),
                group.getDescription(),
                currentMembers,
                group.getMaxMembers(),
                group.getStatus(),
                group.getPassword() != null
        );
    }

    @Transactional
    public void joinGroup(UUID groupId, UUID userId, JoinGroupRequest request) {
        // 1. 활성 검증 + 공유 락 (GROMO-801, codex 리뷰) — 근거는 requireActiveUser Javadoc.
        //    탈퇴의 정리 스캔 이후·커밋 이전에 낀 가입(재가입 포함)이 유령 멤버십으로 남는 것을 막는다.
        User user = requireActiveUser(userId);

        // 2. 그룹 조회 → NOT_FOUND
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 3. 이미 활성 멤버 → ALREADY_MEMBER
        if (groupMemberRepository.findByUserAndGroup(user, group).isPresent()) {
            throw new GroupException(GroupErrorCode.ALREADY_MEMBER);
        }

        // 3-0. 과거 이탈 행(A-0 소프트삭제) 확인 — 강퇴자는 재참여 차단, 자진 탈퇴자는 아래 6에서 행을 되살린다.
        //      (활성 행은 위에서 걸러졌으니, 존재한다면 반드시 이탈(is_left) 행이다.)
        Optional<GroupMember> priorMembership = groupMemberRepository.findAnyByUserAndGroup(user, group);
        if (priorMembership.isPresent() && priorMembership.get().isKicked()) {
            throw new GroupException(GroupErrorCode.KICKED_CANNOT_REJOIN);
        }

        // 3-1. 소속 그룹 수 상한 → GROUP_LIMIT_EXCEEDED
        // (활성 멤버는 위 ALREADY_MEMBER 로 끝나므로 상한에 걸리지 않는다. 재가입은 활성 카운트가 늘어 상한 적용)
        ensureJoinedGroupLimit(user);

        // 4. 정원 확인 → ROOM_FULL (활성 멤버만 카운트 — 탈퇴자 유령 자리는 회수한다, GROMO-1220)
        if (group.getMaxMembers() <= activeMembersOf(group).size()) {
            throw new GroupException(GroupErrorCode.ROOM_FULL);
        }

        // 5. 비밀번호 검증 → WRONG_PASSWORD (password 있는 그룹만)
        if (group.getPassword() != null &&
                !passwordEncoder.matches(request.getPassword(), group.getPassword())) {
            throw new GroupException(GroupErrorCode.WRONG_PASSWORD);
        }

        // 6. 자진 탈퇴자 재가입이면 기존 행 되살리기(유니크 제약 회피), 아니면 신규 저장 (role = MEMBER)
        if (priorMembership.isPresent()) {
            priorMembership.get().rejoin();
        } else {
            groupMemberRepository.save(GroupMember.builder()
                    .user(user)
                    .group(group)
                    .role(GroupMemberRole.MEMBER)
                    .build());
        }

        // 7. 어트리뷰션 — 참여 경로(join_method)와 초대 slug 를 두 트랙에 기록한다.
        //    공유 URL 의 ?g= 는 변조 가능하므로 "링크의 group_id == 참여 그룹" 만이 신뢰 근거다(스펙 §6-3).
        //    불일치·미존재면 slug 만 버리고 참여 자체는 정상 진행한다 — 초대 어트리뷰션은 부가 정보다.
        GroupInviteLink invite = resolveInviteAttribution(groupId, userId, request.getInviteSlug());
        publishJoinAttribution(group, request, invite);
    }

    /**
     * slug → 초대 링크. 두 가지를 통과해야 어트리뷰션을 인정한다.
     *
     * <ul>
     *   <li>링크가 가리키는 그룹 == 실제 참여 그룹 (공유 URL 의 {@code ?g=} 변조 흡수)</li>
     *   <li>초대자 != 참여자 — 링크를 만든 사람이 그룹을 나갔다가 자기 slug 로 재참여하면
     *       스스로를 초대한 것으로 기록된다. {@code InviteLinkClick.claim} 의 셀프 초대 방지와 같은 규칙.</li>
     * </ul>
     *
     * <p>slug 가 없으면 조회 자체를 하지 않는다(구버전 앱 요청은 DB 왕복 0회).
     */
    private GroupInviteLink resolveInviteAttribution(UUID groupId, UUID userId, String inviteSlug) {
        if (inviteSlug == null || inviteSlug.isBlank()) {
            return null;
        }
        return groupInviteLinkRepository.findBySlug(inviteSlug)
                .filter(link -> groupId.equals(link.getGroupId()))
                .filter(link -> !userId.equals(link.getInviterId()))
                .orElse(null);
    }

    /**
     * 두 트랙(Track2 · GA4)의 참여 이벤트를 <b>커밋 이후에</b> 발행한다.
     *
     * <p>{@code save} 는 flush 를 보장하지 않아서 GroupMember INSERT 는 커밋 시점에야 DB 에 닿는다.
     * {@code group_members} 에는 (user_id, group_id) 유니크 제약이 있어, 동시 참여 요청 둘이
     * 중복 멤버 검사를 나란히 통과하면 한쪽이 커밋에서 제약 위반으로 롤백된다 — 이때 인라인 발행이었다면
     * 실제로는 참여하지 못한 유저의 {@code group_joined} 가 이미 두 트랙에 찍힌 뒤다.
     *
     * <p>두 트랙을 함께 옮기는 게 핵심이다. 한쪽만 커밋 이후로 미루면 발행 시점이 어긋나서, 나중에
     * "Track2 엔 있는데 GA4 엔 없다"가 롤백 때문인지 전송 실패 때문인지 구분할 수 없게 된다.
     *
     * <p>트랜잭션 동기화가 없는 호출(단위 테스트 등)에서는 즉시 발행한다.
     */
    private void publishJoinAttribution(Group group, JoinGroupRequest request, GroupInviteLink invite) {
        String joinMethod = normalizeJoinMethod(request.getJoinMethod());
        Runnable emit = () -> {
            logGroupJoined(group, joinMethod, invite);
            // GA4 group_joined 은 서버 단독 소유 이벤트다(앱이 중복 발행하지 않는다 — 스펙 §4-3 8행).
            // 전송은 @Async fire-and-forget 이라 실패해도 예외가 올라오지 않는다.
            ga4MeasurementClient.sendAppEvent(
                    request.getAppInstanceId(), "group_joined", ga4JoinParams(group, joinMethod, invite));
        };
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            emit.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                emit.run();
            }
        });
    }

    /**
     * 참여 경로를 계약(스펙 §4-2)에 정의된 값으로 좁힌다. 클라이언트가 보내는 임의 문자열을 그대로
     * 쓰면 퍼널 차원의 카디널리티가 오염돼 GA4·Track2 집계가 못 쓰게 된다.
     *
     * <p>미전송(null·blank)은 미전송으로 남긴다 — {@code unknown} 으로 채우면 "구버전 앱이라 안 보냄"과
     * "클라가 이상한 값을 보냄"이 한 값으로 뭉개진다. 값은 왔는데 모르는 값일 때만 {@code unknown} 이다.
     */
    private String normalizeJoinMethod(String rawJoinMethod) {
        if (rawJoinMethod == null || rawJoinMethod.isBlank()) {
            return null;
        }
        return ALLOWED_JOIN_METHODS.contains(rawJoinMethod) ? rawJoinMethod : UNKNOWN_JOIN_METHOD;
    }

    /**
     * Track2(user-activity) {@code GROUP_JOINED}. 값이 없는 키는 아예 넣지 않는다 —
     * 빈 값을 채워 넣으면 "구버전 앱이라 안 보냄"과 "검색으로 들어옴"을 구분할 수 없게 된다.
     */
    private void logGroupJoined(Group group, String joinMethod, GroupInviteLink invite) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("group_id", group.getId().toString());
        if (joinMethod != null) {
            payload.put("join_method", joinMethod);
        }
        if (invite != null) {
            payload.put("invite_slug", invite.getSlug());
            payload.put("inviter_id", invite.getInviterId().toString());
        }
        userActivityEventLogger.log(UserActivityEvent.GROUP_JOINED, payload);
    }

    /**
     * GA4 {@code group_joined} 파라미터. Track2 와 키 이름이 일부러 다르다
     * (GA4 는 {@code slug}, Track2 는 {@code invite_slug} — 스펙 §4-3 / §6-3).
     * null 값 제거와 boolean 인코딩은 GA4 클라이언트가 맡으므로 여기서 분기하지 않는다.
     */
    private Map<String, Object> ga4JoinParams(Group group, String joinMethod, GroupInviteLink invite) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("group_id", group.getId().toString());
        params.put("join_method", joinMethod);
        params.put("slug", invite == null ? null : invite.getSlug());
        params.put("inviter_present", invite != null);
        return params;
    }

    public GroupOverviewResponse getGroupOverview(UUID groupId, UUID userId) {
        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        // 순수 읽기(readOnly) — 무락 활성 검증 (GROMO-1237). readOnly 트랜잭션에선 FOR SHARE 불가.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        boolean isMember = groupMemberRepository.findByUserAndGroup(user, group).isPresent();

        // 탈퇴자 제외(GROMO-1220) — 정원 판정(joinGroup)·상세 멤버 목록과 같은 기준.
        int memberCount = activeMembersOf(group).size();

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

    /**
     * 참가 코드 재발급.
     *
     * @deprecated 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31). 앱이 더 이상 호출하지 않는다.
     *     엔드포인트를 남겨두는 것은 계약 파괴를 피하기 위함이며, 실제 제거는 후속 정리 티켓에서 다룬다.
     */
    @Deprecated
    @Transactional
    public RenewGroupCodeResponse renewGroupCode(UUID groupId, UUID userId) {
        // Deprecated 지만 변경 트랜잭션이므로 락 규율은 동일하게 적용 (GROMO-1237).
        User user = requireActiveUser(userId);

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
        // 순수 읽기(readOnly) — 무락 활성 검증 (GROMO-1237). readOnly 트랜잭션에선 FOR SHARE 불가.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        // 탈퇴자 제외(GROMO-1220) — 빈 닉네임 타일 방지 + 프로필 조회 404(ProfileService)와 정합.
        List<GroupMember> groupMembers = activeMembersOf(group);

        List<User> users = groupMembers.stream().map(GroupMember::getUser).toList();
        // GROMO-643: 클라 로컬 날짜(date)로 오늘 집계 조회 (UTC 산정 제거)
        List<DailyFocusStat> focusStats = dailyFocusStatRepository.findByUserInAndDate(users, date);
        Map<UUID, Integer> focusMap = focusStats.stream()
                .collect((Collectors.toMap(
                        s -> s.getUser().getId(),
                        s -> s.getTotalFocusSeconds() / 60   // GROMO-642: 초→분
                )));
        // A-8: 멤버별 전체 누적 집중시간(분) — 리더보드 정렬용 배치 집계
        List<UUID> memberUserIds = users.stream().map(User::getId).toList();
        Map<UUID, Integer> totalFocusMap = memberUserIds.isEmpty() ? Map.of()
                : dailyFocusStatRepository.sumTotalFocusSecondsByUserIdIn(memberUserIds).stream()
                        .collect(Collectors.toMap(
                                DailyFocusStatRepository.UserFocusTotal::getUserId,
                                t -> (int) (t.getTotalSeconds() / 60)));

        List<GroupDetailMemberResponse> list = groupMembers.stream()
                .map(m -> GroupDetailMemberResponse.builder()
                        .userId(m.getUser().getId())
                        .nickname(m.getUser().getNickname())
                        .role(m.getRole())
                        .focusTimeMinutes(focusMap.getOrDefault(m.getUser().getId(), 0))
                        .totalFocusMinutes(totalFocusMap.getOrDefault(m.getUser().getId(), 0))
                        .build())
                // A-8: 누적 집중시간 내림차순, 동점은 닉네임 오름차순 (서버 정렬 — 클라 재정렬 없음)
                .sorted(Comparator
                        .comparingInt(GroupDetailMemberResponse::getTotalFocusMinutes).reversed()
                        .thenComparing(GroupDetailMemberResponse::getNickname,
                                Comparator.nullsLast(Comparator.naturalOrder())))
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
        User user = requireActiveUser(userId);

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
            // 현원도 탈퇴자 제외(GROMO-1220) — 유령 자리 때문에 정원 축소가 막히지 않아야 한다.
            int currentCount = activeMembersOf(group).size();
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

        // A-1: 공개/비밀 전환 (이름 변경은 trgm GIN 인덱스가 자동 반영, 별도 처리 불필요)
        if (request.getIsPrivate() != null) {
            group.updateIsPrivate(request.getIsPrivate());
        }
    }

    public GroupSettingsResponse getGroupSettings(UUID groupId, UUID userId) {
        // 순수 읽기(readOnly) — 무락 활성 검증 (GROMO-1237). readOnly 트랜잭션에선 FOR SHARE 불가.
        User user = userRepository.findByIdAndIsDeletedFalse(userId)
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

        // A-4: 전 활성 멤버의 공지 작성 권한 뷰. 방장은 항상 granted=true(토글 불가),
        // 그 외 멤버는 announcement_permission=ALLOW 여부로 granted 를 채운다.
        // 탈퇴자 제외(GROMO-1220) — 상세 멤버 목록과 같은 기준(빈 닉네임 행 방지).
        List<GroupSettingsResponse.AnnouncementGrant> announcementGrants =
                activeMembersOf(group).stream()
                        .map(m -> GroupSettingsResponse.AnnouncementGrant.builder()
                                .userId(m.getUser().getId())
                                .nickname(m.getUser().getNickname())
                                .granted(m.getRole() == GroupMemberRole.OWNER
                                        || m.getAnnouncementPermission() == GroupAnnouncementGrant.ALLOW)
                                .build())
                        .toList();

        return GroupSettingsResponse.builder()
                .announcementGrants(announcementGrants)
                .build();
    }

    @Transactional
    public void updateGroupSettings(UUID groupId, UUID userId, UpdateGroupSettingsRequest request) {
        User user = requireActiveUser(userId);

        Group group = groupRepository.findById(groupId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));

        GroupMember groupMember = groupMemberRepository.findByUserAndGroup(user, group)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));

        if (groupMember.getRole() != GroupMemberRole.OWNER) {
            throw new GroupException(GroupErrorCode.NOT_OWNER);
        }

        // A-4: 공지 권한 부여/회수 — announcementGrants 의 각 항목을 granted 대로 반영(항목별 upsert).
        // null·빈 리스트 = 미변경, 목록에 없는 멤버는 그대로 유지, 방장/비멤버 id 는 무시.
        List<UpdateGroupSettingsRequest.AnnouncementGrant> grants = request.getAnnouncementGrants();
        if (grants != null && !grants.isEmpty()) {
            Map<UUID, Boolean> grantByUserId = grants.stream()
                    .filter(g -> g.getUserId() != null)
                    .collect(Collectors.toMap(
                            UpdateGroupSettingsRequest.AnnouncementGrant::getUserId,
                            UpdateGroupSettingsRequest.AnnouncementGrant::isGranted,
                            (a, b) -> b));
            // 탈퇴자 제외(GROMO-1220) — 설정 조회(getGroupSettings)에 안 뜨는 유저는 반영 대상도 아니다.
            activeMembersOf(group).stream()
                    .filter(member -> member.getRole() != GroupMemberRole.OWNER)
                    .forEach(member -> {
                        Boolean granted = grantByUserId.get(member.getUser().getId());
                        if (granted == null) {
                            return;   // 요청에 없는 멤버는 미변경
                        }
                        if (granted) {
                            member.allowAnnouncement();
                        } else {
                            member.disallowAnnouncement();
                        }
                    });
        }
    }

    /**
     * 활성 검증 + 공유 락 + 게스트 차단 (GROMO-801 락 규율, GROMO-1226) — 그룹 생성·참여처럼
     * users 행을 <b>읽기만 하고</b> 그 값을 변경(멤버십 저장)의 근거로 쓰는 트랜잭션의 요청자 로드.
     * 락 없는 findById 는 계정 탈퇴(UserService.withdraw, 유저 행 배타 락)와 직렬화되지 않아
     * 탈퇴의 정리 스캔 이후·커밋 이전에 낀 변경이 유령(탈퇴자 소유 그룹·멤버십)으로 남는다.
     * 공유 락끼리는 충돌하지 않아 동시 요청은 그대로 병렬이고, 탈퇴가 먼저 커밋되면
     * is_deleted=true 를 보고 NOT_FOUND(404) 로 거절된다. 게스트는 GUEST_FORBIDDEN(403).
     *
     * <p><b>readOnly 조회 메서드에서는 쓰지 말 것</b> — 이 클래스 기본 트랜잭션이
     * {@code @Transactional(readOnly = true)} 라 Postgres 가 FOR SHARE 를 거절한다
     * (read-only 에서 행 잠금 불가 — {@code GroupBetService.getBetHistory} 주석 참조).
     * 메서드 레벨 {@code @Transactional} 로 쓰기 트랜잭션을 연 변경 경로 전용이다.
     */
    private User requireActiveUser(UUID userId) {
        User user = userRepository.findActiveByIdForShare(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        if (user.isGuest()) {
            throw new GroupException(GroupErrorCode.GUEST_FORBIDDEN);
        }
        return user;
    }

    /**
     * 유저가 이미 {@link #MAX_JOINED_GROUPS} 개 그룹에 소속돼 있으면 409({@code GROUP_LIMIT_EXCEEDED}).
     * 모수는 getMyGroups 와 같은 group_members 행 수다(탈퇴는 행 삭제라 자연 제외).
     *
     * <p>동시성: count → insert 사이에 락이 없어 동시 요청이 상한을 1~2 개 넘길 수 있다(TOCTOU).
     * 바로 아래 ROOM_FULL 검사도 같은 count-then-insert 패턴이고, 이 상한은 보안 경계가 아니라
     * 응답 크기를 묶는 소프트 캡이라 의도적으로 수용한다 — 버그가 아니라 결정이다. 엄격히 막으려면
     * 유저 행 잠금이나 DB 제약이 필요한데, 그 비용(유저 행 경합)이 초과 1~2 개보다 크다고 봤다.
     */
    private void ensureJoinedGroupLimit(User user) {
        if (groupMemberRepository.countByUser(user) >= MAX_JOINED_GROUPS) {
            throw new GroupException(GroupErrorCode.GROUP_LIMIT_EXCEEDED);
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

    /** 대표 챌린지(최신 ACTIVE, 미삭제) + type별 상세에서 상세/오버뷰 응답의 미션 필드를 채운다. */
    private RepresentativeMission resolveRepresentativeMission(Group group) {
        return groupChallengeRepository
                .findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(group, GroupChallengeStatus.ACTIVE)
                .map(this::toRepresentativeMission)
                .orElse(RepresentativeMission.EMPTY);
    }

    private RepresentativeMission toRepresentativeMission(GroupChallenge challenge) {
        Integer durationMinutes = null;
        String windowStart = null;
        String windowEnd = null;
        if (challenge.getType() == MissionType.DURATION) {
            durationMinutes = groupChallengeDurationRepository.findById(challenge.getId())
                    .map(GroupChallengeDuration::getDurationMinutes)
                    .orElse(null);
        } else if (challenge.getType() == MissionType.TIME_WINDOW) {
            // GROMO-1206: 저장 time(KST 벽시계) → "HH:mm:ss" — /challenges 응답과 같은
            // 단일 출구(WindowFocusAggregator.timeOfDayString)를 쓴다. 별도 포맷 신설 금지.
            Optional<GroupChallengeWindow> window = groupChallengeWindowRepository.findById(challenge.getId());
            windowStart = window.map(GroupChallengeWindow::getWindowStart)
                    .map(WindowFocusAggregator::timeOfDayString).orElse(null);
            windowEnd = window.map(GroupChallengeWindow::getWindowEnd)
                    .map(WindowFocusAggregator::timeOfDayString).orElse(null);
        }
        return new RepresentativeMission(
                challenge.getCategory(), challenge.getType(), durationMinutes, windowStart, windowEnd);
    }

    /**
     * 상세/오버뷰 JSON 계약(missionCategory/missionType/durationMinutes/windowStart/windowEnd) 유지용 뷰.
     * 창 시각은 KST 벽시계 "HH:mm:ss" 문자열이다(GROMO-1206).
     */
    private record RepresentativeMission(
            MissionCategory missionCategory,
            MissionType missionType,
            Integer durationMinutes,
            String windowStart,
            String windowEnd) {

        private static final RepresentativeMission EMPTY = new RepresentativeMission(null, null, null, null, null);
    }

    /**
     * 8자 참가 코드 생성.
     *
     * @deprecated 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
     *     createGroup 이 아직 호출하지만 발급된 코드를 조회하는 경로가 없다. CHARS/RANDOM 도 같이 dead 다.
     */
    @Deprecated
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
