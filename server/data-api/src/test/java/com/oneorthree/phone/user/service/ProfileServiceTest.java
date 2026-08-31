package com.oneorthree.phone.user.service;

import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.friend.service.FriendRelationLookup;
import com.oneorthree.phone.item.repository.domain.CharacterEquipment;
import com.oneorthree.phone.item.repository.domain.SlotType;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.league.repository.domain.LeagueRankingPosition;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;

/**
 * ProfileService 단위 테스트 (GROMO-520).
 */
@ExtendWith(MockitoExtension.class)
class ProfileServiceTest {

    private ProfileService profileService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private CharacterEquipmentRepository characterEquipmentRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private PinnedUserRepository pinnedUserRepository;

    @Mock
    private LeagueRankingQueryRepository leagueRankingQueryRepository;

    @Spy
    private LeagueWeek leagueWeek = new LeagueWeek();

    @Mock
    private StatsService statsService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final Instant NOW = Instant.parse("2026-06-24T03:00:00Z");

    @BeforeEach
    void setUpRankingDefault() {
        // FriendRelationLookup 은 목이 아니라 실제 인스턴스 — relation 판정이 스텁이 아닌
        // 실제 로직(리포지토리 스텁 기반)을 통과하도록 한다 (GROMO-1631).
        profileService = new ProfileService(userRepository, characterEquipmentRepository,
                friendshipRepository, pinnedUserRepository, new FriendRelationLookup(friendshipRepository),
                leagueRankingQueryRepository, leagueWeek, statsService);
        lenient().when(leagueRankingQueryRepository.findRankOf(any(), any(), any(), any()))
                .thenReturn(Optional.empty());
    }

    private User activeUser(String nickname) {
        return User.builder().id(USER_ID).nickname(nickname).build();
    }

    // ── 정상 집계 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 조회 → 닉네임·캐릭터·친구수·리그 티어·랭킹 집계")
    void getPublicProfile_success() {
        User user = User.builder().id(USER_ID).nickname("조재영")
                .occupation(Occupation.CSAT)
                .tierLevel(3)
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(5L);
        given(leagueRankingQueryRepository.findRankOf(
                eq(USER_ID), eq(LocalDate.of(2026, 6, 22)), eq(LocalDate.of(2026, 6, 24)), eq(NOW)))
                .willReturn(Optional.of(new LeagueRankingPosition(2, 3, 200)));

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID, NOW);

        assertThat(response.userId()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
        // 준비 시험 코드(enum name) 노출 — 미설정이면 null (GROMO-747)
        assertThat(response.occupation()).isEqualTo("CSAT");
        assertThat(response.equipments()).isEmpty();
        assertThat(response.friendCount()).isEqualTo(5L);
        assertThat(response.currentTier()).isEqualTo(3);
        assertThat(response.rank()).isEqualTo(2);
    }

    // ── 없는 userId → 404 ─────────────────────────────────────────────────

    @Test
    @DisplayName("존재하지 않는 유저 → UserException(NOT_FOUND)")
    void getPublicProfile_userNotFound() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> profileService.getPublicProfile(OTHER_ID, USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 소프트딜리트 유저 → 404 ───────────────────────────────────────────

    @Test
    @DisplayName("소프트딜리트(탈퇴) 유저 → UserException(NOT_FOUND)")
    void getPublicProfile_deletedUser() {
        User deleted = User.builder()
                .id(USER_ID)
                .nickname("탈퇴유저")
                .isDeleted(true)
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(deleted));

        assertThatThrownBy(() -> profileService.getPublicProfile(OTHER_ID, USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 전역 랭킹 결과 없음 → User 기본 tier=1, rank=null ──────────────

    @Test
    @DisplayName("전역 랭킹 결과 없는 신규 유저 → users.tier_level 기본값 T1, rank=null")
    void getPublicProfile_noLeagueMembership_hasDefaultTier() {
        User user = User.builder().id(USER_ID).nickname("새유저").build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);
        given(leagueRankingQueryRepository.findRankOf(any(), any(), any(), any()))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.currentTier()).isEqualTo(1);
        assertThat(response.rank()).isNull();
        // occupation 미설정 유저 → null (GROMO-747)
        assertThat(response.occupation()).isNull();
    }

    // ── 친구수 0 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("친구 없음 → friendCount=0")
    void getPublicProfile_friendCountZero() {
        User user = activeUser("조재영");

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.friendCount()).isZero();
    }

