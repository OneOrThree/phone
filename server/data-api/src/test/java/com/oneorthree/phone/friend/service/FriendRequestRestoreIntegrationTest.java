package com.oneorthree.phone.friend.service;

import com.oneorthree.phone.common.support.IntegrationTestBase;
import com.oneorthree.phone.friend.domain.Friendship;
import com.oneorthree.phone.friend.domain.FriendshipStatus;
import com.oneorthree.phone.friend.dto.FriendRequestResponse;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * 친구 삭제 후 재요청의 <b>행 복원</b> 통합 테스트 (GROMO-719) — 실 DB + unique(from_user_id, to_user_id).
 *
 * <p>여기서만 확인할 수 있는 성질: 재요청이 insert 로 빠지면 실 DB 의 유니크 제약과 충돌해
 * DataIntegrityViolation(409) 이 난다. 목 기반 단위 테스트는 제약이 없어 이 회귀를 잡지 못한다.
 *
 * <p>{@code @Transactional} 을 붙이지 않는다 — 서비스 호출마다 실제 커밋을 태워 제약 위반이
 * 그 자리에서 터지게 한다. 데이터는 {@code @AfterEach} 에서 직접 지운다(soft delete 행 포함,
 * findPair 는 deletedAt 무필터라 전량 걷힌다).
 */
class FriendRequestRestoreIntegrationTest extends IntegrationTestBase {

    @Autowired
    FriendService friendService;
    @Autowired
    FriendshipRepository friendshipRepository;
    @Autowired
    UserRepository userRepository;

    private User userX;
    private User userY;

    @BeforeEach
    void setUp() {
        userX = plainUser("복원X");
        userY = plainUser("복원Y");
    }

    @AfterEach
    void tearDown() {
        friendshipRepository.deleteAll(friendshipRepository.findPair(userX, userY));
        userRepository.deleteAll(List.of(userX, userY));
    }

    @Test
    @DisplayName("요청→수락→삭제→재요청 — 유니크 제약 충돌 없이 soft delete 행이 PENDING 으로 복원된다")
    void deleteThenReRequest_restoresRowWithoutConstraintViolation() {
        befriend(userX, userY);
        friendService.deleteFriend(userX.getId(), userY.getId());

        // 복원이 없으면 insert 가 unique(from,to) 와 충돌해 DataIntegrityViolation(409) — 영구 막힘
        assertThatCode(() -> friendService.createRequest(userX.getId(), userY.getId()))
                .doesNotThrowAnyException();

        List<Friendship> pair = friendshipRepository.findPair(userX, userY);
        assertThat(pair).singleElement().satisfies(f -> {
            assertThat(f.getStatus()).isEqualTo(FriendshipStatus.PENDING);
            assertThat(f.getDeletedAt()).isNull();
        });
    }

    @Test
    @DisplayName("양방향 사이클 소진 후에도 재요청·재수락 가능 — X→Y·Y→X 각 1회 삭제 뒤 X→Y 가 다시 친구가 된다")
    void bidirectionalCycle_thenReRequest_succeeds() {
        // 양쪽 방향 행이 모두 남은 최악 케이스 — 복원 없이는 두 유저가 다시는 친구가 될 수 없었다.
        befriend(userX, userY);
        friendService.deleteFriend(userX.getId(), userY.getId());
        befriend(userY, userX);
        friendService.deleteFriend(userY.getId(), userX.getId());

        befriend(userX, userY);

        assertThat(friendshipRepository.findAcceptedBetween(userX, userY)).isPresent();
        // 방향별 1행 재사용 — 복원이 insert 대신 기존 행을 되살렸다는 증거
        assertThat(friendshipRepository.findPair(userX, userY)).hasSize(2);
    }

    @Test
    @DisplayName("복원된 재요청은 수신자 요청 목록에 재요청 시점으로 보인다 — 원래 관계의 createdAt 노출 금지")
    void restoredRequest_showsFreshRequestTimeInReceivedList() {
        // 응답 createdAt 의 소스는 updatedAt 이다 — 행의 createdAt 은 @CreationTimestamp(insert 생성)라
        // UPDATE 에서 제외돼 갱신할 수 없고, 복원 UPDATE 가 갱신하는 updatedAt 이 재요청 시점을 담는다.
        // @UpdateTimestamp 생성값이 실제 UPDATE 에 실려 DB 까지 가는지는 실 DB 로만 증명된다 —
        // getRequests 는 새 트랜잭션에서 DB 를 다시 읽는다.
        befriend(userX, userY);
        friendService.deleteFriend(userX.getId(), userY.getId());

        Instant beforeReRequest = Instant.now();
        friendService.createRequest(userX.getId(), userY.getId());

        List<FriendRequestResponse> received = friendService.getRequests(userY.getId(), "received");
        assertThat(received).singleElement().satisfies(r -> {
            assertThat(r.getUserId()).isEqualTo(userX.getId());
            // 원래 관계를 맺을 때의 시각(재요청 이전)이 아니라 재요청 시점이어야 한다
            assertThat(r.getCreatedAt()).isAfterOrEqualTo(beforeReRequest);
        });
    }

    @Test
    @DisplayName("신규 요청(insert)도 요청 목록 시각이 요청 시점이다 — updatedAt 소스 전환의 무회귀 확인")
    void freshRequest_showsRequestTimeInReceivedList() {
        // 신규 insert 는 @CreationTimestamp·@UpdateTimestamp 가 같은 시점에 생성돼 소스 전환의 영향이 없다.
        Instant beforeRequest = Instant.now();
        friendService.createRequest(userX.getId(), userY.getId());

        List<FriendRequestResponse> received = friendService.getRequests(userY.getId(), "received");
        assertThat(received).singleElement().satisfies(r -> {
            assertThat(r.getUserId()).isEqualTo(userX.getId());
            assertThat(r.getCreatedAt()).isNotNull().isAfterOrEqualTo(beforeRequest);
        });
    }

    // ── 픽스처 ──────────────────────────────────────────────────────────

    private void befriend(User from, User to) {
        friendService.createRequest(from.getId(), to.getId());
        friendService.acceptRequest(to.getId(), pendingRequestId(from));
    }

    private UUID pendingRequestId(User from) {
        List<Friendship> pending = friendshipRepository.findByFromUserAndStatusAndDeletedAtIsNull(
                from, FriendshipStatus.PENDING);
        assertThat(pending).hasSize(1);
        return pending.get(0).getId();
    }

    /** 푸시 경로가 개입하지 않도록 deviceToken 없이 만든다 — 이 테스트의 관심사는 행 복원뿐이다. */
    private User plainUser(String nickname) {
        // 닉네임은 유니크할 수 있어(users.nickname 조회 경로 존재) 다른 테스트와 겹치지 않게 접미사를 붙인다.
        return userRepository.save(User.builder()
                .nickname(nickname + "-" + UUID.randomUUID())
                .isGuest(false)
                .build());
    }
}
