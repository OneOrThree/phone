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
import com.oneorthree.phone.social.search.FriendSearchStrategy;
import com.oneorthree.phone.social.search.SearchType;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
@Transactional(readOnly = true)
public class FriendService {

    private final FriendshipRepository friendshipRepository;
    private final UserRepository userRepository;
    private final Map<SearchType, FriendSearchStrategy> searchStrategies;

    // 검색 전략은 AuthService의 Map<Provider, SocialLoginClient>와 동일하게
    // 모든 빈을 모아 type() 기준 Map으로 구성한다. (검색 수단 추가 = 구현체 1개 추가)
    public FriendService(FriendshipRepository friendshipRepository,
                         UserRepository userRepository,
                         List<FriendSearchStrategy> searchStrategies) {
        this.friendshipRepository = friendshipRepository;
        this.userRepository = userRepository;
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
            return;
        }

        friendshipRepository.save(Friendship.builder()
                .fromUser(fromUser)
                .toUser(toUser)
                .status(FriendshipStatus.PENDING)
                .build());
    }

    // 요청 수락 — 수신자(toUser)만 가능. PENDING → ACCEPTED.
    @Transactional
    public void acceptRequest(UUID me, UUID requestId) {
        getReceivedRequest(me, requestId).accept();
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

    // 친구 목록 — ACCEPTED·미삭제 관계를 상대 유저로 매핑. isPinned는 GROMO-454 전까지 false.
    public List<FriendResponse> getFriends(UUID me) {
        User meUser = getUser(me);
        return friendshipRepository.findAcceptedByUser(meUser).stream()
                .map(f -> toFriendResponse(counterpart(f, me)))
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

    private FriendResponse toFriendResponse(User other) {
        return FriendResponse.builder()
                .userId(other.getId())
                .nickname(other.getNickname())
                .tierLevel(other.getCurrentTier())
                .isPinned(false)
                .build();
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