    // ── 친구수 양방향 — fromUser/toUser 집계 ─────────────────────────────

    @Test
    @DisplayName("본인이 fromUser인 ACCEPTED 친구 관계 → friendCount에 집계됨")
    void getPublicProfile_friendCount_asFromUser() {
        // 본인이 fromUser인 ACCEPTED, deletedAt=null 친구 관계를 가정:
        // countAcceptedByUser 가 fromUser 방향 관계를 포함해 2 반환
        User user = activeUser("조재영");

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(2L);

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.friendCount()).isEqualTo(2L);
    }

    @Test
    @DisplayName("본인이 toUser인 ACCEPTED 관계 → friendCount 집계; PENDING·소프트딜리트 관계는 제외")
    void getPublicProfile_friendCount_asToUser_pendingAndDeletedExcluded() {
        // 본인이 toUser인 ACCEPTED 1건 + PENDING 1건 + 소프트딜리트 1건이 있다고 가정.
        // countAcceptedByUser 는 ACCEPTED + deletedAt IS NULL 조건만 통과시키므로 1 반환.
        User user = activeUser("조재영");

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(1L);

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.friendCount()).isEqualTo(1L);
    }

    // ── 캐릭터 장착 목록 매핑 ────────────────────────────────────────────

    @Test
    @DisplayName("캐릭터 장착 목록 → CharacterEquipmentResponse 리스트 매핑")
    void getPublicProfile_withEquipments() {
        User user = activeUser("조재영");
        CharacterEquipment equip = CharacterEquipment.builder()
                .id(UUID.randomUUID())
                .user(user)
                .slotType(SlotType.HAIR)
                .build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of(equip));
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.equipments()).hasSize(1);
        assertThat(response.equipments().get(0).getSlotType()).isEqualTo("HAIR");
    }

    // ── 리그 1등 → rank=1 ────────────────────────────────────────────────

    @Test
    @DisplayName("리그 1위 → rank=1")
    void getPublicProfile_rankFirst() {
        User user = User.builder().id(USER_ID).nickname("조재영").tierLevel(5).build();

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(3L);
        given(leagueRankingQueryRepository.findRankOf(any(), any(), any(), any()))
                .willReturn(Optional.of(new LeagueRankingPosition(1, 5, 500)));

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.rank()).isEqualTo(1);
        assertThat(response.currentTier()).isEqualTo(5);
    }

    // ── relation · isPinned (GROMO-1631) ─────────────────────────────────
    // relation 판정은 실제 FriendRelationLookup 로직을 통과한다 — 리포지토리만 스텁.

    /** 공통 스텁: 타인 조회(OTHER_ID → USER_ID) 기본 집계 + 호출자 조회. */
    private User givenOtherViewsTarget(User target) {
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(target));
        given(userRepository.findById(OTHER_ID)).willReturn(Optional.of(caller));
        given(characterEquipmentRepository.findByUser(target)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(target)).willReturn(0L);
        return caller;
    }

    @Test
    @DisplayName("타인 조회 - ACCEPTED 친구 + 핀 → relation=FRIEND, isPinned=true")
    void getPublicProfile_friendAndPinned() {
        User target = activeUser("대상유저");
        User caller = givenOtherViewsTarget(target);
        given(friendshipRepository.findAcceptedByUser(caller))
                .willReturn(List.of(acceptedFriendship(caller, target)));
        given(pinnedUserRepository.findPinnedUserIdsByUserId(OTHER_ID)).willReturn(Set.of(USER_ID));

        PublicProfileResponse response = profileService.getPublicProfile(OTHER_ID, USER_ID);

        assertThat(response.relation()).isEqualTo(FriendRelation.FRIEND);
        assertThat(response.isPinned()).isTrue();
    }

    @Test
    @DisplayName("타인 조회 - 받은 PENDING 요청 → relation=PENDING (방향 무구분, N02)")
    void getPublicProfile_pendingReceived_relationPending() {
        User target = activeUser("대상유저");
        User caller = givenOtherViewsTarget(target);
        Friendship pending = Friendship.builder()
                .id(UUID.randomUUID())
                .fromUser(target)
                .toUser(caller)
                .status(FriendshipStatus.PENDING)
                .build();
        given(friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(caller, FriendshipStatus.PENDING))
                .willReturn(List.of(pending));

        PublicProfileResponse response = profileService.getPublicProfile(OTHER_ID, USER_ID);

        assertThat(response.relation()).isEqualTo(FriendRelation.PENDING);
        assertThat(response.isPinned()).isFalse();
    }

    @Test
    @DisplayName("타인 조회 - 아무 관계 없음 → relation=NONE, isPinned=false")
    void getPublicProfile_stranger_relationNone() {
        User target = activeUser("대상유저");
        givenOtherViewsTarget(target);
        // 관계·핀 리포지토리 스텁 없음 — 목 기본값(빈 컬렉션) = 관계 없음

        PublicProfileResponse response = profileService.getPublicProfile(OTHER_ID, USER_ID);

        assertThat(response.relation()).isEqualTo(FriendRelation.NONE);
        assertThat(response.isPinned()).isFalse();
    }

    @Test
    @DisplayName("본인 조회(caller==target) → 판정 쿼리 스킵, relation=NONE·isPinned=false (getUserStats 선례)")
    void getPublicProfile_self_skipsRelationQueries() {
        User self = activeUser("본인");
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(self));
        given(characterEquipmentRepository.findByUser(self)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(self)).willReturn(3L);

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID, USER_ID);

        assertThat(response.relation()).isEqualTo(FriendRelation.NONE);
        assertThat(response.isPinned()).isFalse();
        // 판정 쿼리 미호출 확인 — 본인 분기가 관계·핀 조회를 스킵한다
        verify(friendshipRepository, never()).findAcceptedByUser(any());
        verify(friendshipRepository, never())
                .findByFromUserAndStatusAndDeletedAtIsNull(any(), any());
        verify(friendshipRepository, never())
                .findByToUserAndStatusAndDeletedAtIsNull(any(), any());
        verify(pinnedUserRepository, never()).findPinnedUserIdsByUserId(any());
    }

    // ──────────────────────────────────────────────────────────────────────
    // getUserStats 테스트 (GROMO-521)
    // ──────────────────────────────────────────────────────────────────────

    /** 공통 스텁: OTHER_ID(호출자) → target(USER_ID) 순서로 findById 스텁을 등록한다. */
    private void givenBothUsers(User target, User caller) {
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(target));
        given(userRepository.findById(OTHER_ID)).willReturn(Optional.of(caller));
    }

    private StreakResponse sampleStreak() {
        return new StreakResponse(5, 10, LocalDate.of(2026, 7, 1));
    }

    private TodayStatsResponse sampleToday() {
        return new TodayStatsResponse(
                new TodayStatsResponse.FocusStat(60, 90, false, 67),
                new TodayStatsResponse.ScreenTimeStat(30, 120, true, 25));
    }

    private Friendship acceptedFriendship(User from, User to) {
        return Friendship.builder()
                .id(UUID.randomUUID())
                .fromUser(from)
                .toUser(to)
                .status(FriendshipStatus.ACCEPTED)
                .build();
    }

    @Test
    @DisplayName("친구O → 세부 통계(today+streak+heatmap) 반환, isFriend=true")
    void getUserStats_friend_returnsDetailedStats() {
        User target = activeUser("대상유저");
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();
        Friendship friendship = acceptedFriendship(caller, target);

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.of(friendship));
        given(statsService.getStreak(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleToday());
        given(statsService.getHeatmap(any(), any(), any())).willReturn(List.of());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.isFriend()).isTrue();
        assertThat(response.streak()).isNotNull();
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNotNull();
        verify(statsService).getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));
        verify(statsService).getHeatmap(any(UUID.class), any(LocalDate.class), any(LocalDate.class));
    }

    @Test
    @DisplayName("친구X → 요약(streak·today)은 반환, heatmap 만 null (GROMO-746)")
    void getUserStats_notFriend_returnsSummaryWithoutHeatmap() {
        User target = activeUser("대상유저");
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.empty());
        given(statsService.getStreak(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleToday());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.isFriend()).isFalse();
        assertThat(response.streak()).isNotNull();
        // 프로필 요약은 공개설정과 무관하게 항상 채워진다 (GROMO-746)
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNull();
        // 친구X 일 때 세부 차트(heatmap)만 잠긴다
        verify(statsService).getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));
        verify(statsService, never()).getHeatmap(any(), any(), any());
    }

    @Test
    @DisplayName("친구X + 대상 statVisibility=PUBLIC → 세부 통계 반환, isFriend=false (GROMO-640)")
    void getUserStats_notFriendPublic_returnsDetailedStats() {
        User target = User.builder().id(USER_ID).nickname("대상유저").statVisibility(StatVisibility.PUBLIC).build();
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.empty());
        given(statsService.getStreak(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleToday());
        given(statsService.getHeatmap(any(), any(), any())).willReturn(List.of());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.isFriend()).isFalse();   // 친구 아님 — PUBLIC 이라 세부 열람
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNotNull();
        verify(statsService).getTodayStats(USER_ID, LocalDate.of(2026, 7, 3));
    }

    @Test
    @DisplayName("PENDING 관계 → 친구X 취급, 요약(today) 채움·heatmap null (GROMO-746)")
    void getUserStats_pendingRelation_treatedAsNotFriend() {
        // findAcceptedBetween 은 ACCEPTED 조건이므로 PENDING 관계는 Optional.empty() 반환
        User target = activeUser("대상유저");
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.empty());
        given(statsService.getStreak(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleToday());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        assertThat(response.isFriend()).isFalse();
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNull();
    }

    @Test
    @DisplayName("본인 조회(caller==target) → 세부 통계 반환, 친구 판정 없이 처리")
    void getUserStats_self_returnsDetailedStats() {
        User self = activeUser("본인");

        // 본인 조회이므로 target 만 조회 (caller 조회 불필요)
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(self));
        given(statsService.getStreak(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID, LocalDate.of(2026, 7, 3))).willReturn(sampleToday());
        given(statsService.getHeatmap(any(), any(), any())).willReturn(List.of());

        UserStatsResponse response = profileService.getUserStats(USER_ID, USER_ID, LocalDate.of(2026, 7, 3));

        // 본인은 isFriend=false 이지만 세부 통계를 받는다
        assertThat(response.isFriend()).isFalse();
        assertThat(response.streak()).isNotNull();
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNotNull();
        // 친구 판정 메서드 미호출 확인
        verify(friendshipRepository, never()).findAcceptedBetween(any(), any());
    }

    @Test
    @DisplayName("존재하지 않는 targetUserId → UserException(NOT_FOUND)")
    void getUserStats_targetNotFound_throws404() {
        given(userRepository.findById(USER_ID)).willReturn(Optional.empty());

        assertThatThrownBy(() -> profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    @Test
    @DisplayName("소프트딜리트(탈퇴) 대상 유저 → UserException(NOT_FOUND)")
    void getUserStats_deletedTarget_throws404() {
        User deleted = User.builder()
                .id(USER_ID)
                .nickname("탈퇴유저")
                .isDeleted(true)
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(deleted));

        assertThatThrownBy(() -> profileService.getUserStats(OTHER_ID, USER_ID, LocalDate.of(2026, 7, 3)))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }
}
