package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.FocusSessionCancelRequest;
import com.oneorthree.phone.focus.dto.FocusSessionRequest;
import com.oneorthree.phone.focus.dto.FocusSessionSaveResponse;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.session.FocusFinishView;
import com.oneorthree.phone.focus.dto.session.FocusSessionStartCommandRequest;
import com.oneorthree.phone.focus.dto.session.FocusSessionView;
import com.oneorthree.phone.focus.dto.session.FocusVersionedCommandRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.focus.service.FocusLiveInfoLookup;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 집중 세션 시작 게이트를 연 뒤의 경로 (GROMO-1924) — <b>실제 Flyway PostgreSQL</b> 위에서 본다.
 *
 * <p>게이트는 {@code focus.session.start-enabled} 로 연다. 잠금·부분 UNIQUE·CHECK·V67 이 전부 DB 에
 * 있는 규칙이라 mock 으로는 의미가 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class FocusSessionActivationIntegrationTest {

    static final String TOKEN = "test-focus-activation-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("focus.session.start-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        List<String> allow = List.of(
                "POST /internal/users/*/focus-sessions",
                "GET /internal/users/*/focus-sessions/current",
                "POST /internal/users/*/focus-sessions/*/pause",
                "POST /internal/users/*/focus-sessions/*/resume",
                "POST /internal/users/*/focus-sessions/*/finish",
                "GET /internal/users/*/focus-summary");
        for (int i = 0; i < allow.size(); i++) {
            String rule = allow.get(i);
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> rule);
        }
    }

    @Autowired
    FocusSessionLifecycleService focus;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    FocusService legacyFocus;
    @Autowired
    LeagueRankingQueryRepository league;
    @Autowired
    FocusLiveInfoLookup liveInfo;
    @Autowired
    GroupMemberService groupMembers;
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

    // ---------------------------------------------------------------- 게이트를 연 뒤의 전체 흐름

    @Test
    @DisplayName("게이트를 열면 내부 표면으로 start 201 → current 200 → pause 200 → resume 200 → finish 200 → summary 200")
    void openedGateRunsTheWholeLifecycleOverTheInternalSurface() throws Exception {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("전체흐름섬", null, false),
                UUID.randomUUID()).id();
        String base = "/internal/users/" + user;

        String started = call(post(base + "/focus-sessions"), user,
                "{\"islandId\":\"" + island + "\",\"subject\":\"알고리즘\",\"targetMinutes\":25}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("active"))
                .andReturn().getResponse().getContentAsString();
        String sessionId = JsonPath.read(started, "$.id");

        call(get(base + "/focus-sessions/current"), user, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session.id").value(sessionId));
        call(post(base + "/focus-sessions/" + sessionId + "/pause"), user, "{\"expectedVersion\":1}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("paused"))
                .andExpect(jsonPath("$.version").value(2));
        call(post(base + "/focus-sessions/" + sessionId + "/resume"), user, "{\"expectedVersion\":2}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.version").value(3));
        call(post(base + "/focus-sessions/" + sessionId + "/finish"), user, "{\"expectedVersion\":3}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordId").value(sessionId))
                .andExpect(jsonPath("$.islandId").value(island.toString()))
                .andExpect(jsonPath("$.earnedFish").isNumber())
                .andExpect(jsonPath("$.questProgress").isEmpty());
        call(get(base + "/focus-summary"), user, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentSessionSecondsToday").value(0));

        assertThat(detailRow(UUID.fromString(sessionId)).get("lifecycle")).isEqualTo("COMPLETED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", UUID.fromString(sessionId)))
                .isEqualTo(1);
    }

    // ---------------------------------------------------------------- #7 소속 상실의 출구

    @Test
    @DisplayName("강퇴는 대상의 휴식 중 세션을 같은 TX 에서 MEMBERSHIP_LOST 로 끝내고 정산하지 않는다(FR-D03)")
    void kickEndsTheProgressingSessionWithoutSettlement() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("강퇴섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);
        FocusSessionView paused = focus.pause(member, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        groupMembers.kickMember(island, member, host);

        Map<String, Object> detail = detailRow(started.id());
        assertThat(detail.get("lifecycle")).isEqualTo("MEMBERSHIP_LOST");
        assertThat(detail.get("rest_seat")).as("휴식 자리를 반납한다").isNull();
        assertThat(((Number) detail.get("version")).longValue()).isEqualTo(paused.version() + 1);
        assertThat(count("select count(*) from focus_session_intervals where session_id=? and ended_at is null",
                started.id())).as("열린 구간이 남지 않는다").isZero();
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class,
                started.id())).as("기본 마커는 통계 제외로 닫힌다 — 미정산").isEqualTo("AUTO_CLOSED");
        assertThat(count("select count(*) from focus_settlements where session_id=?", started.id())).isZero();
        assertThat(count("select count(*) from event_outbox where type='focus.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='completed'", started.id().toString()))
                .as("섬 목록에서 지우는 사건을 남긴다").isEqualTo(1);
    }

    @Test
    @DisplayName("강퇴된 사용자는 옛 세션을 전이할 수 없지만, 다른 섬에서 새 세션을 열 수 있다 — 출구가 있다")
    void kickedUserCanStartAgainElsewhere() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("떠난섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);

        groupMembers.kickMember(island, member, host);

        assertThatThrownBy(() -> focus.pause(member, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.ISLAND_MEMBERSHIP_REQUIRED);
        UUID home = islands.create(member, new CreateIslandCommandRequest("새섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView again = start(member, home);
        assertThat(again.status()).isEqualTo(FocusSessionView.STATUS_ACTIVE);
    }

    @Test
    @DisplayName("자진 탈퇴는 진행 중 세션이 있으면 409 다 — 휴식도 같다(「먼저 끝내고 나가라」)")
    void voluntaryLeaveIsRefusedWhileASessionIsProgressing() {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("못떠나섬", null, false),
                UUID.randomUUID()).id();
        UUID member = newUser();
        joinAndMoveTo(member, island);
        FocusSessionView started = start(member, island);
        focus.pause(member, started.id(), new FocusVersionedCommandRequest(started.version()),
                UUID.randomUUID());

        assertThatThrownBy(() -> groupMembers.withdrawGroup(island, member))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(count("select count(*) from group_members where group_id=? and user_id=? and is_left=false",
                island, member)).as("거절은 멤버십을 바꾸지 않는다").isEqualTo(1);
    }

    // ---------------------------------------------------------------- #9 rest 투영

    @Test
    @DisplayName("start 는 focus 사건과 함께 rest 투영 제거(active·자리 null) 사건을 같은 TX 에 남긴다")
    void startAlsoDurablyClearsTheRestProjection() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("모닥불섬", null, false),
                UUID.randomUUID()).id();

        FocusSessionView started = start(user, island);

        assertThat(count("select count(*) from event_outbox where type='rest.member.updated' "
                + "and params->>'sessionId'=? and params->>'status'='active' "
                + "and params->'restSeat'='null'::jsonb and params->'restStartedAt'='null'::jsonb",
                started.id().toString())).isEqualTo(1);
    }

    // ---------------------------------------------------------------- #2 · #3 레거시 공존

    @Test
    @DisplayName("v0.3 세션이 진행 중이면 레거시 start 는 409 이고, 그 세션의 기본 마커를 닫지 않는다")
    void legacyStartNeitherRotatesNorClosesTheV03Marker() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("공존섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);

        assertThatThrownBy(() -> legacyFocus.startFocusSession(user, new FocusSessionStartRequest(null, null)))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThatThrownBy(() -> legacyFocus.cancelFocusSession(user, new FocusSessionCancelRequest(started.id())))
                .as("v0.3 세션 PK 로 레거시 취소도 못 한다")
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_STATE_CONFLICT);

        assertThat(jdbc.queryForObject("select ended_at is null from focus_sessions where id=?", Boolean.class,
                started.id())).isTrue();
        assertThat(focus.current(user).id()).isEqualTo(started.id());
    }

    @Test
    @DisplayName("구 앱 업로드가 v0.3 서버 구간과 겹치면 적립 없이 성공으로 답하고, 안 겹치는 블록은 그대로 적립한다")
    void legacyUploadOverlappingAServerSessionIsNotCreditedTwice() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("업로드섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        Instant t0 = started.startedAt();

        FocusSessionSaveResponse overlapping = legacyFocus.saveFocusSession(user,
                new FocusSessionRequest(null, t0.minusSeconds(600), t0.plusSeconds(1), 0));
        FocusSessionSaveResponse earlier = legacyFocus.saveFocusSession(user,
                new FocusSessionRequest(null, t0.minusSeconds(7200), t0.minusSeconds(3600), 0));

        assertThat(overlapping.awardedCoins()).as("겹친 블록은 지급하지 않는다").isZero();
        assertThat(count("select count(*) from focus_sessions where user_id=? and status='COMPLETED' "
                + "and started_at=?", user, ts(t0.minusSeconds(600))))
                .as("겹친 블록은 완료 마커로 저장하지 않는다").isZero();
        assertThat(earlier.awardedCoins()).as("겹치지 않는 오프라인 업로드는 유지한다").isPositive();
    }

    // ---------------------------------------------------------------- #4 리그 라이브 랭킹

    @Test
    @DisplayName("리그 라이브 순위는 v0.3 세션의 휴식을 빼고 ACTIVE 구간만 센다 — 휴식 중이면 진행분을 빼 표시와 맞춘다")
    void leagueLiveRankingCountsOnlyActiveIntervals() {
        // 한 주 한가운데(수 12:00 KST)로 기준 시각을 고정한다 — 주 경계 클램프가 끼지 않는다.
        Instant now = Instant.parse("2026-09-16T03:00:00Z");
        LocalDate monday = LocalDate.parse("2026-09-14");
        LocalDate sunday = LocalDate.parse("2026-09-20");
        UUID resting = newUser();
        UUID island = islands.create(resting, new CreateIslandCommandRequest("리그섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView v03 = start(resting, island);
        // 벽시계 60분 = ACTIVE 10분 → REST 40분 → ACTIVE 10분(진행 중). 순수 집중 20분.
        jdbc.update("update focus_sessions set started_at=? where id=?", ts(now.minusSeconds(3600)), v03.id());
        jdbc.update("update focus_session_intervals set started_at=?, ended_at=? where session_id=? and ordinal=1",
                ts(now.minusSeconds(3600)), ts(now.minusSeconds(3000)), v03.id());
        jdbc.update("insert into focus_session_intervals(session_id, ordinal, kind, started_at, ended_at) "
                + "values (?, 2, 'REST', ?, ?), (?, 3, 'ACTIVE', ?, null)", v03.id(),
                ts(now.minusSeconds(3000)), ts(now.minusSeconds(600)), v03.id(), ts(now.minusSeconds(600)));
        // 비교 상대: 30분 전에 시작한 레거시 라이브 마커.
        UUID legacy = newUser();
        legacyFocus.startFocusSession(legacy, new FocusSessionStartRequest(null, null));
        jdbc.update("update focus_sessions set started_at=? where user_id=? and ended_at is null",
                ts(now.minusSeconds(1800)), legacy);
        // 리그 모수는 닉네임이 있는 사용자다(유니크) — 사용자 id 로 겹치지 않게 짓는다.
        jdbc.update("update users set nickname=? where id=?", "휴" + resting, resting);
        jdbc.update("update users set nickname=? where id=?", "구" + legacy, legacy);

        int restingRank = league.findRankOf(resting, monday, sunday, now).orElseThrow().rank();
        int legacyRank = league.findRankOf(legacy, monday, sunday, now).orElseThrow().rank();
        assertThat(legacyRank).as("30분 레거시가 순수 20분 v0.3 보다 앞선다 — 벽시계 60분이 아니다")
                .isLessThan(restingRank);

        jdbc.update("update focus_session_details set lifecycle='PAUSED', rest_seat=1 where session_id=?", v03.id());
        assertThat(league.findTop(monday, sunday, null, 100000, now).stream()
                .filter(row -> row.userId().equals(resting)).findFirst().orElseThrow().liveStartedAt())
                .as("휴식 중이면 라이브 앵커가 없다 — 앱이 매초 더하지 않는다").isNull();
    }

    @Test
    @DisplayName("친구 라이브 표시도 같다 — 휴식 중이면 «집중 중»이 아니고, 집중 중이면 앵커가 휴식을 뺀다")
    void friendLiveInfoFollowsTheSameRule() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("친구섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 3600);
        LocalDate today = LocalDate.now(java.time.ZoneId.of("Asia/Seoul"));

        Instant anchor = liveInfo.liveInfoByUserId(List.of(user), today).get(user).focusStartedAt();
        assertThat(anchor).as("열린 ACTIVE 한 구간뿐이라 앵커는 그 시작과 같다(±몇 초)")
                .isBetween(Instant.now().minusSeconds(3610), Instant.now().minusSeconds(3590));

        focus.pause(user, started.id(), new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        assertThat(liveInfo.liveInfoByUserId(List.of(user), today).get(user))
                .as("휴식 중이면 라이브가 아니다 — 당일 집계도 없어 맵에서 빠진다").isNull();
    }

    // ---------------------------------------------------------------- #6 보상 정산

    @Test
    @DisplayName("finish 는 D5·D5-귀속-개정대로 정산한다 — 60초당 1마리 전부 섬 통장, 개인 지갑 불변, 일 집계는 순수 초")
    void finishSettlesByTheDecidedFormula() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("정산섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 125 * 60 + 30);   // 순수 집중 125분 30초 → 125마리

        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(finished.earnedFish()).isEqualTo(125);
        assertThat(finished.allocation().personalFishAdded()).as("2026-09-19 D5-귀속-개정 — 개인 몫 0").isZero();
        assertThat(finished.allocation().constructionFishAdded()).as("E=P+C — 홀수여도 전부 섬 통장").isEqualTo(125);
        assertThat(finished.goalAchieved()).as("목표 25분 이상").isTrue();
        assertThat(finished.questProgress()).isEmpty();
        assertThat(count("select coalesce(sum(balance),0) from user_fish_wallets where user_id=?", user))
                .as("개인 지갑은 적립하지 않는다").isZero();
        assertThat(count("select balance from island_wallets where island_id=?", island)).isEqualTo(125);
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?",
                user)).isEqualTo(finished.activeSeconds());
        assertThat(detailRow(started.id()).get("lifecycle")).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class,
                started.id())).isEqualTo("COMPLETED");
        assertThat(focus.current(user)).as("완료한 세션은 current 가 아니다").isNull();
    }

    @Test
    @DisplayName("하루 상한(480)에 닿으면 물고기만 멈추고 집중 기록은 계속 쌓인다")
    void dailyCapStopsFishButNotTheRecord() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("상한섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView first = start(user, island);
        backdate(first.id(), 500 * 60);
        FocusFinishView capped = focus.finish(user, first.id(),
                new FocusVersionedCommandRequest(first.version()), UUID.randomUUID());
        FocusSessionView second = start(user, island);
        backdate(second.id(), 10 * 60);
        FocusFinishView overCap = focus.finish(user, second.id(),
                new FocusVersionedCommandRequest(second.version()), UUID.randomUUID());

        assertThat(capped.earnedFish()).isEqualTo(480);
        assertThat(overCap.earnedFish()).isZero();
        assertThat(overCap.activeSeconds()).isGreaterThanOrEqualTo(600);
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?",
                user)).isEqualTo(capped.activeSeconds() + overCap.activeSeconds());
    }

    @Test
    @DisplayName("완료한 세션을 새 키로 다시 finish 하면 원 정산을 그대로 돌려주고 두 번 지급하지 않는다")
    void finishingACompletedSessionAgainReplaysTheSettlement() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("재생섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 30 * 60);
        FocusFinishView first = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        FocusFinishView again = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(again).isEqualTo(first);
        assertThat(count("select balance from island_wallets where island_id=?", island))
                .as("재생은 섬 통장에 두 번 넣지 않는다").isEqualTo(first.allocation().constructionFishAdded());
        assertThat(count("select coalesce(sum(balance),0) from user_fish_wallets where user_id=?", user)).isZero();
        assertThat(count("select count(*) from focus_settlements where session_id=?", started.id())).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    FocusSessionView start(UUID userId, UUID islandId) {
        return focus.start(userId, new FocusSessionStartCommandRequest(islandId, "알고리즘", 25), UUID.randomUUID());
    }

    /** 내부 표면 호출 — Business 가 싣는 인증·주체·멱등 헤더를 그대로 붙인다. */
    ResultActions call(MockHttpServletRequestBuilder request, UUID user, String body) throws Exception {
        request.header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", user.toString())
                .header("Idempotency-Key", UUID.randomUUID().toString());
        if (body != null) {
            request.contentType("application/json").content(body);
        }
        return mvc.perform(request);
    }

    UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 이미 있는 섬에 주민으로 넣고 현재 섬을 옮긴다 — 가입 승인 흐름은 이 테스트의 관심이 아니다. */
    void joinAndMoveTo(UUID userId, UUID islandId) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(GroupMemberRole.MEMBER).build());
        islands.switchCurrentIsland(userId, islandId, UUID.randomUUID());
    }

    /** 방금 시작한 세션을 {@code seconds} 전에 시작한 것으로 옮긴다 — 실제 시계를 기다리지 않고 정산 값을 본다. */
    void backdate(UUID sessionId, long seconds) {
        Timestamp at = ts(Instant.now().minusSeconds(seconds));
        jdbc.update("update focus_sessions set started_at=? where id=?", at, sessionId);
        jdbc.update("update focus_session_details set last_transition_at=? where session_id=?", at, sessionId);
        jdbc.update("update focus_session_intervals set started_at=? where session_id=? and ordinal=1", at,
                sessionId);
    }

    static Timestamp ts(Instant instant) {
        return Timestamp.from(instant);
    }

    Map<String, Object> detailRow(UUID sessionId) {
        return jdbc.queryForMap("select * from focus_session_details where session_id=?", sessionId);
    }

    long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
