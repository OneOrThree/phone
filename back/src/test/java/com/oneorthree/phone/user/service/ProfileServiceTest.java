package com.oneorthree.phone.user.service;

import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.SlotType;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * ProfileService 단위 테스트 (GROMO-520).
 */
@ExtendWith(MockitoExtension.class)
class ProfileServiceTest {

    @InjectMocks
    private ProfileService profileService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private CharacterEquipmentRepository characterEquipmentRepository;

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private LeagueArenaUserRepository leagueArenaUserRepository;

    @Mock
    private StatsService statsService;

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID ARENA_ID = UUID.fromString("00000000-0000-0000-0000-0000000000aa");

    private User activeUser(String nickname) {
        return User.builder().id(USER_ID).nickname(nickname).currentTier(2).build();
    }

    private LeagueArena activeArena() {
        return LeagueArena.builder()
                .id(ARENA_ID)
                .status(LeagueArenaStatus.ACTIVE)
                .weekStartAt(Instant.parse("2026-06-22T00:00:00Z"))
                .build();
    }

    private LeagueArenaUser membership(User user, LeagueArena arena, int tierLevel, int focusMinutes) {
        return LeagueArenaUser.builder()
                .id(UUID.randomUUID())
                .user(user)
                .leagueArena(arena)
                .tierLevel(tierLevel)
                .totalFocusMinutes(focusMinutes)
                .build();
    }

    // ── 정상 집계 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("정상 조회 → 닉네임·캐릭터·친구수·리그 티어·랭킹 집계")
    void getPublicProfile_success() {
        User user = activeUser("조재영");
        LeagueArena arena = activeArena();
        LeagueArenaUser me = membership(user, arena, 3, 200);
        User otherUser = User.builder().id(OTHER_ID).nickname("top").build();
        LeagueArenaUser top = membership(otherUser, arena, 3, 300);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(5L);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        // top=1, me=2
        given(leagueArenaUserRepository.findRankedByArena(arena)).willReturn(List.of(top, me));

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

        assertThat(response.userId()).isEqualTo(USER_ID);
        assertThat(response.nickname()).isEqualTo("조재영");
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

        assertThatThrownBy(() -> profileService.getPublicProfile(USER_ID))
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
                .deletedAt(Instant.now())
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(deleted));

        assertThatThrownBy(() -> profileService.getPublicProfile(USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }

    // ── 리그 미소속 → User.currentTier fallback, rank null ───────────────

    @Test
    @DisplayName("리그 미소속 → User.currentTier fallback, rank=null")
    void getPublicProfile_noLeagueMembership_withCurrentTier() {
        User user = activeUser("조재영");  // currentTier=2

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

        assertThat(response.currentTier()).isEqualTo(2);
        assertThat(response.rank()).isNull();
    }

    @Test
    @DisplayName("리그 미소속 + User.currentTier 미설정 → tier=null, rank=null")
    void getPublicProfile_noLeagueMembership_noCurrentTier() {
        User user = User.builder().id(USER_ID).nickname("새유저").build();  // currentTier=null

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

        assertThat(response.currentTier()).isNull();
        assertThat(response.rank()).isNull();
    }

    // ── 친구수 0 ─────────────────────────────────────────────────────────

    @Test
    @DisplayName("친구 없음 → friendCount=0")
    void getPublicProfile_friendCountZero() {
        User user = activeUser("조재영");

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(0L);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

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
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

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
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

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
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.empty());

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

        assertThat(response.equipments()).hasSize(1);
        assertThat(response.equipments().get(0).getSlotType()).isEqualTo("HAIR");
    }

    // ── 리그 1등 → rank=1 ────────────────────────────────────────────────

