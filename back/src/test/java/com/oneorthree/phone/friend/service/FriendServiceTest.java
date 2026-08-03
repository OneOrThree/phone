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
import com.oneorthree.phone.focus.dto.FocusLiveInfo;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.friend.domain.PinnedUser;
import com.oneorthree.phone.friend.dto.PinnedUserResponse;
import com.oneorthree.phone.friend.event.FriendRequestAcceptedEvent;
import com.oneorthree.phone.friend.event.FriendRequestSentEvent;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.friend.search.FriendSearchResult;
import com.oneorthree.phone.friend.search.FriendSearchStrategy;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.league.service.LeagueTierLookup;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
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

    @Mock
    private FocusLiveInfoLookup focusLiveInfoLookup;

    @Mock
    private ApplicationEventPublisher eventPublisher;

    private FriendService friendService;

    private static final LocalDate DATE = LocalDate.of(2026, 7, 3);

    private UUID meId;
    private UUID targetId;
    private User me;
    private User target;

    @BeforeEach
    void setUp() {
        given(nicknameStrategy.type()).willReturn(SearchType.NICKNAME);
        friendService = new FriendService(friendshipRepository, userRepository, pinnedUserRepository,
                dailyFocusStatRepository, focusSessionRepository, characterEquipmentRepository,
                userActivityEventLogger, leagueTierLookup, focusLiveInfoLookup, eventPublisher,
                List.of(nicknameStrategy));

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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(UserException.class);
    }

    @Test
    @DisplayName("친구 요청 생성 — 탈퇴 유저 대상이면 없는 유저로 404, 저장 안 함 (GROMO-801)")
    void createRequest_withdrawnTarget_throws() {
        // 탈퇴자는 findByIdAndIsDeletedFalse 에서 빈 결과 → 존재 검증에서 걸린다.
        // findById 를 쓰던 시절엔 여기를 통과해, friendships 에 남아있던 (from,to) 유니크 제약과 충돌해 500 이 났다.
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(UserException.class)
                .extracting("errorCode").isEqualTo(UserErrorCode.NOT_FOUND);
        verify(friendshipRepository, never()).save(any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 호출자·대상 둘 다 공유 락으로 조회해 탈퇴와 직렬화한다 (GROMO-801)")
    void createRequest_locksBothParticipants() {
        // 한쪽만 잠그면 잠그지 않은 쪽이 탈퇴 중일 때 그 유저 소유의 유령 관계가 남는다.
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of());

        friendService.createRequest(meId, targetId);

        verify(userRepository).findActiveByIdForShare(meId);
        verify(userRepository).findActiveByIdForShare(targetId);
        verify(userRepository, never()).findByIdAndIsDeletedFalse(any());
    }

    @Test
    @DisplayName("핀 설정 — 탈퇴 유저는 핀할 수 없다 (GROMO-801)")
    void pinFriend_withdrawnTarget_throws() {
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.pinFriend(meId, targetId))
                .isInstanceOf(UserException.class)
                .extracting("errorCode").isEqualTo(UserErrorCode.NOT_FOUND);
        verify(pinnedUserRepository, never()).insertIgnoreConflict(any(), any(), any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 이미 PENDING 존재 시 REQUEST_ALREADY_EXISTS")
    void createRequest_pendingExists_throws() {
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(rejected));

        friendService.createRequest(meId, targetId);

        assertThat(rejected.getStatus()).isEqualTo(FriendshipStatus.PENDING);
        verify(friendshipRepository, never()).save(any());
    }

    @Test
    @DisplayName("친구 요청 생성 — 신규 요청이면 FRIEND_REQUEST_SENT(reopened=false) 발행")
    void createRequest_new_emitsRequestSent() {
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of());

        friendService.createRequest(meId, targetId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetId.toString(), "reopened", false));
    }

    @Test
    @DisplayName("친구 요청 생성 — REJECTED 재전환이면 FRIEND_REQUEST_SENT(reopened=true) 발행")
    void createRequest_reopened_emitsRequestSentWithReopenedTrue() {
        Friendship rejected = friendship(me, target, FriendshipStatus.REJECTED);
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(rejected));

        friendService.createRequest(meId, targetId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetId.toString(), "reopened", true));
    }

    @Test
    @DisplayName("친구 요청 생성 — 수신자에게 보낼 푸시 이벤트를 발행한다 (GROMO-1090)")
    void createRequest_new_publishesFriendRequestSentEvent() {
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of());

        friendService.createRequest(meId, targetId);

        // 수신자 = 요청을 받은 쪽(target), 문구에 쓸 상대 = 보낸 쪽(me). 뒤바뀌면 자기가 보낸 요청을
        // 자기가 받는 푸시가 나간다.
        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertThat(captor.getValue()).isInstanceOfSatisfying(FriendRequestSentEvent.class, event -> {
            assertThat(event.receiverUserId()).isEqualTo(targetId);
            assertThat(event.senderUserId()).isEqualTo(meId);
        });
    }

    @Test
    @DisplayName("친구 요청 생성 — REJECTED 재전환도 푸시 이벤트를 발행한다 (GROMO-1090)")
    void createRequest_reopened_publishesFriendRequestSentEvent() {
        // 재전환은 수신자 입장에선 새로 도착한 요청이다 — 알리지 않으면 상대는 재요청을 영영 모른다.
        Friendship rejected = friendship(me, target, FriendshipStatus.REJECTED);
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(rejected));

        friendService.createRequest(meId, targetId);

        ArgumentCaptor<Object> captor = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertThat(captor.getValue()).isInstanceOfSatisfying(FriendRequestSentEvent.class, event -> {
            // 재전환은 기존 행을 되살리므로 그 행의 id 가 실려야 한다 — 소비 측이 상태를 다시 본다.
            assertThat(event.requestId()).isEqualTo(rejected.getId());
            assertThat(event.receiverUserId()).isEqualTo(targetId);
        });
    }

    @Test
    @DisplayName("친구 요청 생성 — 검증 실패(이미 PENDING)면 푸시 이벤트도 미발행 (GROMO-1090)")
    void createRequest_pendingExists_doesNotPublishPushEvent() {
        Friendship pending = friendship(me, target, FriendshipStatus.PENDING);
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findPair(me, target)).willReturn(List.of(pending));

        assertThatThrownBy(() -> friendService.createRequest(meId, targetId))
                .isInstanceOf(FriendException.class);
        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    @Test
    @DisplayName("친구 요청 생성 — 검증 실패(이미 PENDING)면 이벤트 미발행")
    void createRequest_pendingExists_doesNotEmit() {
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));
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
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.ACCEPTED);
    }

    @Test
    @DisplayName("요청 수락 — FRIEND_ADDED(request_id·from_user_id) 발행")
    void acceptRequest_emitsFriendAdded() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        verify(userActivityEventLogger).log(UserActivityEvent.FRIEND_ADDED,
                Map.of("request_id", requestId.toString(), "from_user_id", targetId.toString()));
    }

    @Test
    @DisplayName("요청 수락 — 발신자 시도(NOT_REQUEST_RECEIVER)면 FRIEND_ADDED 미발행")
    void acceptRequest_sender_doesNotEmit() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(me, target, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class);
        verify(userActivityEventLogger, never()).log(any(UserActivityEvent.class), any());
    }

    @Test
    @DisplayName("요청 수락 — 발신자가 시도하면 NOT_REQUEST_RECEIVER")
    void acceptRequest_sender_throws() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(me, target, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.NOT_REQUEST_RECEIVER);
        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.PENDING);
    }

    @Test
    @DisplayName("요청 수락 — 없는 요청이면 REQUEST_NOT_FOUND")
    void acceptRequest_notFound_throws() {
        UUID requestId = UUID.randomUUID();
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_NOT_FOUND);
    }

    @Test
    @DisplayName("요청 수락 — 탈퇴 정리로 soft delete 된 요청은 REQUEST_NOT_FOUND (GROMO-801)")
    void acceptRequest_softDeleted_throws() {
        // 요청 화면을 열어둔 사이 발신자가 탈퇴하면 클라가 들고 있던 requestId 로 수락이 들어올 수 있다.
        // deletedAt 을 안 보면 200 + FRIEND_ADDED 가 나가고도 친구 목록엔 안 나타나 계약이 어긋난다.
        UUID requestId = UUID.randomUUID();
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.REQUEST_NOT_FOUND);
        verify(userActivityEventLogger, never()).log(eq(UserActivityEvent.FRIEND_ADDED), any());
    }

    @Test
    @DisplayName("요청 수락 — 요청을 보냈던 쪽에게 보낼 푸시 이벤트를 발행한다 (GROMO-1090)")
    void acceptRequest_publishesFriendRequestAcceptedEvent() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        // 수락 사실을 모르는 쪽은 보낸 쪽(target) 하나뿐이다. 수락한 나(me)에게 보내면 무의미하다.
        verify(eventPublisher).publishEvent(new FriendRequestAcceptedEvent(targetId, meId));
    }

    @Test
    @DisplayName("요청 수락 — 이미 수락된 요청이면 푸시 이벤트를 다시 내지 않는다 (GROMO-1090)")
    void acceptRequest_alreadyAccepted_doesNotPublishPushEvent() {
        // 이 API 는 상태를 검사하지 않고 ACCEPTED 를 덮어쓴다. 발행을 실제 상태 전이로 묶지 않으면
        // 뒤늦게 도착한 재시도가 그대로 두 번째 푸시가 된다(발송 측 dedup 창은 짧다).
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.ACCEPTED);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    @Test
    @DisplayName("요청 수락 — 거절했던 요청을 뒤늦게 수락하면 알린다 (실제 상태 전이)")
    void acceptRequest_previouslyRejected_publishesPushEvent() {
        // ACCEPTED 가 아니었다면 전이가 맞다 — REJECTED → ACCEPTED 도 보낸 쪽은 모르는 사실이다.
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.REJECTED);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.acceptRequest(meId, requestId);

        verify(eventPublisher).publishEvent(new FriendRequestAcceptedEvent(targetId, meId));
    }

    @Test
    @DisplayName("요청 수락 — 수신자가 아니면 푸시 이벤트도 미발행 (GROMO-1090)")
    void acceptRequest_sender_doesNotPublishPushEvent() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(me, target, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        assertThatThrownBy(() -> friendService.acceptRequest(meId, requestId))
                .isInstanceOf(FriendException.class);
        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    @Test
    @DisplayName("요청 거절 — 수신자면 REJECTED로 전이")
    void rejectRequest_receiver_rejects() {
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.rejectRequest(meId, requestId);

        assertThat(request.getStatus()).isEqualTo(FriendshipStatus.REJECTED);
    }

    @Test
    @DisplayName("요청 거절 — 거절은 상대에게 알리지 않는다 (GROMO-1090)")
    void rejectRequest_doesNotPublishAnyEvent() {
        // 거절 통보는 관계상 부담이라 스코프 밖이다. 여기서 이벤트가 새면 곧바로 푸시로 나간다.
        UUID requestId = UUID.randomUUID();
        Friendship request = friendship(target, me, FriendshipStatus.PENDING);
        given(friendshipRepository.findByIdAndDeletedAtIsNull(requestId)).willReturn(Optional.of(request));

        friendService.rejectRequest(meId, requestId);

        verify(eventPublisher, never()).publishEvent(any(Object.class));
    }

    // ── deleteFriend ───────────────────────────────────────

    @Test
    @DisplayName("친구 삭제 — ACCEPTED 관계면 soft delete(deletedAt 기록)")
    void deleteFriend_accepted_softDeletes() {
        Friendship f = friendship(me, target, FriendshipStatus.ACCEPTED);
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findAcceptedBetween(me, target)).willReturn(Optional.of(f));

        friendService.deleteFriend(meId, targetId);

        assertThat(f.getDeletedAt()).isNotNull();
    }

    @Test
    @DisplayName("친구 삭제 — ACCEPTED 관계 없으면 NOT_FRIEND")
    void deleteFriend_notFriend_throws() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(friendshipRepository.findAcceptedBetween(me, target)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.deleteFriend(meId, targetId))
                .isInstanceOf(FriendException.class)
                .extracting("errorCode").isEqualTo(FriendErrorCode.NOT_FRIEND);
    }

    @Test
    @DisplayName("친구 삭제 — 상대가 탈퇴했어도 잔존 관계를 끊을 수 있다 (GROMO-801)")
    void deleteFriend_withdrawnCounterpart_stillDeletes() {
        // 해제는 관계를 줄이는 방향이라 탈퇴자를 대상으로 허용해도 유령이 늘지 않는다.
        // 반대로 막아버리면 이 변경 배포 전에 탈퇴해 정리되지 않은 관계를 영구히 못 지운다(백필을 하지 않으므로).
        User withdrawn = User.builder().id(targetId).build();   // 닉네임 파기된 탈퇴자
        Friendship f = friendship(me, withdrawn, FriendshipStatus.ACCEPTED);
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(withdrawn));
        given(friendshipRepository.findAcceptedBetween(me, withdrawn)).willReturn(Optional.of(f));

        friendService.deleteFriend(meId, targetId);

        assertThat(f.getDeletedAt()).isNotNull();
    }

    @Test
    @DisplayName("핀 해제 — 상대가 탈퇴했어도 해제할 수 있다 (GROMO-801)")
    void unpinFriend_withdrawnCounterpart_stillUnpins() {
        User withdrawn = User.builder().id(targetId).build();   // 닉네임 파기된 탈퇴자
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(withdrawn));

        friendService.unpinFriend(meId, targetId);

        verify(pinnedUserRepository).deletePin(meId, targetId);
    }

    // ── getFriends ─────────────────────────────────────────

    @Test
    @DisplayName("친구 목록 — 양방향(from/to) 모두 상대 유저로 매핑, isPinned=false")
    void getFriends_mapsCounterpart_bothDirections() {
        User a = user(UUID.randomUUID(), "alice");
        User b = user(UUID.randomUUID(), "bob");
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me)).willReturn(List.of(
                friendship(me, a, FriendshipStatus.ACCEPTED),   // me가 from
                friendship(b, me, FriendshipStatus.ACCEPTED)    // me가 to
        ));

        List<FriendResponse> friends = friendService.getFriends(meId, DATE);

        assertThat(friends).extracting(FriendResponse::getUserId)
                .containsExactlyInAnyOrder(a.getId(), b.getId());
        assertThat(friends).extracting(FriendResponse::getNickname)
                .containsExactlyInAnyOrder("alice", "bob");
        assertThat(friends).allMatch(f -> !f.isPinned());
    }

    @Test
    @DisplayName("친구 목록 — 아레나 소속과 무관하게 User 티어를 LeagueTierLookup 에서 도출 (GROMO-814)")
    void getFriends_restoresTierLevel_fromLeagueLookup() {
        User a = user(UUID.randomUUID(), "alice");
        User b = user(UUID.randomUUID(), "bob");
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me)).willReturn(List.of(
                friendship(me, a, FriendshipStatus.ACCEPTED),
                friendship(me, b, FriendshipStatus.ACCEPTED)
        ));
        // 상대 userId 들을 한 번에 모아 배치 조회 → alice=티어3, 신규 bob=기본 티어1
        given(leagueTierLookup.tierLevelsByUserId(List.of(a.getId(), b.getId())))
                .willReturn(Map.of(a.getId(), 3, b.getId(), 1));

        List<FriendResponse> friends = friendService.getFriends(meId, DATE);

        assertThat(friends).filteredOn(f -> f.getUserId().equals(a.getId()))
                .extracting(FriendResponse::getTierLevel).containsExactly(3);
        assertThat(friends).filteredOn(f -> f.getUserId().equals(b.getId()))
                .extracting(FriendResponse::getTierLevel).containsExactly(1);
    }

    // ── getRequests ────────────────────────────────────────

    @Test
    @DisplayName("받은 요청 목록(received) — fromUser를 상대로 매핑")
    void getRequests_received_mapsFromUser() {
        Friendship req = friendship(target, me, FriendshipStatus.PENDING);
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
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
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "sent");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getUserId()).isEqualTo(targetId);
    }

    @Test
    @DisplayName("요청 목록 — 티어는 users.tier_level 기반 LeagueTierLookup 에서 도출 (GROMO-814)")
    void getRequests_restoresTierLevel_fromLeagueLookup() {
        Friendship req = friendship(target, me, FriendshipStatus.PENDING);
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));
        given(leagueTierLookup.tierLevelsByUserId(List.of(targetId)))
                .willReturn(Map.of(targetId, 4));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "received");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getTierLevel()).isEqualTo(4);
    }

    @Test
    @DisplayName("보낸 요청 목록(sent) — 티어는 toUser(상대) 기준으로 도출·매핑 (GROMO-710)")
    void getRequests_sent_restoresTierLevel_fromLeagueLookup() {
        Friendship req = friendship(me, target, FriendshipStatus.PENDING);
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(req));
        // sent 방향: 상대는 toUser(target) — 티어 배치 조회 대상도 target 이어야 한다
        given(leagueTierLookup.tierLevelsByUserId(List.of(targetId)))
                .willReturn(Map.of(targetId, 2));

        List<FriendRequestResponse> requests = friendService.getRequests(meId, "sent");

        assertThat(requests).hasSize(1);
        assertThat(requests.get(0).getUserId()).isEqualTo(targetId);
        assertThat(requests.get(0).getTierLevel()).isEqualTo(2);
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

        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(nicknameStrategy.search(meId, "f")).willReturn(List.of(
                result(meId, "me"),
                result(friendId, "friend"),
                result(pendingId, "pending"),
                result(strangerId, "stranger")
        ));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, friend, FriendshipStatus.ACCEPTED)));
        given(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(friendship(me, pending, FriendshipStatus.PENDING)));
        given(friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.of(target));

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
        given(userRepository.findActiveByIdForShare(meId)).willReturn(Optional.of(me));
        given(userRepository.findActiveByIdForShare(targetId)).willReturn(Optional.empty());

        assertThatThrownBy(() -> friendService.pinFriend(meId, targetId))
                .isInstanceOf(UserException.class);
        verify(pinnedUserRepository, never()).insertIgnoreConflict(any(), any(), any());
    }

    @Test
    @DisplayName("핀 해제 — 핀이 없어도(0행) 예외 없이 멱등 성공 (GROMO-801)")
    void unpinFriend_noPin_idempotent() {
        // 조회 후 remove 방식이면 탈퇴의 핀 정리와 겹칠 때 0행 DELETE 로 StaleStateException(500) 이 났다.
        // 벌크 DELETE 는 0행 매치를 정상으로 처리한다.
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(pinnedUserRepository.deletePin(meId, targetId)).willReturn(0);

        friendService.unpinFriend(meId, targetId);

        verify(pinnedUserRepository).deletePin(meId, targetId);
        verify(pinnedUserRepository, never()).delete(any());
    }

    @Test
    @DisplayName("친구 목록 — 핀한 친구는 isPinned=true 매핑")
    void getFriends_pinnedFriend_isPinnedTrue() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));
        given(pinnedUserRepository.findByUser(me))
                .willReturn(List.of(PinnedUser.builder().user(me).pinnedUser(target).build()));

        List<FriendResponse> friends = friendService.getFriends(meId, DATE);

        assertThat(friends).hasSize(1);
        assertThat(friends.get(0).getUserId()).isEqualTo(targetId);
        assertThat(friends.get(0).isPinned()).isTrue();
    }

    @Test
    @DisplayName("친구 목록 — 집중 중 친구는 라이브 필드(분·isFocusing·시작시각·태그명) 채워짐 (GROMO-822)")
    void getFriends_focusingFriend_fillsLiveFields() {
        Instant start = Instant.parse("2026-07-03T01:00:00Z");
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));
        given(focusLiveInfoLookup.liveInfoByUserId(List.of(targetId), DATE))
                .willReturn(Map.of(targetId, new FocusLiveInfo(42, true, start, "전공 공부")));

        List<FriendResponse> friends = friendService.getFriends(meId, DATE);

        assertThat(friends).hasSize(1);
        FriendResponse f = friends.get(0);
        assertThat(f.getUserId()).isEqualTo(targetId);
        assertThat(f.isFocusing()).isTrue();
        assertThat(f.getFocusTimeMinutes()).isEqualTo(42);
        assertThat(f.getFocusStartedAt()).isEqualTo(start);
        assertThat(f.getFocusTagName()).isEqualTo("전공 공부");
    }

    @Test
    @DisplayName("친구 목록 — 라이브 정보 없는 친구는 기본값(0·false·null)")
    void getFriends_noLiveInfo_defaults() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));
        // liveInfoByUserId 는 미조회 유저를 맵에 담지 않는다 → Mockito 기본 빈 맵 반환

        List<FriendResponse> friends = friendService.getFriends(meId, DATE);

        assertThat(friends).hasSize(1);
        FriendResponse f = friends.get(0);
        assertThat(f.isFocusing()).isFalse();
        assertThat(f.getFocusTimeMinutes()).isZero();
        assertThat(f.getFocusStartedAt()).isNull();
        assertThat(f.getFocusTagName()).isNull();
    }

    @Test
    @DisplayName("친구 목록 — 조회 date 가 FocusLiveInfoLookup 에 그대로 전달됨")
    void getFriends_passesDateToLookup() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.ACCEPTED)));

        friendService.getFriends(meId, DATE);

        verify(focusLiveInfoLookup).liveInfoByUserId(anyList(), eq(DATE));
    }

    @Test
    @DisplayName("핀 해제 — 핀 있으면 삭제")
    void unpinFriend_deletesWhenPresent() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
        given(userRepository.findById(targetId)).willReturn(Optional.of(target));
        given(pinnedUserRepository.deletePin(meId, targetId)).willReturn(1);

        friendService.unpinFriend(meId, targetId);

        verify(pinnedUserRepository).deletePin(meId, targetId);
    }

    @Test
    @DisplayName("핀 친구 조회 — 오늘 집중분/진행중 매핑")
    void getPinnedFriends_mapsFocusInfo() {
        given(userRepository.findByIdAndIsDeletedFalse(meId)).willReturn(Optional.of(me));
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
