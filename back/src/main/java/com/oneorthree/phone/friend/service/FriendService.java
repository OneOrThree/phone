package com.oneorthree.phone.friend.service;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.NoArgGenerator;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.stats.domain.DailyFocusStat;
import com.oneorthree.phone.stats.repository.DailyFocusStatRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.domain.PinnedFriend;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.dto.FriendSearchResultResponse;
import com.oneorthree.phone.friend.dto.PinnedFriendResponse;
import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedFriendRepository;
import com.oneorthree.phone.friend.search.FriendSearchStrategy;
import com.oneorthree.phone.friend.search.SearchType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class FriendService {

    // pinned_friends.id 직접 생성용 (네이티브 INSERT는 @GeneratedUuidV7를 안 타므로 직접 발급)
    private static final NoArgGenerator UUID_V7 = Generators.timeBasedEpochRandomGenerator();

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final PinnedFriendRepository pinnedFriendRepository;
    private final DailyFocusStatRepository dailyFocusStatRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final UserActivityEventLogger userActivityEventLogger;
    private final Map<SearchType, FriendSearchStrategy> searchStrategies;

    // 검색 전략은 AuthService의 Map<Provider, SocialLoginClient>와 동일하게
    // 모든 빈을 모아 type() 기준 Map으로 구성한다. (검색 수단 추가 = 구현체 1개 추가)
    public FriendService(FriendshipRepository friendshipRepository,
                         UserRepository userRepository,
                         PinnedFriendRepository pinnedFriendRepository,
                         DailyFocusStatRepository dailyFocusStatRepository,
                         FocusSessionRepository focusSessionRepository,
                         CharacterEquipmentRepository characterEquipmentRepository,
                         UserActivityEventLogger userActivityEventLogger,
                         List<FriendSearchStrategy> searchStrategies) {
        this.friendshipRepository = friendshipRepository;
        this.userRepository = userRepository;
        this.pinnedFriendRepository = pinnedFriendRepository;
        this.dailyFocusStatRepository = dailyFocusStatRepository;
        this.focusSessionRepository = focusSessionRepository;
        this.characterEquipmentRepository = characterEquipmentRepository;
        this.userActivityEventLogger = userActivityEventLogger;
        this.searchStrategies = searchStrategies.stream()
                .collect(Collectors.toMap(FriendSearchStrategy::type, strategy -> strategy));
    }

    // 친구 요청 생성. 자기자신·중복·이미친구 검증 후 PENDING insert,
    // 단 내가 보냈던 REJECTED 요청이 있으면 그 row를 PENDING으로 재전환(쿨다운은 GROMO-475).
    @Transactional
    public void createRequest(UUID me, UUID targetUserId) {
        if (me.equals(targetUserId)) {
            throw new FriendException(FriendErrorCode.SELF_REQUEST);
        }
        User fromUser = getUser(me);
        User toUser = getUser(targetUserId);

        List<Friendship> pair = friendshipRepository.findPair(fromUser, toUser);
        for (Friendship f : pair) {
            if (f.getStatus() == FriendshipStatus.ACCEPTED && f.getDeletedAt() == null) {
                throw new FriendException(FriendErrorCode.ALREADY_FRIEND);
            }
            if (f.getStatus() == FriendshipStatus.PENDING) {
                throw new FriendException(FriendErrorCode.REQUEST_ALREADY_EXISTS);
            }
        }

        // unique(from,to) 충돌 회피: 내가 보냈던 (me→target) REJECTED row가 있으면 재전환
        Friendship myRejected = pair.stream()
                .filter(f -> f.getFromUser().getId().equals(me)
                        && f.getStatus() == FriendshipStatus.REJECTED)
                .findFirst()
                .orElse(null);
        if (myRejected != null) {
            myRejected.reopen();
            logRequestSent(targetUserId, true);
            return;
        }

        friendshipRepository.save(Friendship.builder()
                .fromUser(fromUser)
                .toUser(toUser)
                .status(FriendshipStatus.PENDING)
                .build());
        logRequestSent(targetUserId, false);
    }

    // 요청 생성 이벤트 — 신규 insert·REJECTED 재전환 두 경로 모두 1회씩, reopened 로 구분
    private void logRequestSent(UUID targetUserId, boolean reopened) {
        userActivityEventLogger.log(UserActivityEvent.FRIEND_REQUEST_SENT,
                Map.of("to_user_id", targetUserId.toString(), "reopened", reopened));
    }

    // 요청 수락 — 수신자(toUser)만 가능. PENDING → ACCEPTED.
    @Transactional
    public void acceptRequest(UUID me, UUID requestId) {
        Friendship friendship = getReceivedRequest(me, requestId);
        friendship.accept();
        userActivityEventLogger.log(UserActivityEvent.FRIEND_ADDED,
                Map.of("request_id", requestId.toString(),
                        "from_user_id", friendship.getFromUser().getId().toString()));
    }

    // 요청 거절 — 수신자(toUser)만 가능. PENDING → REJECTED.
    @Transactional
    public void rejectRequest(UUID me, UUID requestId) {
        getReceivedRequest(me, requestId).reject();
    }

    // 친구 삭제 — ACCEPTED 관계를 양측 누구나 soft delete.
    @Transactional
    public void deleteFriend(UUID me, UUID friendUserId) {
        User meUser = getUser(me);
        User friendUser = getUser(friendUserId);
        Friendship friendship = friendshipRepository.findAcceptedBetween(meUser, friendUser)
                .orElseThrow(() -> new FriendException(FriendErrorCode.NOT_FRIEND));
        friendship.softDelete(Instant.now());
    }

    // 친구 목록 — ACCEPTED·미삭제 관계를 상대 유저로 매핑. isPinned는 내 핀 친구 집합으로 결정.
    public List<FriendResponse> getFriends(UUID me) {
        User meUser = getUser(me);
        Set<UUID> pinnedIds = pinnedFriendRepository.findByUser(meUser).stream()
                .map(p -> p.getFriendUser().getId())
                .collect(Collectors.toSet());
        return friendshipRepository.findAcceptedByUser(meUser).stream()
                .map(f -> {
                    User other = counterpart(f, me);
                    return FriendResponse.builder()
                            .userId(other.getId())
                            .nickname(other.getNickname())
                            .tierLevel(other.getCurrentTier())
                            .isPinned(pinnedIds.contains(other.getId()))
                            .build();
                })
                .toList();
    }

    // 친구 핀 설정 — ACCEPTED 검증 후 멱등 insert. 이미 핀돼 있으면 no-op(204).
    @Transactional
    public void pinFriend(UUID me, UUID friendUserId) {
        User meUser = getUser(me);
        User friendUser = getUser(friendUserId);
        friendshipRepository.findAcceptedBetween(meUser, friendUser)
                .orElseThrow(() -> new FriendException(FriendErrorCode.NOT_FRIEND));
        // ON CONFLICT DO NOTHING — 동시 핀 요청에도 멱등(중복은 무시), 500 없음.
        pinnedFriendRepository.insertIgnoreConflict(UUID_V7.generate(), me, friendUserId);
    }

    // 친구 핀 해제 — 있으면 삭제, 없으면 멱등(204).
    @Transactional
    public void unpinFriend(UUID me, UUID friendUserId) {
        User meUser = getUser(me);
        User friendUser = getUser(friendUserId);
        pinnedFriendRepository.findByUserAndFriendUser(meUser, friendUser)
                .ifPresent(pinnedFriendRepository::delete);
    }

    // 내가 핀한 친구 조회 — 각 친구의 캐릭터 표시정보 + 오늘 집중분 + 진행중 여부 매핑(GROMO-369 재사용).
    public List<PinnedFriendResponse> getPinnedFriends(UUID me) {
        User meUser = getUser(me);
        List<User> friends = pinnedFriendRepository.findByUser(meUser).stream()
                .map(PinnedFriend::getFriendUser)
                .toList();
        if (friends.isEmpty()) {
            return List.of();
        }

        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        Map<UUID, Integer> focusMap = dailyFocusStatRepository.findByUserInAndDate(friends, today).stream()
                .collect(Collectors.toMap(s -> s.getUser().getId(), DailyFocusStat::getTotalFocusMinutes));
        Set<UUID> focusingIds = focusSessionRepository.findByUserInAndEndedAtIsNull(friends).stream()
                .map(s -> s.getUser().getId())
                .collect(Collectors.toSet());
        Map<UUID, List<CharacterEquipmentResponse>> equipMap =
                characterEquipmentRepository.findByUserIn(friends).stream()
                        .collect(Collectors.groupingBy(e -> e.getUser().getId(),
                                Collectors.mapping(CharacterEquipmentResponse::from, Collectors.toList())));

        return friends.stream()
                .map(f -> PinnedFriendResponse.builder()
                        .userId(f.getId())
                        .nickname(f.getNickname())
                        .character(equipMap.getOrDefault(f.getId(), List.of()))
                        .focusTimeMinutes(focusMap.getOrDefault(f.getId(), 0))
                        .isFocusing(focusingIds.contains(f.getId()))
                        .build())
                .toList();
    }

    // PENDING 요청 목록 — type=received(받은) | sent(보낸).
    public List<FriendRequestResponse> getRequests(UUID me, String type) {
        User meUser = getUser(me);
        boolean received = "received".equalsIgnoreCase(type);
        List<Friendship> requests = received
                ? friendshipRepository.findByToUserAndStatus(meUser, FriendshipStatus.PENDING)
                : friendshipRepository.findByFromUserAndStatus(meUser, FriendshipStatus.PENDING);

        return requests.stream()
                .map(f -> {
                    User other = received ? f.getFromUser() : f.getToUser();
                    return FriendRequestResponse.builder()
                            .requestId(f.getId())
                            .userId(other.getId())
                            .nickname(other.getNickname())
                            .tierLevel(other.getCurrentTier())
                            .createdAt(f.getCreatedAt())
                            .build();
                })
                .toList();
    }

    // 친구 검색 — type 전략에 위임 후 자기자신 제외 + 기존 관계(relation) 표기.
    public List<FriendSearchResultResponse> search(UUID me, SearchType type, String query) {
        FriendSearchStrategy strategy = searchStrategies.get(type);
        if (strategy == null) {
            throw new IllegalArgumentException("지원하지 않는 검색 수단입니다: " + type);
        }
        User meUser = getUser(me);
        Set<UUID> friendIds = collectFriendIds(meUser);
        Set<UUID> pendingIds = collectPendingIds(meUser);

        return strategy.search(me, query).stream()
                .filter(r -> !r.getUserId().equals(me))
                .map(r -> FriendSearchResultResponse.builder()
                        .userId(r.getUserId())
                        .nickname(r.getNickname())
                        .tierLevel(r.getTierLevel())
                        .relation(resolveRelation(r.getUserId(), friendIds, pendingIds))
                        .build())
                .toList();
    }

    // ── 내부 헬퍼 ──────────────────────────────────────────

    private User getUser(UUID userId) {
        return userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
    }

    // requestId로 PENDING 요청 조회 후 수신자(toUser) 본인인지 검증.
    private Friendship getReceivedRequest(UUID me, UUID requestId) {
        Friendship friendship = friendshipRepository.findById(requestId)
                .orElseThrow(() -> new FriendException(FriendErrorCode.REQUEST_NOT_FOUND));
        if (!friendship.getToUser().getId().equals(me)) {
            throw new FriendException(FriendErrorCode.NOT_REQUEST_RECEIVER);
        }
        return friendship;
    }

    // 친구 관계에서 내가 아닌 상대 유저를 반환.
    private User counterpart(Friendship friendship, UUID me) {
        return friendship.getFromUser().getId().equals(me)
                ? friendship.getToUser()
                : friendship.getFromUser();
    }

    private Set<UUID> collectFriendIds(User meUser) {
        return friendshipRepository.findAcceptedByUser(meUser).stream()
                .map(f -> counterpart(f, meUser.getId()).getId())
                .collect(Collectors.toCollection(HashSet::new));
    }

    private Set<UUID> collectPendingIds(User meUser) {
        Set<UUID> ids = new HashSet<>();
        friendshipRepository.findByFromUserAndStatus(meUser, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getToUser().getId()));
        friendshipRepository.findByToUserAndStatus(meUser, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getFromUser().getId()));
        return ids;
    }

    private FriendRelation resolveRelation(UUID userId, Set<UUID> friendIds, Set<UUID> pendingIds) {
        if (friendIds.contains(userId)) {
            return FriendRelation.FRIEND;
        }
        if (pendingIds.contains(userId)) {
            return FriendRelation.PENDING;
        }
        return FriendRelation.NONE;
    }
}
