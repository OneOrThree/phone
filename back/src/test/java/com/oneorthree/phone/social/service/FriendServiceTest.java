package com.oneorthree.phone.social.service;

import com.oneorthree.phone.social.domain.Friendship;
import com.oneorthree.phone.social.domain.FriendshipStatus;
import com.oneorthree.phone.social.dto.FriendRelation;
import com.oneorthree.phone.social.dto.FriendRequestResponse;
import com.oneorthree.phone.social.dto.FriendResponse;
import com.oneorthree.phone.social.dto.FriendSearchResultResponse;
import com.oneorthree.phone.social.exception.FriendErrorCode;
import com.oneorthree.phone.social.exception.FriendException;
import com.oneorthree.phone.social.repository.FriendshipRepository;
import com.oneorthree.phone.social.search.FriendSearchResult;
import com.oneorthree.phone.social.search.FriendSearchStrategy;
import com.oneorthree.phone.social.search.SearchType;
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

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class FriendServiceTest {

    @Mock
    private FriendshipRepository friendshipRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private FriendSearchStrategy nicknameStrategy;

    private FriendService friendService;

    private UUID meId;
    private UUID targetId;
    private User me;
    private User target;

    @BeforeEach
    void setUp() {
        given(nicknameStrategy.type()).willReturn(SearchType.NICKNAME);
        friendService = new FriendService(friendshipRepository, userRepository, List.of(nicknameStrategy));

        meId = UUID.randomUUID();
        targetId = UUID.randomUUID();
        me = user(meId, "me", 3);
        target = user(targetId, "target", 2);
    }

    private User user(UUID id, String nickname, Integer tier) {
        return User.builder().id(id).nickname(nickname).currentTier(tier).build();
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
        User a = user(UUID.randomUUID(), "alice", 4);
        User b = user(UUID.randomUUID(), "bob", 1);
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

    // ── search ─────────────────────────────────────────────

    @Test
    @DisplayName("검색 — 자기자신 제외 + 기존 관계(relation) 표기")
    void search_excludesSelf_andTagsRelation() {
        UUID friendId = UUID.randomUUID();
        UUID pendingId = UUID.randomUUID();
        UUID strangerId = UUID.randomUUID();
        User friend = user(friendId, "friend", 5);
        User pending = user(pendingId, "pending", 1);

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
    }

    private FriendSearchResult result(UUID userId, String nickname) {
        return FriendSearchResult.builder().userId(userId).nickname(nickname).tierLevel(1).build();
    }
}
