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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

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
    @Autowired PlatformTransactionManager transactions;

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

    @Test
    @DisplayName("같은 사람이 두 섬에서 «동시에» 회수돼도 메인 섬은 활성 섬을 가리킨다 — 이전은 사용자 단위로 직렬화된다")
    void concurrentRevocationsNeverPinALeftIsland() throws Exception {
        Actor user = actor();
        UUID first = joined(user, island(actor(), "동시첫섬"));
        UUID middle = joined(user, island(actor(), "동시중간섬"));
        UUID latest = joined(user, island(actor(), "동시나중섬"));
        assertThat(mainIslandOf(user)).isEqualTo(first);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch hooked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try {
            // ① «가장 최근 섬»에서의 회수를 트랜잭션을 연 채로 붙잡아 둔다. 훅은 이미 돌았고 커밋은 아직이다.
            Future<?> holder = pool.submit(() -> new TransactionTemplate(transactions).execute(status -> {
                members.withdrawGroupAndRecord(latest, user.id());
                hooked.countDown();
                await(release);
                return null;
            }));
            assertThat(hooked.await(30, TimeUnit.SECONDS)).isTrue();

            // ② 그 사이 «메인 섬»에서도 회수된다. 직렬화가 없으면 이쪽은 아직 살아 보이는 나중섬을
            //    후보로 골라 박제한다 — 커밋 순서상 그 섬은 이미 떠난 섬이 된다.
            Future<?> mainLeave = pool.submit(() -> {
                members.withdrawGroup(first, user.id());
                return null;
            });

            // 직렬화의 «관측 가능한» 결과다 — ①이 잠금을 쥔 채 멈춰 있으므로 ②는 끝날 수 없다.
            // 시간이 아니라 잠금이 이것을 보장한다(①의 커밋은 아래 release 전까지 일어나지 않는다).
            assertThatThrownBy(() -> mainLeave.get(3, TimeUnit.SECONDS)).isInstanceOf(TimeoutException.class);

            release.countDown();
            holder.get(30, TimeUnit.SECONDS);
            mainLeave.get(30, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }

        // 남은 활성 섬은 중간섬 하나뿐이다 — 떠난 섬이 박제되면 여기서 깨진다.
        assertThat(mainIslandOf(user)).isEqualTo(middle);
        assertThat(activeMembership(user, mainIslandOf(user))).isTrue();
    }

    @Test
    @DisplayName("1분 안에 연속으로 두 번 옮겨져도 알림 봉투가 두 건 남고 마지막이 최종 상태를 가리킨다")
    void backToBackTransfersEachGetTheirOwnNotice() {
        Actor user = actor();
        UUID first = island(user, "연속첫섬");
        UUID middle = joined(user, island(actor(), "연속중간섬"));
        UUID latest = joined(user, island(actor(), "연속나중섬"));

        management.leave(user.id(), first, UUID.randomUUID());
        assertThat(mainIslandOf(user)).isEqualTo(latest);
        management.leave(user.id(), latest, UUID.randomUUID());
        assertThat(mainIslandOf(user)).isEqualTo(middle);

        // 대상 축(섬)이 키에 없으면 같은 분의 둘째 사건이 «중복»으로 버려져, 사용자는 이미 떠난 섬으로
        // 옮겼다는 알림만 받는다. 봉투의 subject_id 로 축이 실제로 실렸는지까지 본다 — 분 경계에 걸려
        // 우연히 두 건이 남는 경우와 구분하기 위해서다.
        assertThat(transferNotices(user)).containsExactly(latest.toString(), middle.toString());
        assertThat(transferSubjects(user)).containsExactly(latest.toString(), middle.toString());
    }

    @Test
    @DisplayName("배포 전 형식(3필드) 영수증을 재생해도 mainIslandId 가 null 로 나오지 않는다")
    void replayingAPreDeployReceiptFillsTheMissingMainIslandId() {
        Actor user = actor();
        UUID island = island(user, "영수증섬");
        UUID key = UUID.randomUUID();
        var body = new AccountPatchRequest("영수증이름", null, null);

        var first = account.patch(user.id(), body, user.session(), 0L, key);
        assertThat(first.mainIslandId()).isEqualTo(island);

        // 배포 «전»에 저장된 영수증은 3필드다 — 그 모양을 그대로 만들어 재생시킨다.
        // 섬 생성도 공개 명령이라 이 사용자의 영수증은 둘이다 — PATCH 쪽(최신)만 옛 형식으로 되돌린다.
        String stored = latestReceiptKey(user);
        assertThat(receipt(stored)).contains("mainIslandId");
        jdbc.update("update command_idempotency set response_body = jsonb_set("
                + "response_body, '{data}', (response_body->'data') - 'mainIslandId') where idempotency_key=?",
                stored);
        // 경로 가정이 틀리면 jsonb_set 이 조용히 원본을 돌려주므로, 지워졌는지를 반드시 확인한다.
        assertThat(receipt(stored)).doesNotContain("mainIslandId");

        var replayed = account.patch(user.id(), body, user.session(), 0L, key);

        // 필드가 «없는» 것과 «null 인» 것은 다르다 — 없으면 현재 값으로 채운다.
        assertThat(replayed.mainIslandId()).isEqualTo(island);
        assertThat(replayed.name()).isEqualTo("영수증이름");
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
        return islands.create(owner.id(), new CreateIslandCommandRequest(name, null, false, null),
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

    /** 저장 키는 {@code public:v1:<해시>} 라 앱 키로 찾을 수 없다 — 가장 최근 영수증이 방금 그 PATCH 다. */
    private String latestReceiptKey(Actor user) {
        return jdbc.queryForObject("select idempotency_key from command_idempotency"
                + " where user_id=? order by created_at desc limit 1", String.class, user.id());
    }

    /** 저장된 멱등 영수증 원문 — 「배포 전 형식」을 실제로 만들었는지 확인하는 데 쓴다. */
    private String receipt(String storedKey) {
        return jdbc.queryForObject("select response_body::text from command_idempotency"
                + " where idempotency_key=?", String.class, storedKey);
    }

    private boolean activeMembership(Actor user, UUID islandId) {
        return jdbc.queryForObject("select count(*) from group_members"
                + " where user_id=? and group_id=? and is_left=false", Long.class, user.id(), islandId) == 1;
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("잠금 해제 신호가 오지 않았다");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    /** 봉투의 «대상 축» — 결정적 사건 키에 섬이 실렸는지 본다. */
    private List<String> transferSubjects(Actor user) {
        return jdbc.queryForList("select subject_id from event_outbox"
                        + " where user_id=? and type='notification.requested' and params->>'kind'=?"
                        + " order by id", String.class, user.id(), KIND);
    }

    /** 이 사람 앞으로 적힌 메인 섬 이전 알림 봉투의 대상 섬들 — 없으면 빈 목록이다. */
    private List<String> transferNotices(Actor user) {
        return jdbc.queryForList("select params->>'islandId' from event_outbox"
                        + " where user_id=? and type='notification.requested' and params->>'kind'=?"
                        + " order by id", String.class, user.id(), KIND);
    }
}