    @Test
    @DisplayName("리그 1위 → rank=1")
    void getPublicProfile_rankFirst() {
        User user = activeUser("조재영");
        LeagueArena arena = activeArena();
        LeagueArenaUser me = membership(user, arena, 5, 500);

        given(userRepository.findById(USER_ID)).willReturn(Optional.of(user));
        given(characterEquipmentRepository.findByUser(user)).willReturn(List.of());
        given(friendshipRepository.countAcceptedByUser(user)).willReturn(3L);
        given(leagueArenaUserRepository.findByUserAndArenaStatus(USER_ID, LeagueArenaStatus.ACTIVE))
                .willReturn(Optional.of(me));
        given(leagueArenaUserRepository.findRankedByArena(arena)).willReturn(List.of(me));

        PublicProfileResponse response = profileService.getPublicProfile(USER_ID);

        assertThat(response.rank()).isEqualTo(1);
        assertThat(response.currentTier()).isEqualTo(5);
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
        given(statsService.getStreak(USER_ID)).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID)).willReturn(sampleToday());
        given(statsService.getHeatmap(any(), any(), any())).willReturn(List.of());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID);

        assertThat(response.isFriend()).isTrue();
        assertThat(response.streak()).isNotNull();
        assertThat(response.today()).isNotNull();
        assertThat(response.heatmap()).isNotNull();
        verify(statsService).getTodayStats(USER_ID);
        verify(statsService).getHeatmap(any(UUID.class), any(LocalDate.class), any(LocalDate.class));
    }

    @Test
    @DisplayName("친구X → streak 만 반환, isFriend=false, today/heatmap null")
    void getUserStats_notFriend_returnsStreakOnly() {
        User target = activeUser("대상유저");
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.empty());
        given(statsService.getStreak(USER_ID)).willReturn(sampleStreak());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID);

        assertThat(response.isFriend()).isFalse();
        assertThat(response.streak()).isNotNull();
        assertThat(response.today()).isNull();
        assertThat(response.heatmap()).isNull();
        // 친구X 일 때 세부 통계 메서드는 호출되지 않아야 한다
        verify(statsService, never()).getTodayStats(any());
        verify(statsService, never()).getHeatmap(any(), any(), any());
    }

    @Test
    @DisplayName("PENDING 관계 → 친구X 취급, streak 만 반환")
    void getUserStats_pendingRelation_treatedAsNotFriend() {
        // findAcceptedBetween 은 ACCEPTED 조건이므로 PENDING 관계는 Optional.empty() 반환
        User target = activeUser("대상유저");
        User caller = User.builder().id(OTHER_ID).nickname("호출자").build();

        givenBothUsers(target, caller);
        given(friendshipRepository.findAcceptedBetween(caller, target)).willReturn(Optional.empty());
        given(statsService.getStreak(USER_ID)).willReturn(sampleStreak());

        UserStatsResponse response = profileService.getUserStats(OTHER_ID, USER_ID);

        assertThat(response.isFriend()).isFalse();
        assertThat(response.today()).isNull();
        assertThat(response.heatmap()).isNull();
    }

    @Test
    @DisplayName("본인 조회(caller==target) → 세부 통계 반환, 친구 판정 없이 처리")
    void getUserStats_self_returnsDetailedStats() {
        User self = activeUser("본인");

        // 본인 조회이므로 target 만 조회 (caller 조회 불필요)
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(self));
        given(statsService.getStreak(USER_ID)).willReturn(sampleStreak());
        given(statsService.getTodayStats(USER_ID)).willReturn(sampleToday());
        given(statsService.getHeatmap(any(), any(), any())).willReturn(List.of());

        UserStatsResponse response = profileService.getUserStats(USER_ID, USER_ID);

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

        assertThatThrownBy(() -> profileService.getUserStats(OTHER_ID, USER_ID))
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
                .deletedAt(Instant.now())
                .build();
        given(userRepository.findById(USER_ID)).willReturn(Optional.of(deleted));

        assertThatThrownBy(() -> profileService.getUserStats(OTHER_ID, USER_ID))
                .isInstanceOf(UserException.class)
                .extracting("errorCode")
                .isEqualTo(UserErrorCode.NOT_FOUND);
    }
}
