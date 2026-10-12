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

import java.util.List;
import java.util.Map;
import java.util.UUID;

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
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.enabled", () -> true);
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

        for (int i = 0; i < 2; i++) {
            // 멱등 — 두 번째 도착도 같은 결과다.
            mvc.perform(post("/internal/users/" + user + "/islands/" + target + "/arrivals")
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", user))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.islandId").value(target.toString()))
                    .andExpect(jsonPath("$.arrivedBefore").value(true))
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
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.membershipStatus").value("none"))
                .andExpect(jsonPath("$.currentIslandId").value(nullValue()));
        assertThat(arrived(visitor, open)).isTrue();
        assertThat(currentIsland(visitor)).isNull();

        UUID hidden = island("숨은섬", true, false);
        mvc.perform(post("/internal/users/" + visitor + "/islands/" + hidden + "/arrivals")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor))
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
        islands.arrive(visitor, islandId);
        UUID other = islands.create(visitor, new CreateIslandCommandRequest("남을섬", null, false, null),
                UUID.randomUUID()).id();
        assertThat(count("select count(*) from island_arrivals where island_id=?", islandId)).isEqualTo(2);

        management.leave(host, islandId, UUID.randomUUID());

        assertThat(count("select count(*) from groups where id=? and deleted_at is not null", islandId))
                .as("삭제 묘비 — 하드 삭제가 아니라 CASCADE 가 돌지 않는다").isEqualTo(1);
        assertThat(count("select count(*) from island_arrivals where island_id=?", islandId)).isZero();
        assertThat(arrived(visitor, other)).as("다른 섬의 기록은 그대로").isTrue();
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
    @DisplayName("강퇴 — nextLocation 은 대상의 다음 위치, 강퇴 편지 1건(발신자 없음), 같은 섬 재가입은 403")
    void kickSendsALetterAndBlocksRejoin() throws Exception {
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
            // 같은 키 재생은 원 응답을 돌려주고 편지를 다시 만들지 않는다.
            mvc.perform(delete("/internal/islands/" + islandId + "/members/" + target)
                            .param("include", "nextLocation")
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", host)
                            .header("Idempotency-Key", key))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.removed").value(true))
                    .andExpect(jsonPath("$.nextLocation.islandId").value(home.toString()));
        }
        // 같은 키를 구 Business(파라미터 없음)가 재시도해도 충돌 없이 GROMO-2260 이전 바이트로 재생된다.
        mvc.perform(delete("/internal/islands/" + islandId + "/members/" + target)
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", host)
                        .header("Idempotency-Key", key))
                .andExpect(status().isOk())
                .andExpect(content().string("{\"removed\":true}"));
        assertThat(currentIsland(target)).isEqualTo(home);

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

        mvc.perform(post("/internal/users/" + target + "/islands/" + islandId + "/memberships")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", target)
                        .header("Idempotency-Key", UUID.randomUUID()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("KICKED_CANNOT_REJOIN"));
    }

    @Test
    @DisplayName("마지막 섬에서 강퇴돼 우체통이 없어도 강퇴 편지는 시스템 편지함으로 읽고 닫는다 — 친구 편지함 게이트는 그대로")
    void kickedFromTheLastIslandStillReadsTheKickLetter() {
        UUID host = newUser();
        UUID islandId = island("마지막섬", false, false);
        joinAs(host, islandId, GroupMemberRole.OWNER);
        UUID target = newUser();
        joins.join(target, islandId, null, UUID.randomUUID());

        assertThat(management.kick(host, islandId, target, UUID.randomUUID()).nextLocation().islandId())
                .as("남은 섬이 없어 먼바다").isNull();

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

    // ---------------------------------------------------------------- 도구

    private static String jsonPathOf(String json, String path) {
        return JsonPath.read(json, path);
    }

    private static boolean arrivedBefore(MyIslandsView view, UUID islandId) {
        return view.items().stream().filter(item -> item.id().equals(islandId))
                .map(IslandSummaryView::arrivedBefore).findFirst().orElseThrow();
    }

    private boolean arrived(UUID userId, UUID islandId) {
        return count("select count(*) from island_arrivals where user_id=? and island_id=?", userId, islandId) == 1;
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
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

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
