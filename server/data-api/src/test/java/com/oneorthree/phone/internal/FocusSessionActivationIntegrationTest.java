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
import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.internal.scheduler.FocusRewardScheduler;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
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
    FocusRewardScheduler rewardTicks;
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
        assertThat(count("select count(*) from event_outbox where type in ('focus.member.updated','rest.member.updated')"
                + " and params->>'sessionId'=? and subject_id is distinct from ?", started.id().toString(),
                island.toString())).as("REALTIME 앱 사건의 subjectId 는 전달 범위인 섬이다(outbox 규약 §2.9)").isZero();
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

    @ParameterizedTest(name = "{0} 로 끝난 세션")
    @ValueSource(strings = {"MEMBERSHIP_LOST", "ABANDONED"})
    @DisplayName("이미 적립받은 뒤 강퇴·포기로 끝난 세션의 구간도 구 앱 업로드로 다시 적립되지 않는다")
    void alreadyPaidSessionsBlockTheLegacyUploadEvenAfterAForcedEnd(String ending) {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("기지급섬", null, false),
                UUID.randomUUID()).id();
        UUID user = newUser();
        joinAndMoveTo(user, island);
        FocusSessionView session = focusedSince(user, island, pastUtcMidnight().plusSeconds(7200), 300);
        tick();
        assertThat(islandBalance(island)).as("강제 종료 «전» 에 이미 5마리를 받았다").isEqualTo(5);
        endAs(ending, host, user, island, session.id());

        Instant block = pastUtcMidnight().plusSeconds(7200);
        FocusSessionSaveResponse uploaded = legacyFocus.saveFocusSession(user,
                new FocusSessionRequest(null, block, block.plusSeconds(300), 0));

        assertThat(uploaded.awardedCoins()).as("같은 시간이 코인으로 한 번 더 들어가면 안 된다").isZero();
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?",
                user)).as("일별 통계도 다시 늘지 않는다").isZero();
        assertThat(count("select count(*) from focus_sessions where user_id=? and status='COMPLETED' "
                + "and started_at=?", user, ts(block))).as("완료 마커도 만들지 않는다").isZero();
    }

    @ParameterizedTest(name = "{0} 로 끝난 세션")
    @ValueSource(strings = {"MEMBERSHIP_LOST", "ABANDONED"})
    @DisplayName("한 마리도 못 받고 끝난 세션은 종전대로 — 겹치는 구 앱 업로드가 그대로 적립된다(막은 게 아니라 좁혔다)")
    void sessionsThatWereNeverPaidStillLetTheLegacyUploadThrough(String ending) {
        UUID host = newUser();
        UUID island = islands.create(host, new CreateIslandCommandRequest("무적립섬", null, false),
                UUID.randomUUID()).id();
        UUID user = newUser();
        joinAndMoveTo(user, island);
        // 59초 — 1마리가 안 차서 틱이 아무것도 주지 않는다.
        FocusSessionView session = focusedSince(user, island, pastUtcMidnight().plusSeconds(7200), 59);
        tick();
        assertThat(islandBalance(island)).as("받은 적이 없다").isZero();
        endAs(ending, host, user, island, session.id());

        Instant block = pastUtcMidnight().plusSeconds(7200);
        FocusSessionSaveResponse uploaded = legacyFocus.saveFocusSession(user,
                new FocusSessionRequest(null, block, block.plusSeconds(1800), 0));

        assertThat(uploaded.awardedCoins())
                .as("그 시간은 아직 아무 데서도 적립되지 않았다 — 종전 동작 그대로 적립한다").isPositive();
        assertThat(count("select count(*) from focus_sessions where user_id=? and status='COMPLETED' "
                + "and started_at=?", user, ts(block))).isEqualTo(1);
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

    // ---------------------------------------------------------------- #6 보상 적립(분당) · 종료 정산

    @Test
    @DisplayName("적립 틱이 60초당 1마리를 섬 통장에 넣고, finish 는 추가 지급 없이 그 합을 확정한다")
    void ticksAccrueEveryMinuteAndFinishAddsNothing() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("적립섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 125 * 60 + 30);   // 순수 집중 125분 30초 → 125마리(자투리 30초는 안 준다)

        tick();

        assertThat(islandBalance(island)).as("적립은 finish 가 아니라 틱이 한다").isEqualTo(125);
        assertThat(count("select coalesce(sum(earned_fish),0) from focus_reward_accruals where session_id=?",
                started.id())).isEqualTo(125);
        assertThat(count("select coalesce(sum(balance),0) from user_fish_wallets where user_id=?", user))
                .as("개인 지갑 적립은 없다 — 재화는 섬 하나다(D5-귀속-개정)").isZero();

        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(finished.earnedFish()).as("적립 합을 그대로 옮겨 적는다").isEqualTo(125);
        assertThat(finished.allocation().personalFishAdded()).isZero();
        assertThat(finished.allocation().constructionFishAdded()).as("E=P+C — 전부 섬 통장").isEqualTo(125);
        assertThat(islandBalance(island)).as("종료 시 추가 지급 없음").isEqualTo(125);
        assertThat(finished.goalAchieved()).as("목표 25분 이상").isTrue();
        assertThat(finished.questProgress()).isEmpty();
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?",
                user)).isEqualTo(finished.activeSeconds());
        assertThat(detailRow(started.id()).get("lifecycle")).isEqualTo("COMPLETED");
        assertThat(jdbc.queryForObject("select status from focus_sessions where id=?", String.class,
                started.id())).isEqualTo("COMPLETED");
        assertThat(focus.current(user)).as("완료한 세션은 current 가 아니다").isNull();
    }

    @Test
    @DisplayName("59초는 0 · 60초는 1 · 120초는 2 — 틱은 «찬» 60초만 적립한다")
    void accruesOnlyWholeMinutes() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("분단위섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);

        backdate(started.id(), 59);
        tick();
        assertThat(islandBalance(island)).as("1마리가 아직 안 찼다").isZero();

        backdate(started.id(), 60);
        tick();
        assertThat(islandBalance(island)).isEqualTo(1);

        backdate(started.id(), 120);
        tick();
        assertThat(islandBalance(island)).as("워터마크 덕에 두 번째 분만 새로 준다").isEqualTo(2);
    }

    @Test
    @DisplayName("휴식 동안에는 적립이 멈춘다 — 휴식 구간은 순수 집중 초에 들어가지 않는다")
    void restDoesNotAccrue() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("휴식섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 120);
        tick();
        assertThat(islandBalance(island)).isEqualTo(2);

        FocusSessionView paused = focus.pause(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        tick();
        tick();
        assertThat(islandBalance(island)).as("휴식 중 틱은 아무것도 주지 않는다").isEqualTo(2);

        FocusSessionView resumed = focus.resume(user, paused.id(),
                new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());
        tick();
        assertThat(islandBalance(island)).as("휴식한 시간은 되돌아와도 적립되지 않는다").isEqualTo(2);
        assertThat(resumed.activeSeconds()).as("휴식은 activeSeconds 에 없다").isBetween(120L, 129L);
    }

    @Test
    @DisplayName("틱을 다시 돌리거나 종료와 겹쳐도 총량은 그대로다 — 멱등 키가 (세션, 누적 마리 수)다")
    void retriedTicksAndFinishNeverDoublePay() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("멱등섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 120);

        tick();
        tick();
        tick();

        assertThat(islandBalance(island)).as("같은 틱을 세 번 돌려도 2마리").isEqualTo(2);
        assertThat(count("select count(*) from island_wallet_transactions where island_id=? "
                + "and idempotency_key like ?", island, "focus:" + started.id() + ":%"))
                .as("원장은 «분마다» 한 줄 — 재시도가 줄을 늘리지 않는다").isEqualTo(2);
        assertThat(count("select coalesce(sum(earned_fish),0) from focus_reward_accruals where session_id=?",
                started.id())).as("적립 원장은 (세션, 적립일) 행에 누적한다").isEqualTo(2);

        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        tick();

        assertThat(finished.earnedFish()).isEqualTo(2);
        assertThat(islandBalance(island)).as("종료 뒤 틱은 완료 세션을 건너뛴다").isEqualTo(2);
    }

    @Test
    @DisplayName("하루 상한(480)에 닿으면 물고기만 멈추고 집중 기록은 계속 쌓인다 — 같은 날의 다음 세션도 0마리다")
    void dailyCapStopsFishButNotTheRecord() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("상한섬", null, false),
                UUID.randomUUID()).id();
        // 두 세션을 «같은 UTC 날짜» 안에 고정한다 — backdate 로 8시간을 밀면 실행 시각에 따라 자정을 넘어
        // 이틀로 갈리고, 그러면 상한 두 개를 쓰게 돼 낮에만 빨개지는 테스트가 된다.
        FocusSessionView first = focusedSince(user, island, pastUtcMidnight().plusSeconds(3600), 500 * 60);
        tick();
        FocusFinishView capped = focus.finish(user, first.id(),
                new FocusVersionedCommandRequest(first.version()), UUID.randomUUID());
        FocusSessionView second = focusedSince(user, island, pastUtcMidnight().plusSeconds(11 * 3600), 10 * 60);
        tick();
        FocusFinishView overCap = focus.finish(user, second.id(),
                new FocusVersionedCommandRequest(second.version()), UUID.randomUUID());

        assertThat(capped.earnedFish()).isEqualTo(480);
        assertThat(overCap.earnedFish()).as("같은 날 상한을 채운 뒤의 세션은 0마리다").isZero();
        assertThat(overCap.activeSeconds()).isGreaterThanOrEqualTo(600);
        assertThat(islandBalance(island)).isEqualTo(480);
        assertThat(count("select coalesce(sum(total_focus_seconds),0) from daily_focus_stats where user_id=?",
                user)).isEqualTo(capped.activeSeconds() + overCap.activeSeconds());
        assertThat(count("select rewarded_seconds from focus_session_details where session_id=?", first.id()))
                .as("상한으로 깎인 20분도 «판정 완료» 다 — 다음 날로 이월하지 않는다").isEqualTo(500 * 60L);
    }

    @Test
    @DisplayName("적립일은 그 분이 «찬» 시각의 UTC 날짜다 — 틱이 돈 날이 아니다(자정을 걸친 세션)")
    void theMinuteIsAccruedOnTheDayItCompletedNotTheDayTheTickRan() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("자정섬", null, false),
                UUID.randomUUID()).id();
        // 자정 90초 전에 시작해 2분 — 1분째는 자정 30초 «전» 에 차고, 2분째는 자정 30초 뒤에 찬다.
        Instant midnight = pastUtcMidnight();
        FocusSessionView session = focusedSince(user, island, midnight.minusSeconds(90), 120);

        tick();

        LocalDate before = LocalDate.ofInstant(midnight, ZoneOffset.UTC).minusDays(1);
        LocalDate after = LocalDate.ofInstant(midnight, ZoneOffset.UTC);
        assertThat(accruedFish(session.id(), before))
                .as("자정 30초 전에 찬 분은 «그 전날» 몫이다 — 틱은 한참 뒤에 돌았다").isEqualTo(1);
        assertThat(accruedFish(session.id(), after)).as("자정 뒤에 찬 분만 새 날짜다").isEqualTo(1);
        assertThat(ledgerKeys(island, session.id())).containsExactly(
                "focus:" + session.id() + ":1", "focus:" + session.id() + ":2");
    }

    @Test
    @DisplayName("앞선 날의 상한이 가득이어도 새 날의 첫 분부터는 나간다 — 밀린 분이 하루 상한 하나로 소실되지 않는다")
    void aFullCapOnTheEarlierDayDoesNotEatTheNextDay() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("경계상한섬", null, false),
                UUID.randomUUID()).id();
        Instant midnight = pastUtcMidnight();
        LocalDate before = LocalDate.ofInstant(midnight, ZoneOffset.UTC).minusDays(1);
        LocalDate after = LocalDate.ofInstant(midnight, ZoneOffset.UTC);
        fillDailyCap(user, island, before);

        FocusSessionView session = focusedSince(user, island, midnight.minusSeconds(90), 120);
        long balanceBefore = islandBalance(island);
        tick();

        assertThat(accruedFish(session.id(), before)).as("전날 상한이 가득이라 그 분은 버린다").isZero();
        assertThat(accruedFish(session.id(), after)).as("새 날의 첫 분은 그 날 상한으로 판정한다").isEqualTo(1);
        assertThat(islandBalance(island) - balanceBefore).isEqualTo(1);
        assertThat(ledgerKeys(island, session.id())).containsExactly("focus:" + session.id() + ":2");
    }

    @Test
    @DisplayName("틱이 밀려 한 번에 여러 분을 처리해도 원장은 «분마다» 한 줄이다 — 감사 추적이 남는다")
    void aDelayedTickStillLeavesOneLedgerRowPerMinute() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("지연섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView session = focusedSince(user, island, pastUtcMidnight().plusSeconds(7200), 300);

        tick();

        assertThat(islandBalance(island)).isEqualTo(5);
        assertThat(ledgerKeys(island, session.id())).containsExactly(
                "focus:" + session.id() + ":1", "focus:" + session.id() + ":2",
                "focus:" + session.id() + ":3", "focus:" + session.id() + ":4",
                "focus:" + session.id() + ":5");
        assertThat(count("select count(*) from island_wallet_transactions where island_id=? and amount<>1",
                island)).as("한 줄은 언제나 1마리 — 금액 N 짜리로 접지 않는다").isZero();
    }

    @Test
    @DisplayName("완료한 세션을 새 키로 다시 finish 하면 원 정산을 그대로 돌려주고 두 번 지급하지 않는다")
    void finishingACompletedSessionAgainReplaysTheSettlement() {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("재생섬", null, false),
                UUID.randomUUID()).id();
        FocusSessionView started = start(user, island);
        backdate(started.id(), 30 * 60);
        tick();
        FocusFinishView first = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        FocusFinishView again = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());

        assertThat(again).isEqualTo(first);
        assertThat(islandBalance(island))
                .as("재생은 섬 통장에 두 번 넣지 않는다").isEqualTo(first.allocation().constructionFishAdded());
        assertThat(count("select coalesce(sum(balance),0) from user_fish_wallets where user_id=?", user)).isZero();
        assertThat(count("select count(*) from focus_settlements where session_id=?", started.id())).isEqualTo(1);
    }

    @Test
    @DisplayName("목표 시간이 없어도 시작된다 — 보상은 목표가 아니라 순수 집중 시간에 걸린다")
    void startsWithoutATargetTime() throws Exception {
        UUID user = newUser();
        UUID island = islands.create(user, new CreateIslandCommandRequest("무목표섬", null, false),
                UUID.randomUUID()).id();

        FocusSessionView started = focus.start(user,
                new FocusSessionStartCommandRequest(island, "알고리즘", null), UUID.randomUUID());
        assertThat(started.targetMinutes()).isNull();
        assertThat(detailRow(started.id()).get("target_minutes")).isNull();

        backdate(started.id(), 60);
        tick();
        FocusFinishView finished = focus.finish(user, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        assertThat(finished.earnedFish()).as("목표가 없어도 시간만큼 적립된다").isEqualTo(1);
        assertThat(finished.goalAchieved()).as("목표가 없으면 달성도 없다").isFalse();
        assertThat(finished.targetMinutes()).isNull();

        // 내부 표면(Business 가 부르는 그 경로)도 목표 없는 본문을 받는다.
        UUID other = newUser();
        joinAndMoveTo(other, island);
        call(post("/internal/users/" + other + "/focus-sessions"), other,
                "{\"islandId\":\"" + island + "\",\"subject\":\"알고리즘\"}")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.targetMinutes").doesNotExist());
    }

    @Test
    @DisplayName("적립은 «매분» 도는 운영 크론이 굴린다 — 배선이 없으면 아무도 적립하지 않는다")
    void theAccrualCronRunsEveryMinuteOnTheSettlementPool() throws Exception {
        Scheduled cron = FocusRewardScheduler.class.getDeclaredMethod("accrueDueSessions")
                .getAnnotation(Scheduled.class);

        assertThat(cron).as("@Scheduled 가 없으면 이 테스트가 부르는 진입점은 운영에서 영영 안 돈다").isNotNull();
        assertThat(cron.cron()).as("「60초마다 1마리」의 그 60초").isEqualTo("0 * * * * *");
        assertThat(cron.zone()).isEqualTo("UTC");
        assertThat(cron.scheduler()).as("돈 처리는 알림 팬아웃에 밀리면 안 된다")
                .isEqualTo(SchedulingConfig.SETTLEMENT_SCHEDULER);
    }

    // ---------------------------------------------------------------- 도구

    /**
     * 시계에 기대지 않는 「이미 오래 집중한」 세션 — 첫 ACTIVE 구간을 고정 시각 쌍 {@code [from, from+seconds)}
     * 으로 옮기고, 진행 중 구간은 방금 열린 것만 남긴다(기여 ~0초).
     *
     * <p>{@link #backdate}와 달리 <b>각 분이 «찬» 시각이 고정</b>이라, 자정 경계·하루 상한처럼 날짜로 갈리는
     * 판정을 언제 돌려도 같은 결과가 나온다 — backdate 로 몇 시간을 밀면 실행 시각에 따라 UTC 자정을 넘어
     * 이틀로 갈려서 특정 시간대에만 빨개진다.
     *
     * @return resume 직후의 상태(다음 finish 에 쓸 version 이 들어 있다)
     */
    FocusSessionView focusedSince(UUID userId, UUID islandId, Instant from, long seconds) {
        FocusSessionView started = start(userId, islandId);
        FocusSessionView paused = focus.pause(userId, started.id(),
                new FocusVersionedCommandRequest(started.version()), UUID.randomUUID());
        FocusSessionView resumed = focus.resume(userId, paused.id(),
                new FocusVersionedCommandRequest(paused.version()), UUID.randomUUID());
        jdbc.update("update focus_session_intervals set started_at=?, ended_at=? "
                        + "where session_id=? and ordinal=1",
                ts(from), ts(from.plusSeconds(seconds)), started.id());
        return resumed;
    }

    /**
     * 정산 없이 끝나는 두 경로 — 강퇴(FR-D03)와 기본 마커 외부 종료(레거시 start 가 닫은 뒤의 정리).
     * 둘 다 {@code finish} 를 거치지 않아 정산 행이 없다.
     */
    void endAs(String ending, UUID host, UUID user, UUID islandId, UUID sessionId) {
        if ("MEMBERSHIP_LOST".equals(ending)) {
            groupMembers.kickMember(islandId, user, host);
        } else {
            // 레거시 start 가 하는 일 그대로 — 기본 마커를 바깥에서 닫으면 다음 current 가 ABANDONED 로 내린다.
            jdbc.update("update focus_sessions set ended_at=? where id=?", ts(Instant.now()), sessionId);
            focus.current(user);
        }
        assertThat(detailRow(sessionId).get("lifecycle")).isEqualTo(ending);
    }

    /** 지난 UTC 자정 — 어제 00:00Z 다. 언제 돌려도 과거라 경계 픽스처가 미래로 새지 않는다. */
    static Instant pastUtcMidnight() {
        return LocalDate.now(ZoneOffset.UTC).minusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
    }

    /** 그 날짜의 상한을 이미 채워 둔다 — 끝난 세션의 적립 원장 행으로 심는다(합산 축이 상세의 주인·섬이다). */
    void fillDailyCap(UUID userId, UUID islandId, LocalDate day) {
        FocusSessionView spent = start(userId, islandId);
        focus.finish(userId, spent.id(), new FocusVersionedCommandRequest(spent.version()), UUID.randomUUID());
        jdbc.update("insert into focus_reward_accruals (id, session_id, accrued_on, earned_fish) "
                + "values (?, ?, ?, 480)", UUID.randomUUID(), spent.id(), java.sql.Date.valueOf(day));
    }

    long accruedFish(UUID sessionId, LocalDate day) {
        return count("select coalesce(sum(earned_fish),0) from focus_reward_accruals "
                + "where session_id=? and accrued_on=?", sessionId, java.sql.Date.valueOf(day));
    }

    List<String> ledgerKeys(UUID islandId, UUID sessionId) {
        return jdbc.queryForList("select idempotency_key from island_wallet_transactions "
                        + "where island_id=? and idempotency_key like ? order by created_at, id",
                String.class, islandId, "focus:" + sessionId + ":%");
    }

    /** 운영 크론과 «같은» 진입점으로 적립 틱을 한 번 돌린다 — 스캔·잠금·멱등을 전부 통과시킨다. */

    void tick() {
        rewardTicks.accrueDueSessions();
    }

    long islandBalance(UUID islandId) {
        return count("select coalesce(sum(balance),0) from island_wallets where island_id=?", islandId);
    }

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
