package com.oneorthree.phone.friend.service;

import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;

/**
 * FriendRelationLookup 단위 테스트 (GROMO-1631).
 * FriendService.search 에서 추출한 관계 판정 로직 — 검색·프로필 공유 컴포넌트.
 */
@ExtendWith(MockitoExtension.class)
class FriendRelationLookupTest {

    @InjectMocks
    private FriendRelationLookup friendRelationLookup;

    @Mock
    private FriendshipRepository friendshipRepository;

    private UUID meId;
    private UUID targetId;
    private User me;
    private User target;

    @BeforeEach
    void setUp() {
        meId = UUID.randomUUID();
        targetId = UUID.randomUUID();
        me = user(meId, "me");
        target = user(targetId, "target");
    }

    private User user(UUID id, String nickname) {
        return User.builder().id(id).nickname(nickname).build();
    }

    private Friendship friendship(User from, User to, FriendshipStatus status) {
        return Friendship.builder()
                .id(UUID.randomUUID())
                .fromUser(from)
                .toUser(to)
                .status(status)
                .build();
    }

    @Test
    @DisplayName("ACCEPTED 관계 → FRIEND (내가 fromUser·toUser 어느 쪽이든 상대로 매핑)")
    void relationOf_accepted_returnsFriend() {
        // 내가 toUser 인 방향으로 두어 counterpart 매핑까지 검증
        given(friendshipRepository.findAcceptedByUser(me))
                .willReturn(List.of(friendship(target, me, FriendshipStatus.ACCEPTED)));

        assertThat(friendRelationLookup.relationOf(me, targetId)).isEqualTo(FriendRelation.FRIEND);
    }

    @Test
    @DisplayName("PENDING — 내가 보낸 요청 → PENDING (방향 무구분, N02)")
    void relationOf_pendingSent_returnsPending() {
        given(friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(friendship(me, target, FriendshipStatus.PENDING)));

        assertThat(friendRelationLookup.relationOf(me, targetId)).isEqualTo(FriendRelation.PENDING);
    }

    @Test
    @DisplayName("PENDING — 내가 받은 요청 → PENDING (방향 무구분, N02)")
    void relationOf_pendingReceived_returnsPending() {
        given(friendshipRepository.findByToUserAndStatusAndDeletedAtIsNull(me, FriendshipStatus.PENDING))
                .willReturn(List.of(friendship(target, me, FriendshipStatus.PENDING)));

        assertThat(friendRelationLookup.relationOf(me, targetId)).isEqualTo(FriendRelation.PENDING);
    }

    @Test
    @DisplayName("아무 관계 없음 → NONE")
    void relationOf_stranger_returnsNone() {
        // 리포지토리 스텁 없음 — 목 기본값(빈 리스트) = 관계 없음
        assertThat(friendRelationLookup.relationOf(me, targetId)).isEqualTo(FriendRelation.NONE);
    }

    @Test
    @DisplayName("soft delete 된 친구 관계 → NONE (findAcceptedByUser 가 deletedAt IS NULL 필터라 조회에서 빠짐)")
    void relationOf_softDeletedFriend_returnsNone() {
        // findAcceptedByUser 는 ACCEPTED + deletedAt IS NULL 만 반환하는 계약 —
        // soft delete 된 관계는 쿼리 단계에서 걸러져 빈 결과가 온다. 여기서는 그 계약 결과를 재현한다.
        given(friendshipRepository.findAcceptedByUser(me)).willReturn(List.of());

        assertThat(friendRelationLookup.relationOf(me, targetId)).isEqualTo(FriendRelation.NONE);
    }

    @Test
    @DisplayName("FRIEND 가 PENDING 보다 우선한다 (둘 다 있으면 FRIEND)")
    void resolveRelation_friendWinsOverPending() {
        FriendRelation relation = friendRelationLookup.resolveRelation(
                targetId, Set.of(targetId), Set.of(targetId));

        assertThat(relation).isEqualTo(FriendRelation.FRIEND);
    }
}
