package com.oneorthree.phone.friend.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.Friendship;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.friend.service.search.SearchType;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserBlockService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** 실제 PostgreSQL의 차단 방향과 친구 조회·검색의 결합을 검증한다. */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FriendMutualBlockIntegrationTest {

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    FriendService friends;
    @Autowired
    UserBlockService blocks;
    @Autowired
    UserRepository users;
    @Autowired
    FriendshipRepository friendships;

    @Test
    @DisplayName("단방향 차단도 친구 검색·목록에서 양쪽을 숨기고, 마지막 차단 해제 후 복원한다")
    void hidesBothDirectionsUntilEveryBlockIsRemoved() {
        User a = user();
        User b = user();
        User c = user();
        friendships.save(Friendship.builder().fromUser(a).toUser(b).status(FriendshipStatus.ACCEPTED).build());
        friendships.save(Friendship.builder().fromUser(c).toUser(a).status(FriendshipStatus.ACCEPTED).build());
        assertVisible(a, b);
        assertVisible(b, a);

        blocks.block(a.getId(), b.getId());
        assertHidden(a, b);
        assertHidden(b, a);
        assertVisible(a, c);
        assertThat(blocks.list(b.getId())).isEmpty();

        blocks.block(b.getId(), a.getId());
        blocks.unblock(a.getId(), b.getId());
        assertHidden(a, b);
        assertHidden(b, a);

        blocks.unblock(b.getId(), a.getId());
        assertVisible(a, b);
        assertVisible(b, a);
    }

    private void assertHidden(User viewer, User target) {
        assertThat(friends.search(viewer.getId(), SearchType.NICKNAME, target.getNickname())).isEmpty();
        assertThat(friends.getFriends(viewer.getId(), LocalDate.now()))
                .noneMatch(friend -> friend.getUserId().equals(target.getId()));
    }

    private void assertVisible(User viewer, User target) {
        assertThat(friends.search(viewer.getId(), SearchType.NICKNAME, target.getNickname()))
                .anyMatch(friend -> friend.getUserId().equals(target.getId()));
        assertThat(friends.getFriends(viewer.getId(), LocalDate.now()))
                .anyMatch(friend -> friend.getUserId().equals(target.getId()));
    }

    private User user() {
        return users.save(User.builder().nickname(UUID.randomUUID().toString().substring(0, 8)).build());
    }
}
