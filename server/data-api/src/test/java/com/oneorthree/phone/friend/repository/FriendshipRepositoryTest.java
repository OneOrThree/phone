package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FriendshipRepositoryTest extends RepositoryTestBase {

    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).build());
    }

    private Friendship save(User from, User to, FriendshipStatus status) {
        return friendshipRepository.save(Friendship.builder()
                .fromUser(from).toUser(to).status(status).build());
    }

    @Test
    @DisplayName("findPair — 두 유저 사이 (a→b)/(b→a) 양방향 모두 반환")
    void findPair_returnsBothDirections() {
        User a = saveUser("a");
        User b = saveUser("b");
        save(a, b, FriendshipStatus.PENDING);
        save(b, a, FriendshipStatus.REJECTED);
        friendshipRepository.flush();

        List<Friendship> pair = friendshipRepository.findPair(a, b);

        assertThat(pair).hasSize(2)
                .extracting(Friendship::getStatus)
                .containsExactlyInAnyOrder(FriendshipStatus.PENDING, FriendshipStatus.REJECTED);
    }

    @Test
    @DisplayName("findAcceptedBetween — ACCEPTED·미삭제만, 인자 순서 무관(양방향)")
    void findAcceptedBetween_acceptedNotDeleted_bidirectional() {
        User a = saveUser("a");
        User b = saveUser("b");
        save(a, b, FriendshipStatus.ACCEPTED);
        friendshipRepository.flush();

        // 인자 순서를 반대로 줘도 찾는다
        assertThat(friendshipRepository.findAcceptedBetween(b, a)).isPresent();
    }

    @Test
    @DisplayName("findAcceptedBetween — soft delete된 관계는 제외")
    void findAcceptedBetween_excludesDeleted() {
        User a = saveUser("a");
        User b = saveUser("b");
        Friendship f = save(a, b, FriendshipStatus.ACCEPTED);
        f.softDelete(Instant.now());
        friendshipRepository.flush();

        assertThat(friendshipRepository.findAcceptedBetween(a, b)).isEmpty();
    }

    @Test
    @DisplayName("findAcceptedByUser — 내가 from/to인 ACCEPTED만 (PENDING·삭제 제외)")
    void findAcceptedByUser_onlyAccepted() {
        User me = saveUser("me");
        User a = saveUser("a");
        User b = saveUser("b");
        User c = saveUser("c");
        User d = saveUser("d");
        save(me, a, FriendshipStatus.ACCEPTED);   // me가 from → 포함
        save(b, me, FriendshipStatus.ACCEPTED);   // me가 to → 포함
        save(me, c, FriendshipStatus.PENDING);    // PENDING → 제외
        Friendship deleted = save(me, d, FriendshipStatus.ACCEPTED);
        deleted.softDelete(Instant.now());        // 삭제 → 제외
        friendshipRepository.flush();

        List<Friendship> accepted = friendshipRepository.findAcceptedByUser(me);

        assertThat(accepted).hasSize(2);
    }

    @Test
    @DisplayName("countAcceptedByUser — 양방향 ACCEPTED 합산, PENDING·소프트딜리트 제외")
    void countAcceptedByUser_bidirectionalAccepted_excludesPendingAndDeleted() {
        User me = saveUser("me");
        User a = saveUser("a");
        User b = saveUser("b");
        User c = saveUser("c");
        User d = saveUser("d");
        save(me, a, FriendshipStatus.ACCEPTED);   // ① me가 fromUser → 카운트 대상
        save(b, me, FriendshipStatus.ACCEPTED);   // ② me가 toUser → 카운트 대상
        save(me, c, FriendshipStatus.PENDING);    // ③ PENDING → 제외
        Friendship deleted = save(me, d, FriendshipStatus.ACCEPTED);
        deleted.softDelete(Instant.now());        // ④ soft delete → 제외
        friendshipRepository.flush();

        long count = friendshipRepository.countAcceptedByUser(me);

        assertThat(count).isEqualTo(2);
    }

    @Test
    @DisplayName("findFriendUserIdsByUserId — 양방향 ACCEPTED 상대 id 집합, PENDING·소프트딜리트·남의 관계 제외")
    void findFriendUserIdsByUserId_bidirectional_excludesPendingDeletedAndOthers() {
        User me = saveUser("me");
        User a = saveUser("a");
        User b = saveUser("b");
        User c = saveUser("c");
        User d = saveUser("d");
        save(me, a, FriendshipStatus.ACCEPTED);   // me가 from → 상대 a 포함
        save(b, me, FriendshipStatus.ACCEPTED);   // me가 to → 상대 b 포함
        save(me, c, FriendshipStatus.PENDING);    // PENDING → 제외
        Friendship deleted = save(me, d, FriendshipStatus.ACCEPTED);
        deleted.softDelete(Instant.now());        // soft delete → 제외
        save(c, d, FriendshipStatus.ACCEPTED);    // 내가 안 낀 관계 → 제외
        friendshipRepository.flush();

        Set<UUID> friendIds = friendshipRepository.findFriendUserIdsByUserId(me.getId());

        assertThat(friendIds).containsExactlyInAnyOrder(a.getId(), b.getId());
    }
}
