package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.friend.dto.FriendResponse;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.internal.dto.AccountPatchRequest;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.InternalAccountService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 메인 섬 (GROMO-1971)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점으로 검증한다.
 *
 * <p>시드는 전부 생산 엔티티·서비스로 만든다 — 섬 생성·가입·이탈·강퇴·계정탈퇴 모두 운영이 쓰는 서비스를
 * 그대로 부른다. 특히 이탈 계열은 <b>세 경로</b>(2.0 이탈·강퇴·계정탈퇴)를 각각 태워서, 공통 훅 한 곳이
 * 정말 전부를 덮는지 본다 — 마킹 지점마다 훅을 달았다면 셋 중 하나는 반드시 샌다.
 *
 * <p>알림은 신 경로(outbox)에만 있어 {@code notification.dispatch.mode=OUTBOX} 로 켠다. 발송이 아니라
 * <b>같은 트랜잭션에 봉투가 적혔는가</b>를 본다 — 그것이 이 기능이 약속하는 전부이고, 렌더·발송은
 * 알림 서버 몫이다.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MainIslandIntegrationTest {

    private static final String KIND = "MAIN_ISLAND_TRANSFERRED";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
    }

    @Autowired IslandMembershipService islands;
    @Autowired IslandJoinService joins;
    @Autowired IslandManagementService management;
    @Autowired GroupMemberService members;
    @Autowired AccountWithdrawalService withdrawal;
    @Autowired InternalAccountService account;
    @Autowired FriendService friends;
    @Autowired AuthService auth;
    @Autowired JwtProvider jwt;
    @Autowired JdbcTemplate jdbc;

    // ---------------------------------------------------------------- 도출 (요구 4)

    @Test
    @DisplayName("첫 소속 가입 직후 메인 섬은 그 섬이고, 추가 가입은 기존 메인 섬을 유지한다")
    void firstMembershipBecomesMainIslandAndLaterJoinsKeepIt() {
        Actor user = actor();
        UUID first = island(user, "첫섬");
        assertThat(mainIslandOf(user)).isEqualTo(first);
        // 고르지 않았으면 행을 만들지 않는다 — 도출이 기본 상태다.
        assertThat(chosenRows(user)).isZero();

        UUID second = joined(user, island(actor(), "둘째섬"));
        UUID third = joined(user, island(actor(), "셋째섬"));

        assertThat(mainIslandOf(user)).isEqualTo(first);
        assertThat(second).isNotEqualTo(first);
        assertThat(third).isNotEqualTo(first);
    }

    // ---------------------------------------------------------------- 선택 (요구 3)

    @Test
    @DisplayName("PATCH /me 로 소속 섬을 메인으로 고르고, 소속 안 한 섬은 403 MEMBER_ONLY 다")
    void patchChoosesOwnIslandAndRejectsForeignOne() {
        Actor user = actor();
        UUID mine = island(user, "내섬");
        UUID other = joined(user, island(actor(), "남의섬이지만가입함"));
        UUID foreign = island(actor(), "가입안한섬");

        var changed = account.patch(user.id(), patch(other), user.session(), 0L, UUID.randomUUID());
        assertThat(changed.mainIslandId()).isEqualTo(other);
        assertThat(mainIslandOf(user)).isEqualTo(other);

        for (UUID rejected : List.of(foreign, UUID.randomUUID())) {
            assertThatThrownBy(() -> account.patch(user.id(), patch(rejected), user.session(), 0L,
                    UUID.randomUUID()))
                    .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        }
        // 거절된 요청은 아무것도 바꾸지 않는다.
        assertThat(mainIslandOf(user)).isEqualTo(other);
        assertThat(mine).isNotEqualTo(other);
    }

    @Test
    @DisplayName("메인 섬을 바꿔도 «지금 접속한 섬»(current_island_id)은 건드리지 않는다 — 다른 축이다")
    void choosingMainIslandLeavesCurrentIslandAlone() {
        Actor user = actor();
        UUID first = island(user, "처음");
        UUID latest = joined(user, island(actor(), "나중"));
        // 가입은 현재 섬을 옮긴다 — 가장 나중에 들어간 섬이 현재 섬이다.
        assertThat(currentIslandOf(user)).isEqualTo(latest);

        account.patch(user.id(), patch(first), user.session(), 0L, UUID.randomUUID());

        assertThat(mainIslandOf(user)).isEqualTo(first);
        assertThat(currentIslandOf(user)).isEqualTo(latest);
    }

    // ---------------------------------------------------------------- 이전 (요구 5)

    @Test
    @DisplayName("메인 섬에서 이탈하면 가장 최근 가입 섬으로 옮겨지고 알림 봉투가 같은 트랜잭션에 적힌다")
    void leavingTheMainIslandMovesToTheMostRecentlyJoinedOneAndNotifies() {
        Actor user = actor();
        UUID first = island(user, "첫섬");
        joined(user, island(actor(), "둘째섬"));
        UUID latest = joined(user, island(actor(), "셋째섬"));
        assertThat(mainIslandOf(user)).isEqualTo(first);

        management.leave(user.id(), first, UUID.randomUUID());

        // 도출 규칙(«가장 먼저»)이 아니라 이전 규칙(«가장 최근»)이 적용된다 — 둘째섬이 아니라 셋째섬이다.
        assertThat(mainIslandOf(user)).isEqualTo(latest);
        assertThat(transferNotices(user)).containsExactly(latest.toString());
    }

    @Test
    @DisplayName("메인 섬이 아닌 섬에서 이탈하면 메인 섬도 알림도 그대로다")
    void leavingANonMainIslandChangesNothing() {
        Actor user = actor();
        UUID first = island(user, "첫섬");
        UUID other = joined(user, island(actor(), "둘째섬"));

        management.leave(user.id(), other, UUID.randomUUID());

        assertThat(mainIslandOf(user)).isEqualTo(first);
        assertThat(transferNotices(user)).isEmpty();
    }

    @Test
    @DisplayName("마지막 섬에서 이탈하면 메인 섬이 없고, 유효하지 않은 섬을 대신 돌려주지 않는다")
    void losingTheLastMembershipLeavesNoMainIsland() {
        Actor user = actor();
        UUID only = island(user, "하나뿐인섬");
        // 남이 하나 더 있는 섬을 만들어도 그것이 대신 지정되면 안 된다.
        island(actor(), "남의섬");

        management.leave(user.id(), only, UUID.randomUUID());

        assertThat(mainIslandOf(user)).isNull();
        assertThat(chosenRows(user)).isZero();
        assertThat(transferNotices(user)).isEmpty();
    }

    @Test
    @DisplayName("강퇴 경로에서도 메인 섬이 옮겨진다 — 공통 훅 하나가 이탈과 강퇴를 함께 덮는다")
    void kickAlsoMovesTheMainIsland() {
        Actor host = actor();
        Actor user = actor();
        UUID first = joined(user, island(host, "방장섬"));
        UUID latest = joined(user, island(actor(), "나중섬"));
        assertThat(mainIslandOf(user)).isEqualTo(first);

        management.kick(host.id(), first, user.id(), UUID.randomUUID());

        assertThat(mainIslandOf(user)).isEqualTo(latest);
        assertThat(transferNotices(user)).containsExactly(latest.toString());
    }

    @Test
    @DisplayName("레거시 이탈(GroupMemberService.withdrawGroup)에서도 메인 섬이 옮겨진다")
    void legacyWithdrawGroupAlsoMovesTheMainIsland() {
        Actor user = actor();
        UUID first = joined(user, island(actor(), "레거시첫섬"));
        UUID latest = joined(user, island(actor(), "레거시나중섬"));

        members.withdrawGroup(first, user.id());

        assertThat(mainIslandOf(user)).isEqualTo(latest);
        assertThat(transferNotices(user)).containsExactly(latest.toString());
    }

    @Test
    @DisplayName("계정 탈퇴는 고른 메인 섬 행까지 지우고, 중간 이전의 알림을 내보내지 않는다")
    void accountWithdrawalErasesTheRowWithoutNotifying() {
        Actor user = actor();
        UUID first = joined(user, island(actor(), "탈퇴첫섬"));
        joined(user, island(actor(), "탈퇴나중섬"));
        // 명시 선택을 박아 두어 탈퇴가 «행»을 지우는지까지 본다.
        account.patch(user.id(), patch(first), user.session(), 0L, UUID.randomUUID());
        assertThat(chosenRows(user)).isEqualTo(1);

        withdrawal.withdraw(user.id());

        assertThat(chosenRows(user)).isZero();
        // 탈퇴 트랜잭션은 멤버십을 여러 번 끝낸다 — 중간에 한 번 옮겨졌더라도 최종 상태가 «없음»이라
        // 알림은 만들어지지 않아야 한다.
        assertThat(transferNotices(user)).isEmpty();
    }

    // ---------------------------------------------------------------- 친구 목록 (요구 6)

    @Test
    @DisplayName("친구 목록은 상대의 메인 섬 «이름»을 싣고, 소속 없는 친구는 null 이다")
    void friendListCarriesTheCounterpartMainIslandName() {
        Actor me = actor();
        Actor settled = actor();
        Actor drifter = actor();
        island(settled, "정착섬");
        UUID leaving = island(drifter, "떠날섬");
        management.leave(drifter.id(), leaving, UUID.randomUUID());
        befriend(me, settled);
        befriend(me, drifter);

        List<FriendResponse> list = friends.getFriends(me.id(), LocalDate.now());

        assertThat(list).hasSize(2);
        assertThat(list).filteredOn(f -> f.getUserId().equals(settled.id()))
                .singleElement()
                .extracting(FriendResponse::getMainIslandName).isEqualTo("정착섬");
        assertThat(list).filteredOn(f -> f.getUserId().equals(drifter.id()))
                .singleElement()
                .extracting(FriendResponse::getMainIslandName).isNull();
    }

    // ---------------------------------------------------------------- GET /me

    @Test
    @DisplayName("GET /me 가 메인 섬 식별자를 싣는다 — 소속이 없으면 null 이다")
    void accountProjectionCarriesTheMainIslandId() {
        Actor user = actor();
        assertThat(account.me(user.id(), user.session(), 0L).mainIslandId()).isNull();

        UUID island = island(user, "생긴섬");

        assertThat(account.me(user.id(), user.session(), 0L).mainIslandId()).isEqualTo(island);
    }

    // ---------------------------------------------------------------- 도구

    private record Actor(UUID id, UUID session) {
    }

    private Actor actor() {
        var login = auth.guestLogin();
        return new Actor(jwt.extractUserId(login.accessToken()), login.sessionId());
    }

    /** 생산 생성 경로 — 만든 사람이 방장으로 «첫 가입» 된다. */
    private UUID island(Actor owner, String name) {
        return islands.create(owner.id(), new CreateIslandCommandRequest(name, null, false),
                UUID.randomUUID()).id();
    }

    /** 생산 가입 경로(승인 없는 섬이라 즉시 가입이다). */
    private UUID joined(Actor user, UUID islandId) {
        joins.join(user.id(), islandId, null, UUID.randomUUID());
        return islandId;
    }

    private void befriend(Actor me, Actor other) {
        UUID request = friends.createRequest(me.id(), other.id());
        friends.acceptRequest(other.id(), request);
    }

    private static AccountPatchRequest patch(UUID mainIslandId) {
        return new AccountPatchRequest(null, null, mainIslandId);
    }

    private UUID mainIslandOf(Actor user) {
        return account.me(user.id(), user.session(), 0L).mainIslandId();
    }

    private UUID currentIslandOf(Actor user) {
        return jdbc.queryForObject("select current_island_id from user_island_contexts where user_id=?",
                UUID.class, user.id());
    }

    private long chosenRows(Actor user) {
        return jdbc.queryForObject("select count(*) from user_main_islands where user_id=?",
                Long.class, user.id());
    }

    /** 이 사람 앞으로 적힌 메인 섬 이전 알림 봉투의 대상 섬들 — 없으면 빈 목록이다. */
    private List<String> transferNotices(Actor user) {
        return jdbc.queryForList("select params->>'islandId' from event_outbox"
                        + " where user_id=? and type='notification.requested' and params->>'kind'=?"
                        + " order by id", String.class, user.id(), KIND);
    }
}
