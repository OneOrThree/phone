package com.oneorthree.phone.friend.repository;

import com.oneorthree.phone.common.support.RepositoryTestBase;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FriendshipRepositoryTest extends RepositoryTestBase {

    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;
    @Autowired
    EntityManager em;

    @BeforeEach
    void enableTrgm() {
        // create-drop 스키마는 확장/인덱스를 만들지 않으므로 trgm 연산자(%, <->)를 테스트 트랜잭션에서 보장한다.
        em.createNativeQuery("CREATE EXTENSION IF NOT EXISTS pg_trgm").executeUpdate();
    }

    private User saveUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).currentTier(1).build());
    }

    private User saveDeletedUser(String nickname) {
        return userRepository.save(User.builder().nickname(nickname).currentTier(1)
                .deletedAt(Instant.now()).build());
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
    @DisplayName("searchByNicknameTrgm — 실제 trgm 유사 매칭, 다른 닉네임·삭제 유저 제외")
    void searchByNicknameTrgm_matchesSimilar_excludesDeleted() {
        User alice = saveUser("alice");
        User alicekim = saveUser("alicekim");
        User bob = saveUser("bob");
        saveDeletedUser("alicezzz");   // trgm 매칭되지만 soft delete → 제외
        userRepository.flush();

        List<User> results = userRepository.searchByNicknameTrgm("alice", 20);

        List<UUID> ids = results.stream().map(User::getId).toList();
        assertThat(ids).contains(alice.getId(), alicekim.getId());
        assertThat(ids).doesNotContain(bob.getId());
        assertThat(results).extracting(User::getNickname).doesNotContain("alicezzz");
        // 가장 유사한 'alice'가 거리순(<->) 선두
        assertThat(results.get(0).getNickname()).isEqualTo("alice");
    }
}
