package com.oneorthree.phone.group.service;

import com.oneorthree.phone.common.analytics.Ga4MeasurementClient;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupJoinCode;
import com.oneorthree.phone.group.domain.GroupJoinCodeStatus;
import com.oneorthree.phone.group.domain.GroupMember;
import com.oneorthree.phone.group.domain.GroupMemberRole;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupJoinCodeRepository;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.UserScreenTimeSettingsRepository;
import com.oneorthree.phone.group.domain.GroupStatus;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.group.domain.GroupAnnouncement;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeDuration;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupChallengeBetRepository;
import com.oneorthree.phone.group.repository.GroupChallengeDurationRepository;
import com.oneorthree.phone.group.repository.GroupChallengeRepository;
import com.oneorthree.phone.group.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.GroupChallengeWindowRepository;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.dto.CreateGroupResponse;
import com.oneorthree.phone.group.dto.GroupAnnouncementResponse;
import com.oneorthree.phone.group.dto.GroupChallengeResponse;
import com.oneorthree.phone.group.dto.GroupDetailMemberResponse;
import com.oneorthree.phone.group.dto.GroupDetailResponse;
import com.oneorthree.phone.group.dto.UpdateGroupRequest;
import com.oneorthree.phone.group.dto.GroupSearchResponse;
import com.oneorthree.phone.group.dto.GroupOverviewResponse;
import com.oneorthree.phone.group.dto.GroupSettingsResponse;
import com.oneorthree.phone.group.dto.GroupSummaryResponse;
import com.oneorthree.phone.group.dto.JoinGroupRequest;
import com.oneorthree.phone.group.dto.RenewGroupCodeResponse;
import com.oneorthree.phone.group.dto.UpdateGroupSettingsRequest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class GroupServiceTest {

    @InjectMocks
    private GroupService groupService;

    @InjectMocks
    private GroupAnnouncementService groupAnnouncementService;

    @InjectMocks
    private GroupChallengeService groupChallengeService;

    @InjectMocks
    private GroupMemberService groupMemberService;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private GroupRepository groupRepository;

    @Mock
    private GroupJoinCodeRepository groupJoinCodeRepository;

    @Mock
    private GroupMemberRepository groupMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PasswordEncoder passwordEncoder;

    @Mock
    private GroupAnnouncementRepository groupAnnouncementRepository;

    @Mock
    private GroupChallengeRepository groupChallengeRepository;

    @Mock
    private GroupChallengeDurationRepository groupChallengeDurationRepository;

    @Mock
    private GroupChallengeWindowRepository groupChallengeWindowRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private UserScreenTimeSettingsRepository userScreenTimeSettingsRepository;

    // 내기 조립은 GroupBetService 가 맡는다. Map 반환이라 스텁 없이도 빈 맵이 나와
    // (Mockito 기본값) 내기와 무관한 이 테스트들은 bet/lastSettledBet 을 null 로 본다.
    @Mock
    private GroupBetService groupBetService;

    // 휴면 배지(GROMO-1201) 이력·OPEN 조회용 — 날짜 무관이라 date=null 조회에서도 불린다.
    // 스텁이 없으면 빈 리스트(Mockito 기본값) = 이력 없음 → dormant 는 항상 false 로 남는다.
    @Mock
    private GroupChallengeBetRepository groupChallengeBetRepository;

    @Mock
    private GroupInviteLinkRepository groupInviteLinkRepository;

    @Mock
    private Ga4MeasurementClient ga4MeasurementClient;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID GROUP_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID GROUP_ID_2 = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID GROUP_ID_99 = UUID.fromString("00000000-0000-0000-0000-000000000099");
    private static final UUID GROUP_SAVE_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final UUID ANNOUNCEMENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final UUID CHALLENGE_ID = UUID.fromString("00000000-0000-0000-0000-000000000020");

    // ── 헬퍼 ──────────────────────────────────────────────────────────────

    // D18: 그룹 생성 요청은 더 이상 미션(챌린지) 필드를 담지 않는다 — durationMinutes 인자는
    // 호출부 시그니처 호환을 위해 남겨두되(생성 자체엔 영향 없음) 요청 바디엔 반영하지 않는다.
    private CreateGroupRequest durationRequest(String password, Integer maxMembers, Integer durationMinutes) {
        return durationRequest(password, maxMembers, durationMinutes, false);
    }

    private CreateGroupRequest durationRequest(String password, Integer maxMembers, Integer durationMinutes,
            boolean isPrivate) {
        return CreateGroupRequest.builder()
                .name("스터디룸").password(password).description("설명").maxMembers(maxMembers)
                .isPrivate(isPrivate)
                .build();
    }

    private User normalUser() {
        return User.builder().isGuest(false).build();
    }

    /** 탈퇴 유저(GROMO-1220) — 소프트딜리트로 nickname 은 파기(null)됐고 is_deleted=true. 유령 멤버십 주인. */
    private User withdrawnUser() {
        return User.builder()
                .id(UUID.fromString("00000000-0000-0000-0000-0000000000dd"))
                .isGuest(false).isDeleted(true).build();
    }

    // GROMO-672: 참가 코드는 이제 Group 이 아니라 GroupJoinCode(1:1) 소유.
    //   code/codeExpiresAt 인자는 매핑 소스인 GroupJoinCode 를 통해 검증한다(joinCodeFor).
    private Group groupWithCode(UUID id, String code, Instant codeExpiresAt) {
        return Group.builder().id(id).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    private GroupJoinCode joinCodeFor(Group group, String code, Instant expiresAt) {
        return GroupJoinCode.builder().group(group).code(code)
                .status(GroupJoinCodeStatus.ACTIVE).expiresAt(expiresAt).build();
    }

    /** 그룹별 멤버 수 IN 집계(countByGroupIdIn) 결과 행 — 목록/검색의 N+1 제거 경로. */
    private GroupMemberRepository.GroupMemberCount memberCount(UUID groupId, long count) {
        return new GroupMemberRepository.GroupMemberCount() {
            @Override
            public UUID getGroupId() {
                return groupId;
            }

            @Override
            public long getMemberCount() {
                return count;
            }
        };
    }

    /** save()가 id가 채워진 엔티티를 반환하도록 흉내낸다 (서비스가 group.getId()를 사용). */
    private void givenSaveReturnsGroupWithId(UUID id) {
        given(groupRepository.save(any(Group.class)))
                .willReturn(Group.builder().id(id).build());
    }

    /** GROMO-674: 대표 챌린지(DURATION/FOCUS, ACTIVE) + duration 상세 스텁 — 상세/오버뷰 미션 필드 소스. */
    private void givenRepresentativeDurationChallenge(Group group, int durationMinutes) {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).type(MissionType.DURATION)
                .category(MissionCategory.FOCUS).status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
                group, GroupChallengeStatus.ACTIVE)).willReturn(Optional.of(challenge));
        given(groupChallengeDurationRepository.findById(CHALLENGE_ID)).willReturn(
                Optional.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(durationMinutes).build()));
    }

    /**
     * GROMO-1206: TIME_WINDOW 대표 챌린지(ACTIVE) + 창 상세 스텁 — 상세/오버뷰의
     * windowStart/windowEnd "HH:mm:ss" 계약 테스트가 공용한다 (GROMO-1230).
     */
    private void givenRepresentativeTimeWindowChallenge(
            Group group, MissionCategory category, Instant windowStartAt, Instant windowEndAt) {
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).type(MissionType.TIME_WINDOW)
                .category(category).status(GroupChallengeStatus.ACTIVE).build();
        given(groupChallengeRepository.findFirstByGroupAndStatusAndDeletedAtIsNullOrderByCreatedAtAsc(
                group, GroupChallengeStatus.ACTIVE)).willReturn(Optional.of(challenge));
        given(groupChallengeWindowRepository.findById(CHALLENGE_ID)).willReturn(
                Optional.of(GroupChallengeWindow.builder()
                        .challengeId(CHALLENGE_ID).windowStartAt(windowStartAt).windowEndAt(windowEndAt).build()));
    }

    // ── 정상 생성 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 생성 → 그룹 저장 + OWNER 멤버 저장 + 8자 코드 반환")
    void createGroupSuccess() {
        // given
        CreateGroupRequest request = durationRequest("1234", null, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        given(passwordEncoder.encode("1234")).willReturn("hashed-pw");
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        CreateGroupResponse response = groupService.createGroup(USER_ID, request);

        // then
        assertThat(response.groupId()).isEqualTo(GROUP_SAVE_ID);
        assertThat(response.code()).hasSize(8);

        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        Group savedGroup = groupCaptor.getValue();
        assertThat(savedGroup.getPassword()).isEqualTo("hashed-pw");

        // GROMO-672: 참가 코드/만료시각은 GroupJoinCode(1:1) 로 저장
        ArgumentCaptor<GroupJoinCode> joinCodeCaptor = ArgumentCaptor.forClass(GroupJoinCode.class);
        verify(groupJoinCodeRepository).save(joinCodeCaptor.capture());
        GroupJoinCode savedJoinCode = joinCodeCaptor.getValue();
        assertThat(savedJoinCode.getCode()).hasSize(8);
        assertThat(savedJoinCode.getStatus()).isEqualTo(GroupJoinCodeStatus.ACTIVE);
        assertThat(savedJoinCode.getExpiresAt()).isAfter(Instant.now());

        ArgumentCaptor<GroupMember> memberCaptor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(GroupMemberRole.OWNER);

        // D18: 그룹 생성 시 대표 챌린지를 만들지 않는다 — 챌린지 저장이 일어나지 않아야 한다.
        verify(groupChallengeRepository, never()).save(any());
        verify(groupChallengeDurationRepository, never()).save(any());
        verify(groupChallengeWindowRepository, never()).save(any());
    }

    @Test
    @DisplayName("isPrivate=true 생성 → 비공개 그룹으로 저장")
    void createGroupPrivate() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        groupService.createGroup(USER_ID, durationRequest(null, 5, 60, true));

        // then
        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        assertThat(groupCaptor.getValue().isPrivate()).isTrue();
    }

    @Test
    @DisplayName("isPrivate 미전송(기본값) → 공개 그룹으로 저장")
    void createGroupDefaultsToPublic() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        // when
        groupService.createGroup(USER_ID, durationRequest(null, 5, 60));

        // then
        ArgumentCaptor<Group> groupCaptor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(groupCaptor.capture());
        assertThat(groupCaptor.getValue().isPrivate()).isFalse();
    }

    @Test
    @DisplayName("maxMembers 미지정 → 기본값 10으로 저장")
    void createGroupDefaultsMaxMembers() {
        // given
        CreateGroupRequest request = durationRequest(null, null, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getMaxMembers()).isEqualTo(10);
    }

    @Test
    @DisplayName("비밀번호 없으면 BCrypt 인코딩을 호출하지 않고 password=null로 저장")
    void createGroupWithoutPassword() {
        // given
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(passwordEncoder, never()).encode(anyString());
        ArgumentCaptor<Group> captor = ArgumentCaptor.forClass(Group.class);
        verify(groupRepository).save(captor.capture());
        assertThat(captor.getValue().getPassword()).isNull();
    }

    // ── 게스트 / 유저 검증 ────────────────────────────────────────────────

    @Test
    @DisplayName("게스트 계정 → GUEST_FORBIDDEN, 그룹 저장 안 함")
    void createGroupRejectsGuest() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GUEST_FORBIDDEN);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("유저 없음·탈퇴 선커밋 → UserException(NOT_FOUND), 그룹 저장 안 함 (D9 — 종전 GUEST_FORBIDDEN 오분류 정정)")
    void createGroupUserNotFound() {
        // given: 없는 유저와 탈퇴가 먼저 커밋된 유저는 공유 락 조회에서 똑같이 빈 결과다
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());

        // when & then: joinGroup 등 형제 경로와 같은 404 — 부작용(그룹 저장) 없음
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 60)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("createGroup 은 요청자를 공유 락으로 로드한다 — 계정 탈퇴 배타 락과 직렬화 (GROMO-1226)")
    void createGroupLoadsUserWithSharedLock() {
        // 락 없는 findById 면 탈퇴의 정리 스캔(멤버십 0 확인) 이후·커밋 이전에 낀 생성이 정리를
        // 빠져나가, 탈퇴자가 OWNER 인 is_left=false 그룹이 영구 잔존한다(재탈퇴·위임 불가).
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);
        givenSaveReturnsGroupWithId(GROUP_SAVE_ID);

        groupService.createGroup(USER_ID, durationRequest(null, 5, 60));

        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
    }

    // D18: 그룹 생성 단계의 미션 파라미터 검증(INVALID_MISSION_PARAMS)은 폐지됐다 —
    // 미션은 그룹 생성이 아니라 그룹방의 챌린지 생성 API가 검증한다(GroupChallengeService).

    // ── 참가 코드 생성 ────────────────────────────────────────────────────

    @Test
    @DisplayName("코드 충돌 시 재시도 후 성공")
    void createGroupRetriesOnCodeCollision() {
        // given: 첫 코드는 충돌(이미 존재), 두 번째는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.empty());
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then
        verify(groupJoinCodeRepository, times(2)).existsByCode(anyString());
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("10회 모두 충돌 → CODE_GENERATION_FAILED, 저장 안 함")
    void createGroupFailsAfterMaxRetries() {
        // given: 항상 충돌
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true);
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, request))
                .isInstanceOf(GroupException.class);
        verify(groupJoinCodeRepository, times(10)).existsByCode(anyString());
        verify(groupRepository, never()).save(any());
    }

    @Test
    @DisplayName("충돌 코드가 만료 상태면 ENDED 로 정리하고 다른 코드로 재시도")
    void createGroupExpiresStaleCollidingCode() {
        // given: 첫 코드 충돌 + 그 코드는 이미 만료 → expire() 대상, 두 번째 코드는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        GroupJoinCode expiredCollision = joinCodeFor(Group.builder().id(GROUP_ID).build(), "OLDCODE1",
                Instant.now().minus(1, ChronoUnit.HOURS));
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.of(expiredCollision));
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then: 만료 충돌 코드는 ENDED 로 정리됨(재사용 아님 — 새 코드로 발급)
        assertThat(expiredCollision.getStatus()).isEqualTo(GroupJoinCodeStatus.ENDED);
        verify(groupRepository).save(any(Group.class));
    }

    @Test
    @DisplayName("충돌 코드가 아직 유효하면 상태를 건드리지 않고 재시도만 한다")
    void createGroupKeepsActiveCollidingCode() {
        // given: 첫 코드 충돌 + 그 코드는 아직 유효(미래 만료) → 상태 유지, 두 번째 코드는 사용 가능
        CreateGroupRequest request = durationRequest(null, 5, 60);
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(true, false);
        GroupJoinCode activeCollision = joinCodeFor(Group.builder().id(GROUP_ID).build(), "LIVECODE",
                Instant.now().plus(1, ChronoUnit.HOURS));
        given(groupJoinCodeRepository.findByCode(anyString())).willReturn(Optional.of(activeCollision));
        givenSaveReturnsGroupWithId(GROUP_ID);

        // when
        groupService.createGroup(USER_ID, request);

        // then: 유효한 충돌 코드는 그대로 ACTIVE 유지
        assertThat(activeCollision.getStatus()).isEqualTo(GroupJoinCodeStatus.ACTIVE);
        verify(groupRepository).save(any(Group.class));
    }

    // ── getMyGroups ───────────────────────────────────────────────────────

    @Test
    @DisplayName("내 그룹 목록 조회 성공 → 참여 그룹 수만큼 반환")
    void getMyGroupsSuccess() {
        // given
        User user = normalUser();
        Group group1 = Group.builder().id(GROUP_ID).name("그룹A")
                .maxMembers(5).status(GroupStatus.WAITING).build();
        Group group2 = Group.builder().id(GROUP_ID_2).name("그룹B")
                .maxMembers(10).status(GroupStatus.ACTIVE).isPrivate(true).build();

        GroupMember member1 = GroupMember.builder().user(user).group(group1).role(GroupMemberRole.OWNER).build();
        GroupMember member2 = GroupMember.builder().user(user).group(group2).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUser(user)).willReturn(List.of(member1, member2));
        // 멤버 수는 그룹마다가 아니라 IN 집계 1회로 조회한다 (N+1 제거)
        given(groupMemberRepository.countByGroupIdIn(List.of(GROUP_ID, GROUP_ID_2)))
                .willReturn(List.of(memberCount(GROUP_ID, 1), memberCount(GROUP_ID_2, 1)));
        // GROMO-672: 요약 응답의 code 는 group_join_codes 일괄 조회(findAllById)로 채운다 — N+1 방지
        given(groupJoinCodeRepository.findAllById(List.of(GROUP_ID, GROUP_ID_2)))
                .willReturn(List.of(
                        GroupJoinCode.builder().groupId(GROUP_ID).group(group1).code("AAAA1111").build(),
                        GroupJoinCode.builder().groupId(GROUP_ID_2).group(group2).code("BBBB2222").build()));

        // when
        List<GroupSummaryResponse> result = groupService.getMyGroups(USER_ID);

        // then
        assertThat(result).hasSize(2);

        GroupSummaryResponse first = result.get(0);
        assertThat(first.getGroupId()).isEqualTo(GROUP_ID);
        assertThat(first.getName()).isEqualTo("그룹A");
        assertThat(first.getCode()).isEqualTo("AAAA1111");
        assertThat(first.getRole()).isEqualTo(GroupMemberRole.OWNER);
        assertThat(first.getCurrentMembers()).isEqualTo(1);
        assertThat(first.getStatus()).isEqualTo(GroupStatus.WAITING);
        assertThat(first.isPrivate()).isFalse();

        GroupSummaryResponse second = result.get(1);
        assertThat(second.getGroupId()).isEqualTo(GROUP_ID_2);
        assertThat(second.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(second.getStatus()).isEqualTo(GroupStatus.ACTIVE);
        assertThat(second.isPrivate()).isTrue();

        // 락 규율 (GROMO-1237): 순수 읽기(readOnly)는 무락 활성 검증 — 락 조회·무필터 findById 금지.
        verify(userRepository).findByIdAndIsDeletedFalse(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
        verify(userRepository, never()).findActiveByIdForShare(USER_ID);
    }

    @Test
    @DisplayName("참여 그룹 없으면 빈 리스트 반환")
    void getMyGroupsEmpty() {
        // given
        User user = normalUser();
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUser(user)).willReturn(List.of());

        // when
        List<GroupSummaryResponse> result = groupService.getMyGroups(USER_ID);

        // then
        assertThat(result).isEmpty();
    }

    @Test
    @DisplayName("존재하지 않는 유저 → UserException")
    void getMyGroupsUserNotFound() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getMyGroups(USER_ID))
                .isInstanceOf(UserException.class);
    }

    // ── searchGroups ──────────────────────────────────────────────────────

    @Test
    @DisplayName("null 쿼리 → 공개방 기본 목록(findTopPublicGroups) 반환, trgm 미호출 (A-10)")
    void searchGroupsNullQueryReturnsTopPublic() {
        // given: 검색어 없이 시트 열림 → 서버가 공개방 최신순 상위 10개를 준다
        Group publicGroup = Group.builder().id(GROUP_ID).name("공개스터디").maxMembers(5)
                .status(GroupStatus.WAITING).build();
        given(groupRepository.findTopPublicGroups(10)).willReturn(List.of(publicGroup));
        given(groupMemberRepository.countByGroupIdIn(List.of(GROUP_ID)))
                .willReturn(List.of(memberCount(GROUP_ID, 2)));

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(null);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        assertThat(result.get(0).getCurrentMembers()).isEqualTo(2);
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
    }

    @Test
    @DisplayName("빈 문자열 쿼리 → 기본 목록 조회(findTopPublicGroups), trgm 미호출 (A-10)")
    void searchGroupsEmptyQueryUsesDefaultList() {
        groupService.searchGroups("");

        verify(groupRepository).findTopPublicGroups(10);
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
    }

    @Test
    @DisplayName("공백만 있는 쿼리 → 기본 목록 조회(findTopPublicGroups), trgm 미호출 (A-10)")
    void searchGroupsBlankQueryUsesDefaultList() {
        groupService.searchGroups("   ");

        verify(groupRepository).findTopPublicGroups(10);
        verify(groupRepository, never()).searchPublicByNameTrgm(anyString(), anyInt());
    }

    // ── updateGroup 공개/비밀 전환 (A-1) ──────────────────────────────────

    @Test
    @DisplayName("OWNER 가 공개→비밀 전환 → group.isPrivate 반영 (A-1)")
    void updateGroupChangesIsPrivate() {
        User owner = userWithNickname(USER_ID, "방장");
        Group group = Group.builder().id(GROUP_ID).name("그룹").maxMembers(10)
                .status(GroupStatus.WAITING).isPrivate(false).build();
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));

        // UpdateGroupRequest 는 빌더/세터가 없어 필드만 리플렉션으로 세팅
        UpdateGroupRequest request = new UpdateGroupRequest();
        ReflectionTestUtils.setField(request, "isPrivate", Boolean.TRUE);

        groupService.updateGroup(GROUP_ID, USER_ID, request);

        assertThat(group.isPrivate()).isTrue();
        // 락 규율 (GROMO-1237): 그룹 수정(변경) 트랜잭션은 공유 락 활성 조회 — 무락 findById 금지.
        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
    }

    @Test
    @DisplayName("OWNER 아니면 공개/비밀 수정 불가 → NOT_OWNER, 값 불변 (A-1)")
    void updateGroupIsPrivateRejectsNonOwner() {
        User member = userWithNickname(USER_ID, "멤버");
        Group group = Group.builder().id(GROUP_ID).name("그룹").maxMembers(10)
                .status(GroupStatus.WAITING).isPrivate(false).build();
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));

        UpdateGroupRequest request = new UpdateGroupRequest();
        ReflectionTestUtils.setField(request, "isPrivate", Boolean.TRUE);

        assertThatThrownBy(() -> groupService.updateGroup(GROUP_ID, USER_ID, request))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.NOT_OWNER);
        assertThat(group.isPrivate()).isFalse();
    }

    @Test
    @DisplayName("maxMembers 축소 검증의 현원도 탈퇴자를 제외한다 — 유령 자리 때문에 축소가 막히지 않는다 (GROMO-1220)")
    void updateGroupMaxMembersIgnoresWithdrawnGhosts() {
        User owner = userWithNickname(USER_ID, "방장");
        Group group = Group.builder().id(GROUP_ID).name("그룹").maxMembers(10)
                .status(GroupStatus.WAITING).build();
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        // 활성 1(방장) + 유령 1 — 실인원은 1명이라 max=1 로 줄일 수 있어야 한다.
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(
                ownerMember, GroupMember.builder().user(withdrawnUser()).group(group).build()));

        UpdateGroupRequest request = new UpdateGroupRequest();
        ReflectionTestUtils.setField(request, "maxMembers", 1);

        groupService.updateGroup(GROUP_ID, USER_ID, request);

        assertThat(group.getMaxMembers()).isEqualTo(1);
    }

    // ── getGroupDetail 멤버 리더보드 정렬 (A-8) ───────────────────────────

    @Test
    @DisplayName("멤버 목록은 전체 누적 집중시간 내림차순으로 서버 정렬된다 (A-8)")
    void getGroupDetailSortsMembersByTotalFocusDesc() {
        UUID uMid = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
        UUID uTop = UUID.fromString("00000000-0000-0000-0000-0000000000a3");
        User me = userWithNickname(USER_ID, "나");     // 누적 낮음
        User mid = userWithNickname(uMid, "중간");
        User top = userWithNickname(uTop, "최상");
        Group group = Group.builder().id(GROUP_ID).name("그룹").maxMembers(10)
                .status(GroupStatus.WAITING).build();
        GroupMember gmMe = GroupMember.builder().user(me).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember gmMid = GroupMember.builder().user(mid).group(group).role(GroupMemberRole.MEMBER).build();
        GroupMember gmTop = GroupMember.builder().user(top).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(me));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(me, group)).willReturn(Optional.of(gmMe));
        // 삽입 순서는 누적과 무관(정렬 자체를 검증) — 나(낮음)·중간·최상 순으로 넣는다
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(gmMe, gmMid, gmTop));
        // 목 행은 given() 밖에서 먼저 조립한다 — willReturn 인자 안에서 focusTotal 이 중첩 스터빙하면
        // Mockito UnfinishedStubbingException 이 난다.
        List<DailyFocusStatRepository.UserFocusTotal> rows = List.of(
                focusTotal(USER_ID, 60),     // 1분
                focusTotal(uMid, 600),       // 10분
                focusTotal(uTop, 6000));     // 100분
        given(dailyFocusStatRepository.sumTotalFocusSecondsByUserIdIn(anyList())).willReturn(rows);

        GroupDetailResponse response =
                groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.getMembers()).extracting(GroupDetailMemberResponse::getNickname)
                .containsExactly("최상", "중간", "나");
        assertThat(response.getMembers().get(0).getTotalFocusMinutes()).isEqualTo(100);
        assertThat(response.getMembers().get(2).getTotalFocusMinutes()).isEqualTo(1);
    }

    /** A-8 누적 집중 배치 조회 결과 행(UserFocusTotal 프로젝션) 목 생성 헬퍼. */
    private DailyFocusStatRepository.UserFocusTotal focusTotal(UUID userId, long seconds) {
        DailyFocusStatRepository.UserFocusTotal row = mock(DailyFocusStatRepository.UserFocusTotal.class);
        given(row.getUserId()).willReturn(userId);
        given(row.getTotalSeconds()).willReturn(seconds);
        return row;
    }

    @Test
    @DisplayName("그룹 상세 멤버 목록은 탈퇴자를 제외한다 — 빈 닉네임 타일이 남지 않는다 (GROMO-1220)")
    void getGroupDetailExcludesWithdrawnMembers() {
        User me = userWithNickname(USER_ID, "나");
        Group group = Group.builder().id(GROUP_ID).name("그룹").maxMembers(10)
                .status(GroupStatus.WAITING).build();
        GroupMember gmMe = GroupMember.builder().user(me).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember ghost = GroupMember.builder().user(withdrawnUser()).group(group)
                .role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(me));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(me, group)).willReturn(Optional.of(gmMe));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(gmMe, ghost));

        GroupDetailResponse response =
                groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // 오버뷰 memberCount·정원 판정과 같은 기준이라 "N명인데 N-1 타일" 불일치가 없다.
        assertThat(response.getMembers())
                .extracting(GroupDetailMemberResponse::getUserId)
                .containsExactly(USER_ID);
    }

    @Test
    @DisplayName("이름 검색 성공 → 매칭 그룹 반환, hasPassword 필드 정확")
    void searchGroupsByName() {
        // given
        String query = "스터디";
        Group groupA = Group.builder().id(GROUP_ID).name("스터디A").maxMembers(5)
                .status(GroupStatus.WAITING).build();
        Group groupB = Group.builder().id(GROUP_ID_2).name("스터디B").maxMembers(10)
                .status(GroupStatus.ACTIVE).password("hashed").build();

        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of(groupA, groupB));
        // 멤버 수는 결과 그룹 전체를 IN 집계 1회로 조회한다 (N+1 제거)
        given(groupMemberRepository.countByGroupIdIn(List.of(GROUP_ID, GROUP_ID_2)))
                .willReturn(List.of(memberCount(GROUP_ID, 3)));

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(query);

        // then
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        assertThat(result.get(0).getCurrentMembers()).isEqualTo(3);
        assertThat(result.get(0).isHasPassword()).isFalse();
        // 집계 결과에 없는 그룹(멤버 0)은 0으로 채운다
        assertThat(result.get(1).getCurrentMembers()).isZero();
        assertThat(result.get(1).getGroupId()).isEqualTo(GROUP_ID_2);
        assertThat(result.get(1).isHasPassword()).isTrue();
    }

    @Test
    @DisplayName("검색은 LIMIT 20 으로 위임한다 — 무제한 반환하지 않는다")
    void searchGroupsAppliesLimit() {
        // given
        String query = "스터디";
        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of());

        // when
        groupService.searchGroups(query);

        // then: is_private=false · deleted_at IS NULL 필터와 LIMIT 은 네이티브 쿼리가 책임진다
        //   (여기서는 위임 값만 본다 — SQL 자체의 동작은 실 DB 로 GroupRepositoryTest 가 검증한다)
        ArgumentCaptor<Integer> limitCaptor = ArgumentCaptor.forClass(Integer.class);
        verify(groupRepository).searchPublicByNameTrgm(eq(query), limitCaptor.capture());
        assertThat(limitCaptor.getValue()).isEqualTo(20);
    }

    @Test
    @DisplayName("비공개 그룹은 검색 결과에서 제외된다 — 코드 정확 매칭 분기도 사라졌다")
    void searchGroupsExcludesPrivateGroups() {
        // given: 레포지토리(is_private=false 필터)가 공개 그룹만 돌려준다.
        //   그 필터가 실제로 비공개를 거르는지는 GroupRepositoryTest 가 실 DB 로 잠근다 — 여기는 조립만 본다.
        String query = "스터디";
        Group publicGroup = Group.builder().id(GROUP_ID).name("스터디공개").maxMembers(5)
                .status(GroupStatus.WAITING).isPrivate(false).build();

        given(groupRepository.searchPublicByNameTrgm(query, 20)).willReturn(List.of(publicGroup));
        given(groupMemberRepository.countByGroupIdIn(List.of(GROUP_ID)))
                .willReturn(List.of(memberCount(GROUP_ID, 1)));

        // when
        List<GroupSearchResponse> result = groupService.searchGroups(query);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGroupId()).isEqualTo(GROUP_ID);
        // 참가 코드 체계 폐기(2026-07-31) — 검색은 더 이상 group_join_codes 를 보지 않는다
        verify(groupJoinCodeRepository, never()).findByCode(anyString());
    }

    // ── getGroupOverview ──────────────────────────────────────────────────

    @Test
    @DisplayName("멤버인 유저 → isMember=true, 전체 필드 정상 반환")
    void getGroupOverviewMember() {
        // given
        User user = normalUser();
        Group group = Group.builder()
                .id(GROUP_ID).name("스터디룸").description("열심히 공부")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        GroupMember member = GroupMember.builder().user(user).group(group).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member));
        givenRepresentativeDurationChallenge(group, 60);

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.getId()).isEqualTo(GROUP_ID);
        assertThat(result.getName()).isEqualTo("스터디룸");
        assertThat(result.getMemberCount()).isEqualTo(1);
        assertThat(result.isMember()).isTrue();
        assertThat(result.isHasPassword()).isFalse();
        // GROMO-674: 미션 필드는 대표 챌린지(+duration 상세)에서 채워진다
        assertThat(result.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(result.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(result.getDurationMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("오버뷰 memberCount 도 탈퇴자를 제외한다 — 상세 멤버 목록·정원 판정과 같은 기준 (GROMO-1220)")
    void getGroupOverviewExcludesWithdrawnMembers() {
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("스터디룸")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        GroupMember member = GroupMember.builder().user(user).group(group).build();
        GroupMember ghost = GroupMember.builder().user(withdrawnUser()).group(group).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(member, ghost));
        givenRepresentativeDurationChallenge(group, 60);

        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // 카운트가 유령을 세면 상세 타일 수와 어긋난다("2명인데 1명 타일").
        assertThat(result.getMemberCount()).isEqualTo(1);
    }

    @Test
    @DisplayName("TIME_WINDOW 대표 챌린지 → windowStart/windowEnd 는 KST 벽시계 \"HH:mm:ss\" 문자열")
    void getGroupOverviewTimeWindowMission() {
        // given — 저장은 UTC Instant, 응답은 KST 벽시계(GROMO-1206, /challenges 와 동일 계약).
        //   04:00Z = 13:00 KST, 06:30Z = 15:30 KST.
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        givenRepresentativeTimeWindowChallenge(group, MissionCategory.SCREEN_TIME,
                Instant.parse("2026-07-10T04:00:00Z"), Instant.parse("2026-07-10T06:30:00Z"));

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then — Instant ISO 가 아니라 "HH:mm:ss" 다. ISO 로 새면 앱 timeStrToSeconds 가 조용히 NaN.
        assertThat(result.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(result.getMissionType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(result.getWindowStart()).isEqualTo("13:00:00");
        assertThat(result.getWindowEnd()).isEqualTo("15:30:00");
        assertThat(result.getDurationMinutes()).isNull();
    }

    @Test
    @DisplayName("자정 걸침 창 → 날짜 없이 벽시계만 남아 시작 ≥ 종료 문자열로 내려간다")
    void getGroupOverviewMidnightCrossingWindow() {
        // given — 13:00Z = 22:00 KST(당일), 16:00Z = 01:00 KST(익일). 응답엔 날짜가 없으므로
        //   "22:00:00" > "01:00:00" 이 자정 걸침의 유일한 신호다(WindowFocusAggregator 해석과 동일).
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        givenRepresentativeTimeWindowChallenge(group, MissionCategory.FOCUS,
                Instant.parse("2026-07-10T13:00:00Z"), Instant.parse("2026-07-10T16:00:00Z"));

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.getWindowStart()).isEqualTo("22:00:00");
        assertThat(result.getWindowEnd()).isEqualTo("01:00:00");
    }

    @Test
    @DisplayName("멤버 아닌 유저 → isMember=false")
    void getGroupOverviewNotMember() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.isMember()).isFalse();
        assertThat(result.getMemberCount()).isEqualTo(0);
        // GROMO-674: 대표 챌린지(ACTIVE)가 없으면 미션 필드는 null
        assertThat(result.getMissionCategory()).isNull();
        assertThat(result.getMissionType()).isNull();
    }

    @Test
    @DisplayName("비밀번호 그룹 → hasPassword=true")
    void getGroupOverviewHasPassword() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
                .maxMembers(5).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        GroupOverviewResponse result = groupService.getGroupOverview(GROUP_ID, USER_ID);

        // then
        assertThat(result.isHasPassword()).isTrue();
    }

    @Test
    @DisplayName("존재하지 않는 groupId → GroupException")
    void getGroupOverviewGroupNotFound() {
        // given
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupOverview(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void getGroupOverviewUserNotFound() {
        // given
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();

        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupOverview(GROUP_ID, USER_ID))
                .isInstanceOf(UserException.class);
    }

    // ── renewGroupCode (GROMO-347) ────────────────────────────────────────

    @Test
    @DisplayName("OWNER가 호출 → 새 코드 + 3시간 후 만료시각 반환")
    void renewGroupCodeOwnerSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", null);
        GroupMember owner = GroupMember.builder().user(user).group(group).role(GroupMemberRole.OWNER).build();
        GroupJoinCode joinCode = joinCodeFor(group, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(owner));
        given(groupJoinCodeRepository.findById(GROUP_ID)).willReturn(Optional.of(joinCode));
        given(groupJoinCodeRepository.existsByCode(anyString())).willReturn(false);

        // when
        RenewGroupCodeResponse response = groupService.renewGroupCode(GROUP_ID, USER_ID);

        // then
        assertThat(response.getCode()).hasSize(8);
        assertThat(response.getCode()).isNotEqualTo("OLD12345");
        assertThat(response.getCodeExpiresAt()).isAfter(Instant.now());
    }

    @Test
    @DisplayName("MEMBER가 호출 → NOT_OWNER")
    void renewGroupCodeMemberForbidden() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("그룹 멤버 아님 → NOT_OWNER")
    void renewGroupCodeNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "OLD12345", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void renewGroupCodeGuestForbidden() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void renewGroupCodeGroupNotFound() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.renewGroupCode(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── getGroupDetail (GROMO-285) ────────────────────────────────────────

    private User userWithNickname(UUID id, String nickname) {
        return User.builder().id(id).isGuest(false).nickname(nickname).build();
    }

    @Test
    @DisplayName("OWNER 조회 → code, codeExpiresAt 포함")
    void getGroupDetailOwnerSeesCode() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        Instant expiry = Instant.now().plus(3, ChronoUnit.HOURS);
        Group group = groupWithCode(GROUP_ID, "INVITE01", null);
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember));
        givenRepresentativeDurationChallenge(group, 60);
        // GROMO-672: OWNER 상세의 code/codeExpiresAt 은 group_join_codes 에서 조회
        given(groupJoinCodeRepository.findById(GROUP_ID))
                .willReturn(Optional.of(joinCodeFor(group, "INVITE01", expiry)));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getCode()).isEqualTo("INVITE01");
        assertThat(response.getCodeExpiresAt()).isEqualTo(expiry);
        assertThat(response.getMembers()).hasSize(1);
        assertThat(response.getMembers().get(0).getNickname()).isEqualTo("방장");
        // GROMO-674: 미션 필드는 대표 챌린지(+duration 상세)에서 채워진다
        assertThat(response.getMissionCategory()).isEqualTo(MissionCategory.FOCUS);
        assertThat(response.getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(response.getDurationMinutes()).isEqualTo(60);
    }

    @Test
    @DisplayName("MEMBER 조회 → code=null, codeExpiresAt=null")
    void getGroupDetailMemberNoCode() {
        // given
        User member = userWithNickname(USER_ID, "멤버");
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(memberRole));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getCode()).isNull();
        assertThat(response.getCodeExpiresAt()).isNull();
        assertThat(response.isPrivate()).isFalse();
    }

    @Test
    @DisplayName("상세 TIME_WINDOW 대표 챌린지 → windowStart/windowEnd 는 KST 벽시계 \"HH:mm:ss\" 문자열")
    void getGroupDetailTimeWindowMission() {
        // given — 오버뷰(getGroupOverviewTimeWindowMission)와 같은 계약을 상세에도 잠근다
        //   (GROMO-1206, 두 응답이 같은 단일 출구 timeOfDayString 을 쓴다). 04:00Z = 13:00 KST,
        //   06:30Z = 15:30 KST.
        User member = userWithNickname(USER_ID, "멤버");
        Group group = Group.builder().id(GROUP_ID).name("그룹")
                .maxMembers(10).status(GroupStatus.WAITING).build();
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(memberRole));
        givenRepresentativeTimeWindowChallenge(group, MissionCategory.SCREEN_TIME,
                Instant.parse("2026-07-10T04:00:00Z"), Instant.parse("2026-07-10T06:30:00Z"));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then — Instant ISO 가 아니라 "HH:mm:ss" 다. ISO 로 새면 앱 timeStrToSeconds 가 조용히 NaN.
        assertThat(response.getMissionCategory()).isEqualTo(MissionCategory.SCREEN_TIME);
        assertThat(response.getMissionType()).isEqualTo(MissionType.TIME_WINDOW);
        assertThat(response.getWindowStart()).isEqualTo("13:00:00");
        assertThat(response.getWindowEnd()).isEqualTo("15:30:00");
        assertThat(response.getDurationMinutes()).isNull();
    }

    @Test
    @DisplayName("비공개 그룹 상세 → isPrivate=true")
    void getGroupDetailPrivateGroup() {
        // given
        User member = userWithNickname(USER_ID, "멤버");
        Group group = Group.builder().id(GROUP_ID).name("비밀방")
                .maxMembers(10).status(GroupStatus.WAITING).isPrivate(true).build();
        GroupMember memberRole = GroupMember.builder().user(member).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(member));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(member, group)).willReturn(Optional.of(memberRole));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(memberRole));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.isPrivate()).isTrue();
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getGroupDetailNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getGroupDetailGuestForbidden() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getGroupDetailGroupNotFound() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.getGroupDetail(GROUP_ID_99, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(GroupException.class);
    }

    // ── getAnnouncements (GROMO-287) ──────────────────────────────────────

    @Test
    @DisplayName("공지 목록 정상 조회 → 공지 수만큼 반환")
    void getAnnouncementsSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();
        GroupAnnouncement ann = GroupAnnouncement.builder()
                .id(ANNOUNCEMENT_ID).group(group).title("공지1").content("내용1")
                .createdAt(Instant.now()).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupAnnouncementRepository.findByGroupOrderByCreatedAtDesc(group)).willReturn(List.of(ann));

        // when
        List<GroupAnnouncementResponse> result = groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getTitle()).isEqualTo("공지1");
        assertThat(result.get(0).getContent()).isEqualTo("내용1");
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getAnnouncementsNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getAnnouncementsGuestForbidden() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getAnnouncementsGroupNotFound() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupAnnouncementService.getAnnouncements(GROUP_ID_99, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── getChallenges (GROMO-289) ─────────────────────────────────────────

    @Test
    @DisplayName("챌린지 목록 정상 조회 → 챌린지 수만큼 반환")
    void getChallengesSuccess() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();
        GroupChallenge challenge = GroupChallenge.builder()
                .id(CHALLENGE_ID).group(group).type(MissionType.DURATION)
                .category(MissionCategory.FOCUS).status(GroupChallengeStatus.ACTIVE)
                .createdAt(Instant.now()).build();

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));
        given(groupChallengeRepository.findByGroupAndDeletedAtIsNullOrderByCreatedAtDesc(group))
                .willReturn(List.of(challenge));
        // GROMO-674: durationMinutes 는 CTI 상세 배치 조회로 채워진다
        given(groupChallengeDurationRepository.findByChallengeIdIn(List.of(CHALLENGE_ID)))
                .willReturn(List.of(GroupChallengeDuration.builder()
                        .challengeId(CHALLENGE_ID).durationMinutes(60).build()));

        // when
        List<GroupChallengeResponse> result = groupChallengeService.getChallenges(GROUP_ID, USER_ID, null);

        // then
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getMissionType()).isEqualTo(MissionType.DURATION);
        assertThat(result.get(0).getDurationMinutes()).isEqualTo(60);
        assertThat(result.get(0).getStatus()).isEqualTo(GroupChallengeStatus.ACTIVE);
    }

    @Test
    @DisplayName("그룹 멤버 아님 → MEMBER_ONLY")
    void getChallengesNotMember() {
        // given
        User user = normalUser();
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void getChallengesGuestForbidden() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID, USER_ID, null))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void getChallengesGroupNotFound() {
        // given
        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupChallengeService.getChallenges(GROUP_ID_99, USER_ID, null))
                .isInstanceOf(GroupException.class);
    }

    // ── joinGroup ─────────────────────────────────────────────────────────

    private Group openGroup() {
        return Group.builder().id(GROUP_ID).name("스터디룸")
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    private Group passwordGroup() {
        return Group.builder().id(GROUP_ID).name("비밀방").password("hashed-pw")
                .maxMembers(10).status(GroupStatus.WAITING).build();
    }

    @Test
    @DisplayName("비밀번호 없는 그룹 정상 참가 → GroupMember 저장")
    void joinGroupSuccess() {
        // given
        User user = normalUser();
        Group group = openGroup();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        // then
        ArgumentCaptor<GroupMember> captor = ArgumentCaptor.forClass(GroupMember.class);
        verify(groupMemberRepository).save(captor.capture());
        assertThat(captor.getValue().getRole()).isEqualTo(GroupMemberRole.MEMBER);
    }

    @Test
    @DisplayName("joinGroup 은 유저를 공유 락으로 로드한다 — 계정 탈퇴 배타 락과 직렬화 (GROMO-801 codex 리뷰)")
    void joinGroupLoadsUserWithSharedLock() {
        // 락 없는 findById 로 로드하면 탈퇴(유저 행 배타 락)의 정리 스캔 이후·커밋 이전에 낀 가입이
        // 정리를 빠져나가 유령 멤버십으로 남는다. 공유 락 조회는 탈퇴하고만 직렬화되고, 탈퇴가 먼저
        // 커밋된 유저는 is_deleted 필터로 기존 계약(NOT_FOUND)대로 거절된다.
        User user = normalUser();
        Group group = openGroup();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        verify(userRepository).findActiveByIdForShare(USER_ID);
        verify(userRepository, never()).findById(USER_ID);
    }

    @Test
    @DisplayName("비밀번호 그룹 올바른 비밀번호로 참가 성공")
    void joinGroupSuccessWithPassword() {
        // given
        User user = normalUser();
        Group group = passwordGroup();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        given(passwordEncoder.matches("1234", "hashed-pw")).willReturn(true);

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest("1234"));

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
    }

    @Test
    @DisplayName("게스트 참가 → GUEST_FORBIDDEN")
    void joinGroupGuestForbidden() {
        // given
        User guest = User.builder().isGuest(true).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(guest));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → GroupException NOT_FOUND")
    void joinGroupNotFound() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID_99, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("이미 참여 중인 그룹 → ALREADY_MEMBER")
    void joinGroupAlreadyMember() {
        // given
        User user = normalUser();
        Group group = openGroup();
        GroupMember existing = GroupMember.builder().user(user).group(group).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(existing));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("자진 탈퇴자 재가입 → 기존 행 되살리기(rejoin), 신규 저장 없음 (A-0)")
    void joinGroupResurrectsLeftMember() {
        // given: 과거 자진 탈퇴(LEFT)한 이탈 행이 존재
        User user = normalUser();
        Group group = openGroup();
        GroupMember left = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build();
        left.leave();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findAnyByUserAndGroup(user, group)).willReturn(Optional.of(left));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        // then: 기존 행이 활성으로 복원되고, 신규 insert 는 없다(유니크 제약 회피)
        assertThat(left.isLeft()).isFalse();
        assertThat(left.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("강퇴된 유저 재가입 → KICKED_CANNOT_REJOIN, 저장 없음 (A-0)")
    void joinGroupRejectsKickedMember() {
        // given: 과거 강퇴(KICKED)된 이탈 행이 존재
        User user = normalUser();
        Group group = openGroup();
        GroupMember kicked = GroupMember.builder()
                .user(user).group(group).role(GroupMemberRole.MEMBER).build();
        kicked.kick();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findAnyByUserAndGroup(user, group)).willReturn(Optional.of(kicked));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.KICKED_CANNOT_REJOIN);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("정원 초과 → ROOM_FULL")
    void joinGroupRoomFull() {
        // given
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("꽉찬방")
                .maxMembers(2).status(GroupStatus.WAITING).build();
        // 정원 판정이 user.isDeleted 를 읽으므로(GROMO-1220) 활성(비탈퇴) 유저를 채워 둔다.
        List<GroupMember> members = List.of(
                GroupMember.builder().user(User.builder().build()).build(),
                GroupMember.builder().user(User.builder().build()).build()
        );

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(members);

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("탈퇴자 유령 멤버십은 정원을 차지하지 않는다 — 유령 1 + 활성 1, max 2 → 가입 허용 (GROMO-1220)")
    void joinGroupReclaimsWithdrawnGhostSeat() {
        // #497 이전 탈퇴자는 is_left=false 로 남아 findByGroup 에 그대로 잡힌다 — 정원 판정이
        // 탈퇴 여부를 안 보면 유령이 한 자리를 영구히 차지해 산 사람이 못 들어온다(자리 회수는 의도된 효과).
        User user = normalUser();
        Group group = Group.builder().id(GROUP_ID).name("한자리남은방")
                .maxMembers(2).status(GroupStatus.WAITING).build();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(
                GroupMember.builder().user(User.builder().build()).build(),   // 활성
                GroupMember.builder().user(withdrawnUser()).build()));        // 유령(탈퇴)

        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        verify(groupMemberRepository).save(any(GroupMember.class));
    }

    @Test
    @DisplayName("비밀번호 불일치 → WRONG_PASSWORD")
    void joinGroupWrongPassword() {
        // given
        User user = normalUser();
        Group group = passwordGroup();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        given(passwordEncoder.matches(any(), anyString())).willReturn(false);

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("존재하지 않는 userId → UserException")
    void joinGroupUserNotFound() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(UserException.class);
    }

    // ── 멀티 그룹 상한 (MAX_JOINED_GROUPS = 10) ─────────────────────────────

    @Test
    @DisplayName("소속 9개에서 참가 → 10번째까지는 허용(경계)")
    void joinGroupAllowedAtNinthGroup() {
        // given: 이미 9개 소속 → 이번 참가로 10개
        User user = normalUser();
        Group group = openGroup();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.countByUser(user)).willReturn(9L);
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
    }

    @Test
    @DisplayName("소속 10개에서 참가 → GROUP_LIMIT_EXCEEDED(409)")
    void joinGroupRejectedAtLimit() {
        // given: 상한(10) 도달
        User user = normalUser();
        Group group = openGroup();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.countByUser(user)).willReturn(10L);

        // when & then: 앱이 code 문자열로 분기하므로 에러 코드까지 고정한다
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        verify(groupMemberRepository, never()).save(any());
    }

    @Test
    @DisplayName("이미 멤버인 그룹은 상한과 무관하게 ALREADY_MEMBER 로 끝난다")
    void joinGroupAlreadyMemberTakesPrecedenceOverLimit() {
        // given: 10개 소속이면서 그중 한 곳에 다시 참가 시도 — 소속 수가 늘지 않으므로 상한 사유가 아니다
        User user = normalUser();
        Group group = openGroup();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group))
                .willReturn(Optional.of(GroupMember.builder().user(user).group(group).build()));

        // when & then
        assertThatThrownBy(() -> groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest()))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.ALREADY_MEMBER);
    }

    @Test
    @DisplayName("소속 10개에서 그룹 생성 → GROUP_LIMIT_EXCEEDED (생성도 곧 가입이므로 같은 상한)")
    void createGroupRejectedAtLimit() {
        // given
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupMemberRepository.countByUser(user)).willReturn(10L);

        // when & then
        assertThatThrownBy(() -> groupService.createGroup(USER_ID, durationRequest(null, 5, 30)))
                .isInstanceOf(GroupException.class)
                .extracting("errorCode")
                .isEqualTo(GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        verify(groupRepository, never()).save(any(Group.class));
    }

    // ── joinGroup 초대 어트리뷰션 (초대 링크) ────────────────────────────────

    private static final UUID INVITER_ID = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final String SLUG = "ab23cd45";

    /** 참여가 성공 경로를 타도록 공통 스텁을 깐다. */
    private User givenJoinableGroup(Group group) {
        User user = normalUser();
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(groupRepository.findById(group.getId())).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of());
        return user;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> capturedActivityPayload() {
        ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
        verify(userActivityEventLogger).log(eq(UserActivityEvent.GROUP_JOINED), captor.capture());
        return captor.getValue();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> capturedGa4Params() {
        ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
        verify(ga4MeasurementClient).sendAppEvent(anyString(), eq("group_joined"), captor.capture());
        return captor.getValue();
    }

    @Test
    @DisplayName("유효한 slug 로 참여 → Track2·GA4 양쪽에 어트리뷰션이 기록된다")
    void joinGroupRecordsInviteAttribution() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);
        given(groupInviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, GROUP_ID, INVITER_ID)));

        // when
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("deferred_invite").inviteSlug(SLUG).appInstanceId("inst-1").build());

        // then: 참여 자체는 성공
        verify(groupMemberRepository).save(any(GroupMember.class));

        // Track2 — invite_slug/inviter_id 기록
        assertThat(capturedActivityPayload())
                .containsEntry("group_id", GROUP_ID.toString())
                .containsEntry("join_method", "deferred_invite")
                .containsEntry("invite_slug", SLUG)
                .containsEntry("inviter_id", INVITER_ID.toString());

        // GA4 — 키 이름은 slug(스펙 §4-3), inviter_present true
        assertThat(capturedGa4Params())
                .containsEntry("group_id", GROUP_ID.toString())
                .containsEntry("join_method", "deferred_invite")
                .containsEntry("slug", SLUG)
                .containsEntry("inviter_present", true);
    }

    @Test
    @DisplayName("slug 가 다른 그룹의 링크면 slug 만 버리고 참여는 성공한다 (?g= 변조 흡수)")
    void joinGroupDropsSlugWhenGroupMismatches() {
        // given: 링크는 GROUP_ID_2 를 가리키는데 참여 대상은 GROUP_ID
        Group group = openGroup();
        givenJoinableGroup(group);
        given(groupInviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, GROUP_ID_2, INVITER_ID)));

        // when
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("invite").inviteSlug(SLUG).appInstanceId("inst-1").build());

        // then: 참여는 정상, 어트리뷰션만 탈락
        verify(groupMemberRepository).save(any(GroupMember.class));
        assertThat(capturedActivityPayload())
                .containsEntry("join_method", "invite")
                .doesNotContainKeys("invite_slug", "inviter_id");
        assertThat(capturedGa4Params())
                .containsEntry("inviter_present", false)
                .containsEntry("slug", null);
    }

    @Test
    @DisplayName("존재하지 않는 slug 도 참여를 막지 않는다")
    void joinGroupDropsUnknownSlug() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);
        given(groupInviteLinkRepository.findBySlug(SLUG)).willReturn(Optional.empty());

        // when
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("invite").inviteSlug(SLUG).appInstanceId("inst-1").build());

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
        assertThat(capturedActivityPayload()).doesNotContainKeys("invite_slug", "inviter_id");
    }

    @Test
    @DisplayName("slug 없는 구버전 요청은 그대로 동작하고 링크 조회도 하지 않는다 (하위호환)")
    void joinGroupWithoutSlugStaysBackwardCompatible() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);

        // when: 구버전 앱이 보내던 형태 그대로
        groupService.joinGroup(GROUP_ID, USER_ID, new JoinGroupRequest());

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
        verify(groupInviteLinkRepository, never()).findBySlug(anyString());
        // join_method 는 넣지 않는다 — "미전송"과 "search 로 들어옴"을 구분하기 위해
        assertThat(capturedActivityPayload())
                .containsEntry("group_id", GROUP_ID.toString())
                .doesNotContainKeys("join_method", "invite_slug", "inviter_id");
    }

    @Test
    @DisplayName("app_instance_id 가 없어도 참여는 성공한다 — 전송 스킵 판단은 GA4 클라이언트 몫")
    void joinGroupSucceedsWithoutAppInstanceId() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);
        given(groupInviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, GROUP_ID, INVITER_ID)));

        // when
        groupService.joinGroup(GROUP_ID, USER_ID, JoinGroupRequest.builder().joinMethod("invite").inviteSlug(SLUG).build());

        // then
        verify(groupMemberRepository).save(any(GroupMember.class));
        verify(ga4MeasurementClient).sendAppEvent(isNull(), eq("group_joined"), any());
    }

    @Test
    @DisplayName("링크 생성자가 자기 slug 로 재참여하면 셀프 초대 — 어트리뷰션을 버린다")
    void joinGroupDropsSelfInviteSlug() {
        // given: 링크의 초대자 == 참여자 (그룹을 나갔다가 자기 링크로 재참여하는 시나리오)
        Group group = openGroup();
        givenJoinableGroup(group);
        given(groupInviteLinkRepository.findBySlug(SLUG))
                .willReturn(Optional.of(new GroupInviteLink(SLUG, GROUP_ID, USER_ID)));

        // when
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("invite").inviteSlug(SLUG).appInstanceId("inst-1").build());

        // then: 참여는 정상, 어트리뷰션만 탈락 — InviteLinkClick.claim 의 셀프 초대 방지와 같은 규칙
        verify(groupMemberRepository).save(any(GroupMember.class));
        assertThat(capturedActivityPayload()).doesNotContainKeys("invite_slug", "inviter_id");
        assertThat(capturedGa4Params()).containsEntry("inviter_present", false);
    }

    @Test
    @DisplayName("계약 밖 join_method 는 unknown 으로 정규화된다 (퍼널 카디널리티 오염 방지)")
    void joinGroupNormalizesUnknownJoinMethod() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);

        // when: 계약(§4-2)에 없는 임의 문자열
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("totally-made-up").appInstanceId("inst-1").build());

        // then: 두 트랙 모두 unknown
        assertThat(capturedActivityPayload()).containsEntry("join_method", "unknown");
        assertThat(capturedGa4Params()).containsEntry("join_method", "unknown");
    }

    @Test
    @DisplayName("blank join_method 는 unknown 이 아니라 미전송으로 남는다")
    void joinGroupKeepsBlankJoinMethodAbsent() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);

        // when: "구버전 앱이라 안 보냄"과 "모르는 값을 보냄"을 뭉개면 안 된다
        groupService.joinGroup(GROUP_ID, USER_ID,
                JoinGroupRequest.builder().joinMethod("  ").appInstanceId("inst-1").build());

        // then
        assertThat(capturedActivityPayload()).doesNotContainKey("join_method");
        assertThat(capturedGa4Params()).containsEntry("join_method", null);
    }

    @Test
    @DisplayName("트랜잭션 동기화가 활성이면 두 트랙 발행을 커밋 이후로 미룬다 (롤백 시 유령 이벤트 방지)")
    void joinGroupDefersAttributionUntilAfterCommit() {
        // given
        Group group = openGroup();
        givenJoinableGroup(group);
        TransactionSynchronizationManager.initSynchronization();
        try {
            // when: 트랜잭션 안 — 아직 어느 트랙도 발행되면 안 된다
            groupService.joinGroup(GROUP_ID, USER_ID,
                    JoinGroupRequest.builder().joinMethod("search").appInstanceId("inst-1").build());
            verify(userActivityEventLogger, never()).log(eq(UserActivityEvent.GROUP_JOINED), any());
            verify(ga4MeasurementClient, never()).sendAppEvent(anyString(), anyString(), any());

            // when: 커밋 시점 — 등록된 동기화 콜백 트리거
            TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }

        // then: 커밋 이후 두 트랙이 함께 발행된다
        assertThat(capturedActivityPayload()).containsEntry("join_method", "search");
        assertThat(capturedGa4Params()).containsEntry("join_method", "search");
    }

    // ── transferOwner (GROMO-355) ─────────────────────────────────────────

    private static final UUID TARGET_USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    @DisplayName("OWNER가 MEMBER에게 위임 → 역할 교체(OWNER↔MEMBER)")
    void transferOwnerSuccess() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        User target = userWithNickname(TARGET_USER_ID, "멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
        GroupMember targetMember = GroupMember.builder().user(target).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findActiveByIdForShare(TARGET_USER_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.of(targetMember));

        // when
        groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID);

        // then: GROMO-676 — host_id 폐기, 방장 이양은 role 교체로만 검증
        assertThat(ownerMember.getRole()).isEqualTo(GroupMemberRole.MEMBER);
        assertThat(targetMember.getRole()).isEqualTo(GroupMemberRole.OWNER);
    }

    @Test
    @DisplayName("게스트 → GUEST_FORBIDDEN")
    void transferOwnerGuestForbidden() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(User.builder().isGuest(true).build()));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("MEMBER가 위임 시도 → NOT_OWNER")
    void transferOwnerNotOwner() {
        // given
        User user = userWithNickname(USER_ID, "일반멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember member = GroupMember.builder().user(user).group(group).role(GroupMemberRole.MEMBER).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(userRepository.findActiveByIdForShare(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.of(member));

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("그룹원 아닌 유저가 위임 시도 → NOT_OWNER")
    void transferOwnerCallerNotMember() {
        // given
        User user = userWithNickname(USER_ID, "비멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(user));
        given(userRepository.findActiveByIdForShare(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(user, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("존재하지 않는 그룹 → NOT_FOUND")
    void transferOwnerGroupNotFound() {
        // given
        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(normalUser()));
        given(userRepository.findActiveByIdForShare(TARGET_USER_ID)).willReturn(Optional.of(userWithNickname(TARGET_USER_ID, "대상")));
        given(groupRepository.findById(GROUP_ID_99)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID_99, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    @Test
    @DisplayName("대상 유저가 그룹원 아님 → NOT_FOUND")
    void transferOwnerTargetNotMember() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        User target = userWithNickname(TARGET_USER_ID, "비멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(userRepository.findActiveByIdForShare(TARGET_USER_ID)).willReturn(Optional.of(target));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByUserAndGroup(target, group)).willReturn(Optional.empty());

        // when & then
        assertThatThrownBy(() -> groupMemberService.transferOwner(GROUP_ID, TARGET_USER_ID, USER_ID))
                .isInstanceOf(GroupException.class);
    }

    // ── 공지 권한(announcement_permission) 재배선 (GROMO-676) ─────────────

    private GroupMember ownerMemberOf(User owner, Group group) {
        return GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build();
    }

    private GroupMember memberWithPermission(User user, Group group, GroupAnnouncementGrant permission) {
        return GroupMember.builder().user(user).group(group)
                .role(GroupMemberRole.MEMBER).announcementPermission(permission).build();
    }

    @Test
    @DisplayName("A-4 설정 조회 → announcementGrants 는 전 멤버(방장 포함) + granted(방장·ALLOW=true)")
    void getGroupSettingsReturnsAnnouncementGrants() {
        // given: 방장 + ALLOW 멤버 + DISALLOW(기본값) 멤버
        UUID plainId = UUID.fromString("00000000-0000-0000-0000-000000000003");
        User owner = userWithNickname(USER_ID, "방장");
        User granted = userWithNickname(TARGET_USER_ID, "허용멤버");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember grantedMember = memberWithPermission(granted, group, GroupAnnouncementGrant.ALLOW);
        GroupMember plainMember = memberWithPermission(
                userWithNickname(plainId, "일반멤버"), group, GroupAnnouncementGrant.DISALLOW);

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group))
                .willReturn(List.of(ownerMember, grantedMember, plainMember));

        // when
        GroupSettingsResponse response = groupService.getGroupSettings(GROUP_ID, USER_ID);

        // then: 전 멤버 포함, granted → 방장=true, ALLOW=true, DISALLOW=false + 닉네임 조인
        assertThat(response.getAnnouncementGrants())
                .extracting(GroupSettingsResponse.AnnouncementGrant::getUserId,
                        GroupSettingsResponse.AnnouncementGrant::getNickname,
                        GroupSettingsResponse.AnnouncementGrant::isGranted)
                .containsExactlyInAnyOrder(
                        tuple(USER_ID, "방장", true),
                        tuple(TARGET_USER_ID, "허용멤버", true),
                        tuple(plainId, "일반멤버", false));
    }

    @Test
    @DisplayName("설정 조회 announcementGrants 도 탈퇴자를 제외한다 — 빈 닉네임 행 방지 (GROMO-1220)")
    void getGroupSettingsExcludesWithdrawnMembers() {
        User owner = userWithNickname(USER_ID, "방장");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember ghost = memberWithPermission(withdrawnUser(), group, GroupAnnouncementGrant.DISALLOW);

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember, ghost));

        GroupSettingsResponse response = groupService.getGroupSettings(GROUP_ID, USER_ID);

        assertThat(response.getAnnouncementGrants())
                .extracting(GroupSettingsResponse.AnnouncementGrant::getUserId)
                .containsExactly(USER_ID);
    }

    @Test
    @DisplayName("A-4 설정 변경(announcementGrants) → 항목별 granted 반영, 미포함 멤버 불변, 방장 무시")
    void updateGroupSettingsAppliesAnnouncementGrants() {
        // given: 방장 + 부여 대상(DISALLOW→true) + 회수 대상(ALLOW→false) + 미포함 멤버(ALLOW 유지)
        UUID revokeeId = UUID.fromString("00000000-0000-0000-0000-000000000003");
        UUID untouchedId = UUID.fromString("00000000-0000-0000-0000-000000000004");
        User owner = userWithNickname(USER_ID, "방장");
        User grantee = userWithNickname(TARGET_USER_ID, "부여대상");
        User revokee = userWithNickname(revokeeId, "회수대상");
        User untouched = userWithNickname(untouchedId, "미포함");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember granteeMember = memberWithPermission(grantee, group, GroupAnnouncementGrant.DISALLOW);
        GroupMember revokeeMember = memberWithPermission(revokee, group, GroupAnnouncementGrant.ALLOW);
        GroupMember untouchedMember = memberWithPermission(untouched, group, GroupAnnouncementGrant.ALLOW);

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group))
                .willReturn(List.of(ownerMember, granteeMember, revokeeMember, untouchedMember));

        UpdateGroupSettingsRequest request = new UpdateGroupSettingsRequest(List.of(
                new UpdateGroupSettingsRequest.AnnouncementGrant(TARGET_USER_ID, true),
                new UpdateGroupSettingsRequest.AnnouncementGrant(revokeeId, false)));

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: 항목대로 반영, 미포함 멤버 불변, 방장은 role 로 항상 가능하므로 컬럼 무시
        assertThat(granteeMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.ALLOW);
        assertThat(revokeeMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
        assertThat(untouchedMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.ALLOW);
        assertThat(ownerMember.getAnnouncementPermission()).isEqualTo(GroupAnnouncementGrant.DISALLOW);
    }

    @Test
    @DisplayName("A-4 설정 변경(announcementGrants=빈 리스트) → 미변경(findByGroup 미호출)")
    void updateGroupSettingsEmptyGrantsNoChange() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));

        UpdateGroupSettingsRequest request = new UpdateGroupSettingsRequest(List.of());

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: 빈 리스트 = 미변경 → 멤버 일괄 조회 자체가 없다
        verify(groupMemberRepository, never()).findByGroup(group);
    }

    @Test
    @DisplayName("A-4 설정 변경(announcementGrants=null) → 미변경(findByGroup 미호출)")
    void updateGroupSettingsNullGrantsNoChange() {
        // given
        User owner = userWithNickname(USER_ID, "방장");
        Group group = groupWithCode(GROUP_ID, "CODE1234", Instant.now().plus(1, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);

        given(userRepository.findActiveByIdForShare(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));

        UpdateGroupSettingsRequest request = new UpdateGroupSettingsRequest(null);

        // when
        groupService.updateGroupSettings(GROUP_ID, USER_ID, request);

        // then: null = 미변경 → 멤버 일괄 조회 자체가 없다
        verify(groupMemberRepository, never()).findByGroup(group);
    }

    @Test
    @DisplayName("그룹 상세 → noticeGrantedUserIds 는 announcement_permission=ALLOW 멤버만 (방장 제외)")
    void getGroupDetailNoticeGrantedFromMembers() {
        // given: 방장 + ALLOW 멤버
        User owner = userWithNickname(USER_ID, "방장");
        User granted = userWithNickname(TARGET_USER_ID, "허용멤버");
        Group group = groupWithCode(GROUP_ID, "INVITE01", Instant.now().plus(3, ChronoUnit.HOURS));
        GroupMember ownerMember = ownerMemberOf(owner, group);
        GroupMember grantedMember = memberWithPermission(granted, group, GroupAnnouncementGrant.ALLOW);

        given(userRepository.findByIdAndIsDeletedFalse(USER_ID)).willReturn(Optional.of(owner));
        given(groupRepository.findById(GROUP_ID)).willReturn(Optional.of(group));
        given(groupMemberRepository.findByUserAndGroup(owner, group)).willReturn(Optional.of(ownerMember));
        given(groupMemberRepository.findByGroup(group)).willReturn(List.of(ownerMember, grantedMember));

        // when
        GroupDetailResponse response = groupService.getGroupDetail(GROUP_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // then
        assertThat(response.getNoticeGrantedUserIds()).containsExactly(TARGET_USER_ID);
    }
}
