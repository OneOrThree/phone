package com.oneorthree.phone.friend.service;

import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.friend.domain.PinnedUser;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.friend.search.FriendSearchResult;
import com.oneorthree.phone.friend.search.FriendSearchStrategy;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.league.service.LeagueTierLookup;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class FriendServiceTest {

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private PinnedUserRepository pinnedUserRepository;

    @Mock
    private DailyFocusStatRepository dailyFocusStatRepository;

    @Mock
    private FocusSessionRepository focusSessionRepository;

    @Mock
    private CharacterEquipmentRepository characterEquipmentRepository;

    @Mock
    private FriendSearchStrategy nicknameStrategy;

    @Mock
    private UserActivityEventLogger userActivityEventLogger;

    @Mock
    private LeagueTierLookup leagueTierLookup;

    private FriendService friendService;

    private UUID meId;
    private UUID targetId;
    private User me;
    private User target;

    @BeforeEach
    void setUp() {
        given(nicknameStrategy.type()).willReturn(SearchType.NICKNAME);
        friendService = new FriendService(friendshipRepository, userRepository, pinnedUserRepository,
                dailyFocusStatRepository, focusSessionRepository, characterEquipmentRepository,
                userActivityEventLogger, leagueTierLookup, List.of(nicknameStrategy));

        meId = UUID.randomUUID();
        targetId = UUID.randomUUID();
        me = user(meId, "me");
        target = user(targetId, "target");
    }

    private User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).build();
    }

    private Friendship friendship(User from, User to, FriendshipStatus status) {
        return Friendship.builder().fromUser(from).toUser(to).status(status).build();
    }

    // ── createRequest ──────────────────────────────────────

    @Test
    @DisplayName("친구 요청 생성 — 정상: (me→target) PENDING insert")
    void createRequest_success_insertsPending() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of());

        friendService.createRequest(meId, targetId);

        ArgumentCaptor<Friendship> captor = ArgumentCaptor.forClass(Friendship.class);
        verify(friendshipRepository).save(captor.capture());
        Friendship saved = captor.getValue();
        assertThat(saved.getFromUser()).isEqualTo(me);
        assertThat(saved.getToUser()).isEqualTo(target);
        assertThat(saved.getStatus()).isEqualTo(FriendshipStatus.PENDING);
    }

    @Test
    @DisplayName("친구 요청 생성 — 자기 자신이면 SELF_REQUEST, 저장 안 함")
    void createRequest_self_throws() {
        assertThatThrownBy(() -> friendService.createRequest(meId, meId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.SELF_REQUEST);
        verify(friendshipRepository, never()).save(any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 대상 유저 없으면 UserException")
    void createRequest_targetNotFound_throws() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(UserException.class);
    }

    @Test
    @DisplayName("친구 요청 생성 — 이미 PENDING 존재 시 REQUEST_ALREADY_EXISTS")
    void createRequest_pendingExists_throws() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.PENDING)));

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_ALREADY_EXISTS);
        verify(friendshipRepository, never()).save(any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 이미 ACCEPTED(친구)면 ALREADY_FRIEND")
    void createRequest_alreadyFriend_throws() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.ALREADY_FRIEND);
    }

    @Test
    @DisplayName("친구 요청 생성 — 내가 보냈던 REJECTED는 PENDING으로 재전환(insert 없음)")
    void createRequest_rejected_reopened() {
        Friendship rejected = friendship(me, target, FriendshipStatus.REJECTED);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(rejected));

        friendService.createRequest(meId, targetId);

        assertThat(rejected.getStatus()).isEqualTo(FriendshipStatus.PENDING);
        verify(friendshipRepository, never()).save(any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 신규 요청이면 FRIEND_REQUEST_SENT(reopened=false) 발행")
    void createRequest_new_emitsRequestSent() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of());

        friendService.createRequest(meId, targetId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetId.toString(), "reopened", false));
    }

    @Test
    @DisplayName("친구 요청 생성 — REJECTED 재전환이면 FRIEND_REQUEST_SENT(reopened=true) 발행")
    void createRequest_reopened_emitsRequestSentWithReopenedTrue() {
        Friendship rejected = friendship(me, target, FriendshipStatus.REJECTED);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(rejected));

        friendService.createRequest(meId, targetId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetId.toString(), "reopened", true));
    }

    @Test
    @DisplayName("친구 요청 생성 — 검증 실패(이미 PENDING)면 이벤트 미발행")
    void createRequest_pendingExists_doesNotEmit() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.PENDING)));

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(FriendException.class);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 양방향 중복: (target→me) PENDING 있으면 거부")
    void createRequest_reverseDirectionPending_throws() {
        Friendship reverse = friendship(target, me, FriendshipStatus.PENDING);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(reverse));

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_ALREADY_EXISTS);
    }

    // ── accept / reject ────────────────────────────────────

    @Test
    @DisplayName("요청 수락 — 수신자면 ACCEPTED로 전이")
    void acceptRequest_receiver_accepts() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findById(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.ACCEPTED);
    }

    @Test
    @DisplayName("요청 수락 — FRIEND_ADDED(request_id·from_user_id) 발행")
    void acceptRequest_emitsFriendAdded() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findById(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_ADDED,
                Map.of("request_id", requestId.toString(), "from_user_id", targetId.toString()));
    }

    @Test
    @DisplayName("요청 수락 — 발신자 시도(NOT_REQUEST_RECEIVER)면 FRIEND_ADDED 미발행")
    void acceptRequest_sender_doesNotEmit() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(me, target, FriendshipStatus.PENDING);
        given(friendshipRepository.findById(requestId)).willReturn(Optional.of(request));

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("요청 수락 — 발신자가 시도하면 NOT_REQUEST_RECEIVER")
    void acceptRequest_sender_throws() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(me, target, FriendshipStatus.PENDING);
        given(friendshipRepository.findById(requestId)).willReturn(Optional.of(request));

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.NOT_REQUEST_RECEIVER);
        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.PENDING);
    }

    @Test
    @DisplayName("요청 수락 — 없는 요청이면 REQUEST_NOT_FOUND")
    void acceptRequest_notFound_throws() {
        UUID requestId = UUID.randomUUID();
        given(friendshipRepository.findById(requestId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_NOT_FOUND);
    }

    @Test
    @DisplayName("요청 거절 — 수신자면 REJECTED로 전이")
    void rejectRequest_receiver_rejects() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findById(requestId)).willReturn(Optional.of(request));

        friendService.rejectRequest(meId, requestId);

        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.REJECTED);
    }

    // ── deleteFriend ───────────────────────────────────────

    @Test
    @DisplayName("친구 삭제 — ACCEPTED 관계면 soft delete(deletedAt 기록)")
    void deleteFriend_accepted_softDeletes() {
        Friendship f = friendship(me, target, FriendshipStatus.ACCEPTED);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findAcceptedBetween(me, target)).willReturn(Optional.of(f));

        friendService.deleteFriend(meId, targetId);

        assertThat(f.getDeletedAt()).isNotNull();
    }

    @Test
    @DisplayName("친구 삭제 — ACCEPTED 관계 없으면 NOT_FRIEND")
    void deleteFriend_notFriend_throws() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findAcceptedBetween(me, target)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.deleteFriend(meId, targetId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.NOT_FRIEND);
    }

    // ── getFriends ─────────────────────────────────────────

    @Test
    @DisplayName("친구 목록 — 양방향(from/to) 모두 상대 유저로 매핑, isPinned=false")
    void getFriends_mapsCounterpart_bothDirections() {
        User a = user(UUID.randomUUID(), "alice");
        User b = user(UUID.randomUUID(), "bob");
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me)).willReturn(List.of(
                friendship(me, a, FriendshipStatus.ACCEPTED),   // me가 from
                friendship(b, me, FriendshipStatus.ACCEPTED)    // me가 to
        ));

        List<FriendResponse> friends = friendService.getFriends(meId);

        assertThat(friends).extracting(FriendResponse::getUserId)
                .containsExactlyInAnyOrder(a.getId(), b.getId());
        assertThat(friends).extracting(FriendResponse::getNickname)
                .containsExactlyInAnyOrder("alice", "bob");
        assertThat(friends).allMatch(f -> !f.isPinned());
    }

    @Test
    @DisplayName("친구 목록 — 티어는 LeagueTierLookup 에서 도출: 멤버십 있으면 채우고 미소속은 null (GROMO-710)")
    void getFriends_restoresTierLevel_fromLeagueLookup() {
        User a = user(UUID.randomUUID(), "alice");   // ACTIVE 멤버십 있음
        User b = user(UUID.randomUUID(), "bob");     // 미소속
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me)).willReturn(List.of(
                friendship(me, a, FriendshipStatus.ACCEPTED),
                friendship(me, b, FriendshipStatus.ACCEPTED)
        ));
        // 상대 userId 들을 한 번에 모아 배치 조회 → alice=티어3, bob 미포함
        given(leagueTierLookup.tierLevelsByUserId(List.of(a.getId(), b.getId())))
                .willReturn(Map.of(a.getId(), 3));

        List<FriendResponse> friends = friendService.getFriends(meId);

        assertThat(friends).filteredOn(f -> f.getUserId().equals(a.getId()))
                .extracting(FriendResponse::getTierLevel).containsExactly(3);
        assertThat(friends).filteredOn(f -> f.getUserId().equals(b.getId()))
                .extracting(FriendResponse::getTierLevel).containsExactly((Integer) null);
    }

    // ── getRequests ────────────────────────────────────────

    @Test
    @DisplayName("받은 요청 목록(received) — fromUser를 상대로 매핑")
    void getRequests_received_mapsFromUser() {
        Friendship req = friendship(target, me, FriendshipStatus.PENDING);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByToUserAndStatus(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "received");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getUserId()).isEqualTo(targetId);
        assertThat(requests.get(0).getNickname()).isEqualTo("target");
    }

    @Test
    @DisplayName("보낸 요청 목록(sent) — toUser를 상대로 매핑")
    void getRequests_sent_mapsToUser() {
        Friendship req = friendship(me, target, FriendshipStatus.PENDING);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByFromUserAndStatus(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "sent");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getUserId()).isEqualTo(targetId);
    }

    @Test
    @DisplayName("요청 목록 — 티어는 LeagueTierLookup 에서 도출: 멤버십 있으면 채움 (GROMO-710)")
    void getRequests_restoresTierLevel_fromLeagueLookup() {
        Friendship req = friendship(target, me, FriendshipStatus.PENDING);
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByToUserAndStatus(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));
        given(leagueTierLookup.tierLevelsByUserId(List.of(targetId)))
                .willReturn(Map.of(targetId, 4));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "received");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getTierLevel()).isEqualTo(4);
    }

    // ── search ─────────────────────────────────────────────

    @Test
    @DisplayName("검색 — 자기자신 제외 + 기존 관계(relation) 표기")
    void search_excludesSelf_andTagsRelation() {
        UUID friendId = UUID.randomUUID();
        UUID pendingId = UUID.randomUUID();
        UUID strangerId = UUID.randomUUID();
        User friend = user(friendId, "friend");
        User pending = user(pendingId, "pending");

        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(nicknameStrategy.search(meId, "f")).willReturn(List.of(
                result(meId, "me"),
                result(friendId, "friend"),
                result(pendingId, "pending"),
                result(strangerId, "stranger")
        ));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, friend, FriendshipStatus.ACCEPTED)));
        given(friendshipRepository.findByFromUserAndStatus(me, FriendshipStatus.PENDING))
                .willReturn(List.of(friendship(me, pending, FriendshipStatus.PENDING)));
        given(friendshipRepository.findByToUserAndStatus(me, FriendshipStatus.PENDING))
                .willReturn(List.of());

        List<FriendSearchResultResponse> results = friendService.search(meId, SearchType.NICKNAME, "f");

        assertThat(results).extracting(FriendSearchResultResponse::getUserId)
                .containsExactlyInAnyOrder(friendId, pendingId, strangerId); // me 제외
        assertThat(results).filteredOn(r -> r.getUserId().equals(friendId))
                .extracting(FriendSearchResultResponse::getRelation)
                .containsExactly(FriendRelation.FRIEND);
        assertThat(results).filteredOn(r -> r.getUserId().equals(pendingId))
                .extracting(FriendSearchResultResponse::getRelation)
                .containsExactly(FriendRelation.PENDING);
        assertThat(results).filteredOn(r -> r.getUserId().equals(strangerId))
                .extracting(FriendSearchResultResponse::getRelation)
                .containsExactly(FriendRelation.NONE);
        // 전략이 채운 티어가 응답까지 흐른다 (GROMO-710) — 전략 자체의 티어 도출은 NicknameSearchStrategyTest 담당
        assertThat(results).extracting(FriendSearchResultResponse::getTierLevel)
                .containsOnly(1);
    }

    private FriendSearchResult result(UUID userId, String nickname) {
        return FriendSearchResult.builder().userId(userId).nickname(nickname).tierLevel(1).build();
    }

    // ── pin / unpin / getPinned ────────────────────────────

    @Test
    @DisplayName("핀 설정 — 대상이 존재하면 친구 아니어도 ON CONFLICT insert 호출(user 핀 통일)")
    void pinFriend_nonFriendTarget_inserts() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));

        friendService.pinFriend(meId, targetId);

        // 친구관계(findAcceptedBetween) 검증 없이 바로 insert — user 핀 통일
        verify(pinnedUserRepository).insertIgnoreConflict(any(), eq(meId), eq(targetId));
    }

    @Test
    @DisplayName("핀 설정 — 자기 자신은 FriendException(SELF_PIN), insert 미호출")
    void pinFriend_self_throws() {
        assertThatThrownBy(() -> friendService.pinFriend(meId, meId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode")
                .isEqualTo(FriendErrorCode.SELF_PIN);
        verify(pinnedUserRepository, never()).insertIgnoreConflict(any(), any(), any());
    }

    @Test
    @DisplayName("핀 설정 — 대상 유저 없으면 UserException, insert 미호출")
    void pinFriend_userNotFound_throws() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.pinFriend(meId, targetId))
                .isInstanceOf(UserException.class);
        verify(pinnedUserRepository, never()).insertIgnoreConflict(any(), any(), any());
    }

    @Test
    @DisplayName("핀 해제 — 핀 없으면 멱등(delete 미호출)")
    void unpinFriend_noPin_idempotent() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(pinnedUserRepository.findByUserAndPinnedUser(me, target)).willReturn(Optional.empty());

        friendService.unpinFriend(meId, targetId);

        verify(pinnedUserRepository, never()).delete(any());
    }

    @Test
    @DisplayName("친구 목록 — 핀한 친구는 isPinned=true 매핑")
    void getFriends_pinnedFriend_isPinnedTrue() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));
        given(pinnedUserRepository.findByUser(me))
                .willReturn(List.of(PinnedUser.builder().user(me).pinnedUser(target).build()));

        List<FriendResponse> friends = friendService.getFriends(meId);

        assertThat(friends).hasSize(1);
        assertThat(friends.get(0).getUserId()).isEqualTo(targetId);
        assertThat(friends.get(0).isPinned()).isTrue();
    }

    @Test
    @DisplayName("핀 해제 — 핀 있으면 delete")
    void unpinFriend_deletesWhenPresent() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        PinnedUser pin = PinnedUser.builder().user(me).pinnedUser(target).build();
        given(pinnedUserRepository.findByUserAndPinnedUser(me, target)).willReturn(Optional.of(pin));

        friendService.unpinFriend(meId, targetId);

        verify(pinnedUserRepository).delete(pin);
    }

    @Test
    @DisplayName("핀 친구 조회 — 오늘 집중분/진행중 매핑")
    void getPinnedFriends_mapsFocusInfo() {
        given(userRepository.findById(meId)).willReturn(Optional.of(me));
        given(pinnedUserRepository.findByUser(me))
                .willReturn(List.of(PinnedUser.builder().user(me).pinnedUser(target).build()));

        DailyFocusStat stat = mock(DailyFocusStat.class);
        given(stat.getUser()).willReturn(target);
        given(stat.getTotalFocusSeconds()).willReturn(42 * 60);
        given(dailyFocusStatRepository.findByUserInAndDate(any(), any())).willReturn(List.of(stat));

        FocusSession session = mock(FocusSession.class);
        given(session.getUser()).willReturn(target);
        given(focusSessionRepository.findByUserInAndEndedAtIsNull(any())).willReturn(List.of(session));

        given(characterEquipmentRepository.findByUserIn(any())).willReturn(List.of());

        List<PinnedUserResponse> result = friendService.getPinnedFriends(meId, LocalDate.of(2026, 7, 3));

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getUserId()).isEqualTo(targetId);
        assertThat(result.get(0).getFocusTimeMinutes()).isEqualTo(42);
        assertThat(result.get(0).isFocusing()).isTrue();
        assertThat(result.get(0).getCharacter()).isEmpty();
    }
}
