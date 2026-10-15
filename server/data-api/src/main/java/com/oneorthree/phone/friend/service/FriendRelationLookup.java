package com.oneorthree.phone.friend.service;

import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * 나와 다른 유저들의 친구 관계(NONE|PENDING|FRIEND)를 도출하는 공유 조회 컴포넌트 (GROMO-1631).
 *
 * <p>친구 검색({@code FriendService.search})과 공개 프로필({@code ProfileService})이 공유한다.
 * {@code UserTierLookup}(GROMO-710)·{@code FocusLiveInfoLookup}(GROMO-822)과 같은
 * 도메인 간 공유 조회 컴포넌트 패턴이다.</p>
 *
 * <p>판정은 내 관계 전량 로드(collect*) 후 Set 대조 — 관계는 소수(수십~수백)라 단건 조회 대상이
 * 하나여도 이 경로로 충분하다. {@code findPair} 는 쓰지 않는다(deletedAt 필터 없음·REJECTED 포함).
 * PENDING 은 방향 무구분(내가 보냈든 받았든 PENDING) — 방향 구분은 후속 티켓 (결정 장부 N02).</p>
 */
@Component
@RequiredArgsConstructor
public class FriendRelationLookup {

    private final FriendshipRepository friendshipRepository;

    /**
     * 나와 대상 유저 한 명의 관계를 도출한다 — 프로필 단건 조회용.
     * 내부적으로 {@link #collectFriendIds}·{@link #collectPendingIds} 전량 로드 후 대조한다.
     *
     * @param me           호출자 유저 (영속 엔티티 또는 참조)
     * @param targetUserId 대상 유저 ID
     * @return FRIEND(ACCEPTED·미삭제) > PENDING(방향 무구분) > NONE
     */
    public FriendRelation relationOf(User me, UUID targetUserId) {
        return resolveRelation(targetUserId, collectFriendIds(me), collectPendingIds(me));
    }

    /**
     * 내 친구(ACCEPTED·미삭제) 상대 유저 ID 집합 — soft delete 된 관계는 쿼리 단계에서 제외된다.
     *
     * @param me 호출자 유저
     * @return 친구 상대 유저 ID 집합
     */
    public Set<UUID> collectFriendIds(User me) {
        return friendshipRepository.findAcceptedByUser(me).stream()
                .map(f -> counterpart(f, me.getId()).getId())
                .collect(Collectors.toCollection(HashSet::new));
    }

    /**
     * 내 PENDING 요청 상대 유저 ID 집합 — 보낸 것·받은 것 양방향 합산(방향 무구분, N02).
     *
     * @param me 호출자 유저
     * @return PENDING 상대 유저 ID 집합
     */
    public Set<UUID> collectPendingIds(User me) {
        Set<UUID> ids = new HashSet<>();
        friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getToUser().getId()));
        friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING)
                .forEach(f -> ids.add(f.getFromUser().getId()));
        return ids;
    }

    /**
     * 수집된 집합으로 관계를 판정한다 — 여러 대상에 대조할 때 collect* 1회 후 반복 호출(검색 경로).
     *
     * @param userId     대상 유저 ID
     * @param friendIds  {@link #collectFriendIds} 결과
     * @param pendingIds {@link #collectPendingIds} 결과
     * @return FRIEND > PENDING > NONE
     */
    public FriendRelation resolveRelation(UUID userId, Set<UUID> friendIds, Set<UUID> pendingIds) {
        if (friendIds.contains(userId)) {
            return FriendRelation.FRIEND;
        }
        if (pendingIds.contains(userId)) {
            return FriendRelation.PENDING;
        }
        return FriendRelation.NONE;
    }

    /**
     * 친구 관계에서 내가 아닌 상대 유저를 반환.
     */
    private User counterpart(Friendship friendship, UUID me) {
        return friendship.getFromUser().getId().equals(me)
                ? friendship.getToUser()
                : friendship.getFromUser();
    }
}
