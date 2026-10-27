package com.oneorthree.phone.internal;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IslandArrivalView;
import com.oneorthree.phone.internal.dto.IslandLeftView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandResultView;
import com.oneorthree.phone.internal.dto.LetterItemView;
import com.oneorthree.phone.internal.dto.LetterView;
import com.oneorthree.phone.internal.dto.MyIslandsView;
import com.oneorthree.phone.internal.service.InternalLetterService;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.letter.exception.LetterErrorCode;
import com.oneorthree.phone.letter.repository.domain.LetterKind;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.withdrawal.service.AccountWithdrawalService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 소속 섬 3개 상한·도착 상태·나가기/강퇴 다음 위치·시스템 편지 (GROMO-2260, 섬 외부 계약 §1)를 <b>실제 Flyway
 * PostgreSQL</b> 위에서 생산 진입점으로 검증한다. 시드는 생산 서비스와 엔티티로만 만든다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandArrivalIntegrationTest {

    private static final String TOKEN = "test-island-arrival-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"POST /internal/users/*/islands/*/memberships", "PUT /internal/users/*/current-island",
            "POST /internal/users/*/islands/*/arrivals", "DELETE /internal/islands/*/members/*",
            "DELETE /internal/users/*/islands/*/membership", "GET /internal/users/*/letters"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @Autowired
    IslandMembershipService islands;
    @Autowired
    IslandJoinService joins;
    @Autowired
    IslandManagementService management;
    @Autowired
    InternalLetterService letters;
    @Autowired
    AccountWithdrawalService withdrawal;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserQueryService users;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- 상한 3

    @Test
    @DisplayName("소속 3개면 4번째 즉시 가입·승인제 신청·섬 만들기가 전부 409 GROUP_LIMIT_EXCEEDED 다")
    void fourthMembershipIsRejectedOnEveryPath() throws Exception {
        UUID loaded = newUser();
        for (int i = 0; i < 3; i++) {
            joinAs(loaded, island("상한섬" + i, false, false), GroupMemberRole.MEMBER);
        }
        UUID open = island("네번째섬", false, false);
        mvc.perform(post("/internal/users/" + loaded + "/islands/" + open + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", loaded)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_LIMIT_EXCEEDED"))
                .andExpect(jsonPath("$.message").value("소속 섬이 가득 찼어요 (3/3). 섬을 하나 나가면 새로 가입할 수 있어요"));

        UUID approval = island("승인섬", false, true);
        assertThatThrownBy(() -> joins.join(loaded, approval, null, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        assertThatThrownBy(() -> islands.create(loaded,
                new CreateIslandCommandRequest("만들섬", null, false, null), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GROUP_LIMIT_EXCEEDED);

        assertThat(count("select count(*) from group_members where user_id=? and is_left=false", loaded))
                .isEqualTo(3);
        assertThat(count("select count(*) from island_join_requests where applicant_id=?", loaded))
                .as("가득 찬 사람의 신청은 방장에게 가지 않는다").isZero();
    }

    // ---------------------------------------------------------------- 망원경 가입 · 도착

    @Test
    @DisplayName("망원경 가입은 옮기지 않고 도착도 남기지 않는다 — 도착 전 즉시 이동은 403, 도착 뒤엔 된다")
    void telescopeJoinNeedsAnArrivalBeforeInstantMove() throws Exception {
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("본섬", null, false, null),
                UUID.randomUUID()).id();
        UUID target = island("망원경섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);

        mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"origin\":\"telescope\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.currentIslandId").value(home.toString()));
        assertThat(currentIsland(user)).as("망원경 가입은 옮기지 않는다").isEqualTo(home);
        assertThat(arrived(user, target)).isFalse();
        assertThat(arrivedBefore(islands.myIslands(user), target)).isFalse();
        assertThat(arrivedBefore(islands.myIslands(user), home)).as("만든 섬은 처음부터 가 본 섬").isTrue();

        mvc.perform(put("/internal/users/" + user + "/current-island")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"islandId\":\"" + target + "\"}"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ISLAND_NOT_ARRIVED"));
        assertThat(currentIsland(user)).isEqualTo(home);

        UUID arrivalKey = UUID.randomUUID();
        for (int i = 0; i < 2; i++) {
            // 같은 키의 두 번째 도착은 처음 결과의 재생이다 — 주민 첫 도착이라 둘 다 arrivedBefore=false(GROMO-2302).
            mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/arrivals")
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                            .header("Idempotency-Key", arrivalKey))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.islandId").value(target.toString()))
                    .andExpect(jsonPath("$.arrivedBefore").value(false))
                    .andExpect(jsonPath("$.membershipStatus").value("active"))
                    .andExpect(jsonPath("$.currentIslandId").value(target.toString()));
        }
        assertThat(currentIsland(user)).isEqualTo(target);
        assertThat(arrivedBefore(islands.myIslands(user), target)).isTrue();
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, target))
                .isEqualTo(1);
        // 가 본 섬끼리는 즉시 이동이 된다.
        assertThat(islands.switchCurrentIsland(user, home, UUID.randomUUID()).currentIslandId()).isEqualTo(home);

        mvc.perform(post("/internal/users/" + user + "/islands/" + island("엉뚱섬", false, false) + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID())
                        .contentType("application/json").content("{\"origin\":\"boat\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("도착은 명령 키가 필수이고, 늦게 온 같은 키 재시도는 다른 섬으로 간 사람을 되돌리지 않는다")
    void arrivalReplayNeverMovesBack() throws Exception {
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("집섬", null, false, null),
                UUID.randomUUID()).id();
        UUID target = island("목적섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());

        mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user))
                .andExpect(status().isBadRequest());
        assertThat(arrived(user, target)).as("키 없는 도착은 아무것도 남기지 않는다").isFalse();

        UUID key = UUID.randomUUID();
        IslandArrivalView first = islands.arrive(user, target, key);
        assertThat(currentIsland(user)).isEqualTo(target);
        Timestamp arrivedAt = lastArrivedAt(user, target);
        islands.switchCurrentIsland(user, home, UUID.randomUUID());

        assertThat(islands.arrive(user, target, key)).as("처음 결과의 재생").isEqualTo(first);
        assertThat(currentIsland(user)).as("지난 목적지로 되돌리지 않는다").isEqualTo(home);
        assertThat(lastArrivedAt(user, target)).as("재생은 도착을 다시 찍지 않는다").isEqualTo(arrivedAt);
    }

    @Test
    @DisplayName("소속 2개인 사람의 동시 참여 둘은 상한 3을 넘지 못한다 — 한쪽만 성공, 다른 쪽은 409")
    void concurrentJoinsRespectTheCap() throws Exception {
        UUID user = newUser();
        joinAs(user, island("하나섬", false, false), GroupMemberRole.MEMBER);
        joinAs(user, island("둘섬", false, false), GroupMemberRole.MEMBER);
        UUID left = island("왼섬", false, false);
        UUID right = island("오른섬", false, false);

        List<Throwable> failures = race(
                () -> {
                    joins.join(user, left, null, UUID.randomUUID());
                    return null;
                },
                () -> {
                    joins.join(user, right, null, UUID.randomUUID());
                    return null;
                });

        assertThat(failures).hasSize(1);
        assertThat(failures.get(0)).hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GROUP_LIMIT_EXCEEDED);
        assertThat(count("select count(*) from group_members where user_id=? and is_left=false", user))
                .isEqualTo(3);
    }

    @Test
    @DisplayName("방문 중 즉시 가입(기본 origin)은 옮기고 도착을 남긴다")
    void visitJoinMovesAndRecordsArrival() {
        UUID user = newUser();
        UUID target = island("방문섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);

        assertThat(joins.join(user, target, new JoinIslandCommandRequest(null, "visit"), UUID.randomUUID())
                .currentIslandId()).isEqualTo(target);
        assertThat(currentIsland(user)).isEqualTo(target);
        assertThat(arrived(user, target)).isTrue();
    }

    @Test
    @DisplayName("비주민 도착은 기록만 남기고 현재 섬을 바꾸지 않는다 — 비공개 섬은 404 로 숨긴다")
    void visitorArrivalOnlyRecords() throws Exception {
        UUID visitor = newUser();
        UUID open = island("구경섬", false, false);
        mvc.perform(post("/internal/users/" + visitor + "/islands/" + open + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipStatus").value("none"))
                .andExpect(jsonPath("$.currentIslandId").value(nullValue()));
        assertThat(arrived(visitor, open)).isTrue();
        assertThat(currentIsland(visitor)).isNull();

        UUID hidden = island("숨은섬", true, false);
        mvc.perform(post("/internal/users/" + visitor + "/islands/" + hidden + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        assertThat(arrived(visitor, hidden)).isFalse();
    }

    // ---------------------------------------------------------------- 나가기 · 강퇴 다음 위치

    @Test
    @DisplayName("나가기의 nextLocation 은 남은 소속 중 최근 머문 섬이고 컨텍스트와 같다 — 가 본 섬이 없으면 null")
    void leaveReportsTheMostRecentlyVisitedRemainingIsland() throws Exception {
        UUID user = newUser();
        UUID first = islands.create(user, new CreateIslandCommandRequest("첫섬", null, false, null),
                UUID.randomUUID()).id();
        UUID second = island("둘째섬", false, false);
        joinAs(newUser(), second, GroupMemberRole.OWNER);
        joins.join(user, second, null, UUID.randomUUID());
        UUID scoped = island("망원섬", false, false);
        joinAs(newUser(), scoped, GroupMemberRole.OWNER);
        // 가장 최근 «가입» 은 망원섬이지만 가 본 적이 없다 — 종전 메인 섬 규칙이면 여기로 갔다.
        joins.join(user, scoped, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        islands.switchCurrentIsland(user, first, UUID.randomUUID());

        mvc.perform(delete("/internal/users/" + user + "/islands/" + first + "/membership")
                        .param("include", "nextLocation")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.left").value(true))
                .andExpect(jsonPath("$.nextLocation.islandId").value(second.toString()));
        assertThat(currentIsland(user)).isEqualTo(second);

        IslandLeftView last = management.leave(user, second, UUID.randomUUID());
        assertThat(last.nextLocation().islandId()).as("남은 망원섬은 가 본 적 없어 먼바다").isNull();
        assertThat(currentIsland(user)).isNull();
        assertThat(islands.myIslands(user).lossReason()).isEqualTo(GroupLeaveReason.LEFT);
    }

    @Test
    @DisplayName("include 없는 나가기는 GROMO-2260 이전 바이트({\"left\":true})다 — 구 Business 호환, 잘못된 include 는 400")
    void leaveWithoutIncludeKeepsTheLegacyBytes() throws Exception {
        UUID user = newUser();
        islands.create(user, new CreateIslandCommandRequest("남는섬", null, false, null), UUID.randomUUID());
        UUID other = island("떠날섬", false, false);
        joinAs(newUser(), other, GroupMemberRole.OWNER);
        joins.join(user, other, null, UUID.randomUUID());

        mvc.perform(delete("/internal/users/" + user + "/islands/" + other + "/membership")
                        .param("include", "everything")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                other, user)).as("거절된 요청은 나가지 않는다").isEqualTo(1);

        mvc.perform(delete("/internal/users/" + user + "/islands/" + other + "/membership")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"left\":true}"));
    }

    @Test
    @DisplayName("자동 복구로 옮긴 섬은 다시 머문 섬이다 — 그 뒤의 복구가 오래된 도착 기록의 섬을 고르지 않는다")
    void recoveryMoveRefreshesTheArrival() {
        UUID user = newUser();
        UUID a = islands.create(user, new CreateIslandCommandRequest("에이섬", null, false, null),
                UUID.randomUUID()).id();
        UUID b = island("비섬", false, false);
        joinAs(newUser(), b, GroupMemberRole.OWNER);
        UUID c = island("씨섬", false, false);
        joinAs(newUser(), c, GroupMemberRole.OWNER);
        joins.join(user, b, null, UUID.randomUUID());
        joins.join(user, c, null, UUID.randomUUID());

        // C 를 나가면 남은 A·B 중 최근 머문 B 로 복구된다 — 그 복구가 B 의 도착 시각을 새로 찍어야 한다.
        management.leave(user, c, UUID.randomUUID());
        assertThat(currentIsland(user)).isEqualTo(b);
        // C 에 망원경으로 다시 가입한다 — 도착 기록은 예전(B 보다 나중) 그대로 남는다.
        joins.join(user, c, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        islands.switchCurrentIsland(user, a, UUID.randomUUID());

        // A 를 나가면 «최근 머문» 섬은 복구로 다시 머문 B 다. 복구가 도착을 안 찍으면 C 가 뽑힌다.
        assertThat(management.leave(user, a, UUID.randomUUID()).nextLocation().islandId()).isEqualTo(b);
        assertThat(currentIsland(user)).isEqualTo(b);
    }

    @Test
    @DisplayName("마지막 주민이 나가 섬이 purge 되면 그 섬의 도착 기록(주민·방문자)이 함께 사라진다")
    void purgingAnIslandRemovesItsArrivals() {
        UUID host = newUser();
        UUID islandId = islands.create(host, new CreateIslandCommandRequest("닫힐섬", null, false, null),
                UUID.randomUUID()).id();
        UUID visitor = newUser();
        islands.arrive(visitor, islandId, UUID.randomUUID());
        UUID other = islands.create(visitor, new CreateIslandCommandRequest("남을섬", null, false, null),
                UUID.randomUUID()).id();
        assertThat(count("select count(*) from island_arrivals where island_id=?", islandId)).isEqualTo(2);

        management.leave(host, islandId, UUID.randomUUID());

        assertThat(count("select count(*) from islands where id=? and deleted_at is not null", islandId))
                .as("삭제 묘비 — 하드 삭제가 아니라 CASCADE 가 돌지 않는다").isEqualTo(1);
        assertThat(count("select count(*) from island_arrivals where island_id=?", islandId)).isZero();
        assertThat(arrived(visitor, other)).as("다른 섬의 기록은 그대로").isTrue();
    }

    @Test
    @DisplayName("계정 탈퇴는 그 사람의 도착 기록만 지운다 — 같은 섬의 다른 사람 기록은 남는다")
    void withdrawalErasesOnlyTheWithdrawnUsersArrivals() {
        UUID host = newUser();
        UUID islandId = island("탈퇴섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID leaving = newUser();
        joins.join(leaving, islandId, null, UUID.randomUUID());
        UUID visited = island("들른섬", false, false);
        islands.arrive(leaving, visited, UUID.randomUUID());
        UUID staying = newUser();
        islands.arrive(staying, islandId, UUID.randomUUID());
        assertThat(count("select count(*) from island_arrivals where user_id=?", leaving)).isEqualTo(2);

        withdrawal.withdraw(leaving);

        assertThat(count("select count(*) from island_arrivals where user_id=?", leaving)).isZero();
        assertThat(arrived(staying, islandId)).as("다른 사람의 같은 섬 기록").isTrue();
    }

    @Test
    @DisplayName("현재 섬이 아닌 섬을 나가면 컨텍스트는 그대로고 nextLocation 은 현재 섬이다")
    void leavingAnotherIslandKeepsTheCurrentOne() {
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("머무는섬", null, false, null),
                UUID.randomUUID()).id();
        UUID other = island("곁섬", false, false);
        joinAs(newUser(), other, GroupMemberRole.OWNER);
        joins.join(user, other, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());

        assertThat(management.leave(user, other, UUID.randomUUID()).nextLocation().islandId()).isEqualTo(home);
        assertThat(currentIsland(user)).isEqualTo(home);
    }

    @Test
    @DisplayName("강퇴 — 응답은 {removed:true} 뿐(방장에게 대상의 위치를 주지 않는다), 강퇴 편지 1건, 남은 섬이 있어도 먼바다, "
            + "같은 섬 재가입은 승인 대기")
    void kickSendsALetterAndRejoinGoesPending() throws Exception {
        UUID host = newUser();
        UUID islandId = island("강퇴섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID target = newUser();
        UUID home = islands.create(target, new CreateIslandCommandRequest("대상집", null, false, null),
                UUID.randomUUID()).id();
        joins.join(target, islandId, null, UUID.randomUUID());
        assertThat(currentIsland(target)).isEqualTo(islandId);

        UUID key = UUID.randomUUID();
        for (int i = 0; i < 2; i++) {
            // 같은 키 재생은 원 응답을 돌려주고 편지를 다시 만들지 않는다. 응답은 방장이 받으므로 대상의 다음
            // 위치를 싣지 않는다 — GROMO-2260 이전과 같은 바이트다.
            mvc.perform(delete("/internal/islands/" + islandId + "/members/" + target)
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", host)
                            .header("Idempotency-Key", key))
                    .andExpect(status().isOk())
                    .andExpect(content().string("{\"removed\":true}"));
        }
        // 남은 소속(대상집)이 있어도 강퇴는 먼바다다(GROMO-2315) — 자진 이탈이었으면 대상집으로 옮겨졌다.
        assertThat(currentIsland(target)).as("강퇴는 남은 섬으로 옮기지 않는다").isNull();
        assertThat(islands.myIslands(target).lossReason()).isEqualTo(GroupLeaveReason.KICKED);
        assertThat(islands.myIslands(target).items()).extracting(IslandSummaryView::id).containsExactly(home);

        List<Map<String, Object>> rows = jdbc.queryForList(
                "select sender_id, kind, island_id, content from letters where receiver_id=?", target);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0))
                .containsEntry("sender_id", null)
                .containsEntry("kind", "KICK")
                .containsEntry("island_id", islandId)
                .containsEntry("content", "강퇴섬섬에서 더 이상 함께할 수 없게 되었어요");

        // 기존 친구 편지함에는 나가지 않는다 — 발신자 id 를 필수로 다루는 구 앱이 null 발신자를 받지 않는다.
        assertThat(letters.list(target, null, null, null, null).content()).isEmpty();
        // 시스템 편지함은 kind=system 으로 명시할 때만 열린다. 안 읽은 편지는 readAt 키가 없다.
        String letterId = jsonPathOf(mvc.perform(get("/internal/users/" + target + "/letters")
                        .param("kind", "system")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", target))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].counterpartUserId").value(nullValue()))
                .andExpect(jsonPath("$.content[0].kind").value("KICK"))
                .andExpect(jsonPath("$.content[0].islandId").value(islandId.toString()))
                .andExpect(jsonPath("$.content[0].isRead").value(false))
                .andExpect(jsonPath("$.content[0].readAt").doesNotExist())
                .andReturn().getResponse().getContentAsString(), "$.content[0].id");
        LetterView detail = letters.detail(target, UUID.fromString(letterId));
        assertThat(detail.senderId()).isNull();
        assertThat(detail.kind()).isEqualTo(LetterKind.KICK);
        assertThat(detail.islandId()).isEqualTo(islandId);
        assertThat(detail.readAt()).as("수신자의 첫 열람은 읽음을 박는다").isNotNull();
        LetterItemView read = letters.list(target, null, "system", null, null).content().get(0);
        assertThat(read.isRead()).isTrue();
        assertThat(read.readAt()).isEqualTo(detail.readAt());

        // 누구나 가입 섬이어도 강퇴자는 승인 대기다(GROMO-2315) — 종전 403 KICKED_CANNOT_REJOIN.
        mvc.perform(post("/internal/users/" + target + "/islands/" + islandId + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", target)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("pending"))
                .andExpect(jsonPath("$.requestId").isNotEmpty());
        assertThat(count("select count(*) from group_members where group_id=? and user_id=? and is_left=true"
                + " and left_reason='KICKED'", islandId, target)).as("승인 전에는 강퇴 행 그대로").isEqualTo(1);
    }

    @Test
    @DisplayName("마지막 섬에서 강퇴돼 우체통이 없어도 강퇴 편지는 시스템 편지함으로 읽고 닫는다 — 친구 편지함 게이트는 그대로")
    void kickedFromTheLastIslandStillReadsTheKickLetter() {
        UUID host = newUser();
        UUID islandId = island("마지막섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID target = newUser();
        joins.join(target, islandId, null, UUID.randomUUID());

        management.kick(host, islandId, target, UUID.randomUUID());
        assertThat(currentIsland(target)).as("남은 섬이 없어 먼바다").isNull();

        assertThatThrownBy(() -> letters.list(target, null, null, null, null))
                .hasFieldOrPropertyWithValue("errorCode", LetterErrorCode.LETTER_MAILBOX_LOCKED);
        List<LetterItemView> system = letters.list(target, null, "system", null, null).content();
        assertThat(system).hasSize(1);
        UUID letterId = system.get(0).id();
        assertThat(letters.detail(target, letterId).kind()).isEqualTo(LetterKind.KICK);
        // 남의 시스템 편지는 친구 편지와 같은 판정을 받는다 — 방장은 참여자가 아니다.
        assertThatThrownBy(() -> letters.detail(host, letterId))
                .hasFieldOrPropertyWithValue("errorCode", LetterErrorCode.NOT_LETTER_PARTICIPANT);

        letters.close(target, letterId);
        assertThat(letters.list(target, null, "system", null, null).content()).isEmpty();

        assertThatThrownBy(() -> letters.list(target, null, "spam", null, null))
                .hasFieldOrPropertyWithValue("errorCode", LetterErrorCode.INVALID_MAILBOX_TYPE);
        assertThatThrownBy(() -> letters.list(target, "sent", "system", null, null))
                .hasFieldOrPropertyWithValue("errorCode", LetterErrorCode.INVALID_MAILBOX_TYPE);
    }

    // ---------------------------------------------------------------- 가입 멱등 지문

    @Test
    @DisplayName("기본 가입의 멱등 지문은 GROMO-2260 이전과 같다 — 같은 키·origin 생략/visit 은 재생, telescope 는 충돌")
    void defaultJoinKeepsTheLegacyFingerprint() {
        UUID user = newUser();
        UUID islandId = island("지문섬", false, false);
        joinAs(newUser(), islandId, GroupMemberRole.OWNER);
        UUID key = UUID.randomUUID();

        JoinIslandResultView first = joins.join(user, islandId, null, key);

        // 배포 전 코드가 남긴 지문 — 의미 요청이 {invitationToken:null} 하나였다.
        ObjectNode legacy = JsonNodeFactory.instance.objectNode().putNull("invitationToken");
        PublicCommandRequest before = new PublicCommandRequest(user,
                "POST:/islands/" + islandId + "/memberships:" + user, key, legacy);
        assertThat(jdbc.queryForObject("select request_fingerprint from command_idempotency where idempotency_key=?",
                String.class, before.storageRequest().storageKey())).isEqualTo(before.fingerprint());

        long events = count("select count(*) from event_outbox where subject_id=?", islandId.toString());
        assertThat(joins.join(user, islandId, new JoinIslandCommandRequest(null, "visit"), key)).isEqualTo(first);
        assertThat(joins.join(user, islandId, new JoinIslandCommandRequest(null, null), key)).isEqualTo(first);
        assertThat(count("select count(*) from event_outbox where subject_id=?", islandId.toString()))
                .as("재생은 사건을 다시 만들지 않는다").isEqualTo(events);
        assertThatThrownBy(() -> joins.join(user, islandId, new JoinIslandCommandRequest(null, "telescope"), key))
                .hasFieldOrPropertyWithValue("errorCode", OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
    }

    // ---------------------------------------------------------------- 승인 편지

    @Test
    @DisplayName("가입 승인은 항해 시간이 적힌 JOIN_APPROVED 편지를 남기고, 승인된 섬은 아직 가 본 섬이 아니다")
    void approvalSendsALetterWithSailingTime() {
        UUID host = newUser();
        UUID islandId = island("승인섬", false, true);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID applicant = newUser();
        UUID request = joins.join(applicant, islandId, null, UUID.randomUUID()).requestId();

        joins.answer(host, islandId, request, true, UUID.randomUUID());

        List<Map<String, Object>> rows = jdbc.queryForList(
                "select sender_id, kind, island_id, content from letters where receiver_id=?", applicant);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0))
                .containsEntry("sender_id", null)
                .containsEntry("kind", "JOIN_APPROVED")
                .containsEntry("island_id", islandId);
        assertThat((String) rows.get(0).get("content")).matches(
                "승인섬섬 가입이 승인됐어요\\. 망원경에서 출발해 보세요 — 지금 출발하면 (30|60|90)분 뒤 도착해요");
        assertThat(arrivedBefore(islands.myIslands(applicant), islandId)).isFalse();
    }

    // ---------------------------------------------------------------- 주민 첫 도착 사건 (GROMO-2302)

    @Test
    @DisplayName("망원경 가입 뒤 첫 도착은 사건 1건·arrivedBefore=false, 같은 키 재생은 추가 0건, 두 번째 도착은 0건·true")
    void firstMemberArrivalPublishesOnce() throws Exception {
        UUID user = newUser();
        jdbc.update("update users set nickname=?, cat_color='ginger' where id=?", "도착냥" + user, user);
        UUID target = island("소식섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());

        UUID key = UUID.randomUUID();
        String body = mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", key))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.arrivedBefore").value(false))
                .andReturn().getResponse().getContentAsString();
        assertThat(arrivalEvents(target)).isEqualTo(1);
        Map<String, Object> row = jdbc.queryForMap("select o.user_id, o.aggregate_type, o.aggregate_id, "
                + "o.params->>'islandId' as island, o.params->>'userId' as arriver, o.params->>'name' as name, "
                + "o.params->>'catColor' as color, o.params->>'arrivedAt' as at, d.target, d.endpoint_key "
                + "from event_outbox o join event_outbox_deliveries d on d.outbox_id=o.id "
                + "where o.type='island.member.arrived' and o.subject_id=?", target.toString());
        assertThat(row)
                .containsEntry("user_id", user)
                .containsEntry("aggregate_type", "ISLAND_ARRIVAL")
                .containsEntry("aggregate_id", target.toString())
                .containsEntry("island", target.toString())
                .containsEntry("arriver", user.toString())
                .containsEntry("name", "도착냥" + user)
                .containsEntry("color", "ginger")
                .containsEntry("target", "REALTIME")
                .containsEntry("endpoint_key", "island.member.arrived");
        assertThat((String) row.get("at")).isNotBlank();

        mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user)
                        .header("Idempotency-Key", key))
                .andExpect(status().isOk())
                .andExpect(content().json(body));
        assertThat(arrivalEvents(target)).as("재생은 work 를 다시 돌리지 않는다").isEqualTo(1);

        assertThat(islands.arrive(user, target, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(arrivalEvents(target)).as("두 번째 도착").isEqualTo(1);
    }

    @Test
    @DisplayName("방문자 도착은 사건이 없고, 방문자로 먼저 왔던 사람도 주민이 된 뒤 첫 도착엔 사건 1건이다")
    void visitorArrivalIsSilentUntilTheFirstMemberArrival() {
        UUID user = newUser();
        UUID target = island("구경뒤가입섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);

        IslandArrivalView visit = islands.arrive(user, target, UUID.randomUUID());
        assertThat(visit.membershipStatus()).isEqualTo("none");
        assertThat(visit.arrivedBefore()).as("방문자는 언제나 true").isTrue();
        assertThat(arrivalEvents(target)).isZero();

        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        assertThat(islands.arrive(user, target, UUID.randomUUID()).arrivedBefore()).isFalse();
        assertThat(arrivalEvents(target)).isEqualTo(1);
    }

    @Test
    @DisplayName("나갔다 다시 가입하면 «현 가입 이후» 첫 도착이 다시 사건 1건이다 — 가입 즉시 옮겨진 도착은 소식이 아니다")
    void rejoinMakesTheNextArrivalFirstAgain() {
        UUID user = newUser();
        UUID home = islands.create(user, new CreateIslandCommandRequest("재가입본섬", null, false, null),
                UUID.randomUUID()).id();
        UUID target = island("재가입섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        islands.arrive(user, target, UUID.randomUUID());
        assertThat(arrivalEvents(target)).isEqualTo(1);

        management.leave(user, target, UUID.randomUUID());
        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        assertThat(currentIsland(user)).isEqualTo(home);
        assertThat(islands.arrive(user, target, UUID.randomUUID()).arrivedBefore()).isFalse();
        assertThat(arrivalEvents(target)).isEqualTo(2);

        // 방문 중 가입(즉시 옮김)은 그 자리에서 주민 도착을 남긴다 — 다음 도착은 첫 도착이 아니다.
        management.leave(user, target, UUID.randomUUID());
        joins.join(user, target, new JoinIslandCommandRequest(null, "visit"), UUID.randomUUID());
        islands.switchCurrentIsland(user, home, UUID.randomUUID());
        assertThat(islands.arrive(user, target, UUID.randomUUID()).arrivedBefore()).isTrue();
        assertThat(arrivalEvents(target)).isEqualTo(2);
    }

    @Test
    @DisplayName("탈퇴하면 그 사람의 도착 사건 봉투·전달 행에서 이름·털색이 지워지고(키는 남고 null), 남의 봉투는 그대로다")
    void withdrawalErasesTheArrivalNameCopies() {
        UUID target = island("파기섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        UUID leaver = newUser();
        UUID bystander = newUser();
        for (UUID user : List.of(leaver, bystander)) {
            jdbc.update("update users set nickname=?, cat_color='gray' where id=?", "파기냥" + user, user);
            joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
            islands.arrive(user, target, UUID.randomUUID());
        }

        withdrawal.withdraw(leaver);

        for (String field : List.of("name", "catColor")) {
            assertThat(count("select count(*) from event_outbox where type='island.member.arrived' and user_id=? "
                    + "and jsonb_exists(params, ?) and params->>? is null", leaver, field, field))
                    .as("봉투 params.%s", field).isEqualTo(1);
            assertThat(count("select count(*) from event_outbox_deliveries d join event_outbox o on o.id=d.outbox_id "
                    + "where o.type='island.member.arrived' and o.user_id=? "
                    + "and jsonb_exists(d.payload->'params', ?) and d.payload->'params'->>? is null",
                    leaver, field, field)).as("전달 행 payload.params.%s", field).isEqualTo(1);
        }
        assertThat(count("select count(*) from event_outbox where type='island.member.arrived' and user_id=? "
                + "and params->>'name'=? and params->>'catColor'='gray'", bystander, "파기냥" + bystander))
                .isEqualTo(1);
    }

    // ---------------------------------------------------------------- 첫 도착 동시 경합 (GROMO-2333)

    @Test
    @DisplayName("같은 사람의 같은 섬 동시 도착 둘은 사건 1건·도착 행 1개 — arrivedBefore=false 는 정확히 한 응답이다")
    void concurrentArrivalsOfTheSameMemberPublishOnce() throws Exception {
        UUID user = newUser();
        UUID target = island("동시도착섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());

        List<IslandArrivalView> views = raceArrivals(List.of(user, user), target);

        assertThat(views).hasSize(2);
        assertThat(views.stream().filter(view -> !view.arrivedBefore())).as("첫 도착 응답").hasSize(1);
        assertThat(views.stream().filter(IslandArrivalView::arrivedBefore)).as("나머지는 이미 가 본 섬").hasSize(1);
        assertThat(arrivalEvents(target)).isEqualTo(1);
        assertThat(count("select count(*) from island_arrivals where user_id=? and island_id=?", user, target))
                .isEqualTo(1);
        assertThat(currentIsland(user)).isEqualTo(target);
    }

    @Test
    @DisplayName("서로 다른 두 주민의 같은 섬 동시 첫 도착은 사건 각 1건이고 aggregate_version 이 겹치지 않는다")
    void concurrentFirstArrivalsOfTwoMembersGetDistinctVersions() throws Exception {
        UUID target = island("동시첫도착섬", false, false);
        joinAs(newUser(), target, GroupMemberRole.OWNER);
        UUID a = newUser();
        UUID b = newUser();
        for (UUID user : List.of(a, b)) {
            joins.join(user, target, new JoinIslandCommandRequest(null, "telescope"), UUID.randomUUID());
        }

        List<IslandArrivalView> views = raceArrivals(List.of(a, b), target);

        assertThat(views).allSatisfy(view -> assertThat(view.arrivedBefore()).isFalse());
        assertThat(arrivalEvents(target)).isEqualTo(2);
        assertThat(jdbc.queryForList("select user_id from event_outbox where type='island.member.arrived' "
                + "and subject_id=?", UUID.class, target.toString())).containsExactlyInAnyOrder(a, b);
        List<Long> versions = jdbc.queryForList("select d.aggregate_version from event_outbox_deliveries d "
                + "join event_outbox o on o.id=d.outbox_id where o.type='island.member.arrived' "
                + "and d.aggregate_type='ISLAND_ARRIVAL' and d.aggregate_id=?",
                Long.class, target.toString());
        assertThat(versions).hasSize(2).doesNotHaveDuplicates();
    }

    // ---------------------------------------------------------------- 도구

    /**
     * 사람마다 새 키로 같은 섬 도착을 동시에 출발시키고 응답을 모은다 — 예외는 그대로 던져 테스트를 실패시킨다.
     * 작업자가 전부 게이트에 도달한 것을 {@code ready} 로 확인한 뒤 출발시킨다 — 러너가 느려 한 작업자가 먼저 끝나면
     * 순차 요청이 되어 경합 회귀를 못 잡는다(codex 리뷰).
     */
    private List<IslandArrivalView> raceArrivals(List<UUID> arrivers, UUID islandId) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(arrivers.size());
        CountDownLatch ready = new CountDownLatch(arrivers.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<IslandArrivalView>> futures = new ArrayList<>();
            for (UUID arriver : arrivers) {
                futures.add(pool.submit(() -> {
                    ready.countDown();
                    start.await();
                    return islands.arrive(arriver, islandId, UUID.randomUUID());
                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).as("작업자 전원 게이트 도달").isTrue();
            start.countDown();
            List<IslandArrivalView> views = new ArrayList<>();
            for (Future<IslandArrivalView> future : futures) {
                views.add(future.get(30, TimeUnit.SECONDS));
            }
            return views;
        } finally {
            pool.shutdownNow();
        }
    }

    /** 두 명령을 동시에 출발시키고 실패만 모은다 — {@code IslandManagementIntegrationTest.race} 와 같은 도구다. */
    private List<Throwable> race(Callable<?> first, Callable<?> second) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Callable<?> task : List.of(first, second)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            List<Throwable> failures = new ArrayList<>();
            for (Future<?> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
            return failures;
        } finally {
            pool.shutdownNow();
        }
    }

    private static String jsonPathOf(String json, String path) {
        return JsonPath.read(json, path);
    }

    private static boolean arrivedBefore(MyIslandsView view, UUID islandId) {
        return view.items().stream().filter(item -> item.id().equals(islandId))
                .map(IslandSummaryView::arrivedBefore).findFirst().orElseThrow();
    }

    private Timestamp lastArrivedAt(UUID userId, UUID islandId) {
        return jdbc.queryForObject("select last_arrived_at from island_arrivals where user_id=? and island_id=?",
                Timestamp.class, userId, islandId);
    }

    private boolean arrived(UUID userId, UUID islandId) {
        return count("select count(*) from island_arrivals where user_id=? and island_id=?", userId, islandId) == 1;
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
    }

    private UUID island(String name, boolean isPrivate, boolean approvalRequired) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(10)
                .isPrivate(isPrivate).approvalRequired(approvalRequired)
                .status(GroupStatus.WAITING).build()).getId();
    }

    private void joinAs(UUID userId, UUID islandId, GroupMemberRole role) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(role).build());
    }

    private UUID currentIsland(UUID userId) {
        List<UUID> rows = jdbc.queryForList(
                "select current_island_id from user_island_contexts where user_id=?", UUID.class, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private long arrivalEvents(UUID islandId) {
        return count("select count(*) from event_outbox where type='island.member.arrived' and subject_id=?",
                islandId.toString());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
