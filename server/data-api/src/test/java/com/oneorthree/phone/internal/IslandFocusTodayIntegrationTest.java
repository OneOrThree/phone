package com.oneorthree.phone.internal;

import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusIntervalKind;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.repository.domain.FocusType;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 방문 화면의 「오늘 이 섬 집중 분」 내부 표면 (GROMO-2258) — {@code GET /internal/islands/{id}/focus-today}.
 *
 * <p>시각을 고정해 KST 자정 경계를 재현한다: 지금 = 2031-03-10 12:00 KST(03:00Z). UTC 로는 «어제»(3/9)지만
 * KST 로는 오늘인 00:30~00:50 세션이 들어가고, KST 어제 23시 세션은 빠진다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandFocusTodayIntegrationTest {

    private static final String TOKEN = "test-island-focus-today-business";
    private static final Instant NOW = Instant.parse("2031-03-10T03:00:00Z");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*/focus-today");
    }

    @MockitoBean
    Clock clock;

    @Autowired
    MockMvc mvc;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    FocusSessionRepository sessions;
    @Autowired
    FocusSessionDetailRepository details;
    @Autowired
    FocusSessionIntervalRepository intervals;

    @BeforeEach
    void fixClock() {
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZoneOffset.UTC);
    }

    @Test
    @DisplayName("오늘(KST) 완료 + 진행 중 세션의 순수 집중을 분으로 합치고, 어제 세션은 빼며, 비주민 방문자도 200 으로 본다")
    void sumsTodayAcrossCompletedAndProgressingForVisitors() throws Exception {
        User owner = user("방장");
        Group island = groups.save(Group.builder().name("섬").maxMembers(10).build());
        join(owner, island, GroupMemberRole.OWNER);
        User resident = user("주민");
        join(resident, island, GroupMemberRole.MEMBER);
        User visitor = user("방문자");

        // KST 3/10 00:30~00:50 — 완료 20분(UTC 날짜로는 3/9 다).
        session(owner, island, FocusSessionLifecycle.COMPLETED,
                Instant.parse("2031-03-09T15:30:00Z"), Instant.parse("2031-03-09T15:50:00Z"));
        // KST 3/9 23:00~23:30 — 어제라 빠진다.
        session(owner, island, FocusSessionLifecycle.COMPLETED,
                Instant.parse("2031-03-09T14:00:00Z"), Instant.parse("2031-03-09T14:30:00Z"));
        // 11:30 KST 부터 진행 중 — 지금(12:00)까지 30분.
        session(resident, island, FocusSessionLifecycle.ACTIVE, Instant.parse("2031-03-10T02:30:00Z"), null);

        as(visitor.getId(), island.getId())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.islandId").value(island.getId().toString()))
                .andExpect(jsonPath("$.date").value("2031-03-10"))
                .andExpect(jsonPath("$.minutes").value(50));
        as(owner.getId(), island.getId())
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.minutes").value(50));
    }

    @Test
    @DisplayName("없는 섬은 403 MEMBER_ONLY — 방문 개방 뒤에도 섬 존재는 새지 않는다")
    void missingIslandIsMemberOnly() throws Exception {
        as(user("밖").getId(), UUID.randomUUID())
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("MEMBER_ONLY"));
    }

    private ResultActions as(UUID actor, UUID islandId) throws Exception {
        return mvc.perform(get("/internal/islands/" + islandId + "/focus-today")
                .header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.toString()));
    }

    private User user(String name) {
        return users.save(User.builder().nickname(name + "-" + UUID.randomUUID()).build());
    }

    private void join(User user, Group group, GroupMemberRole role) {
        members.save(GroupMember.builder().user(user).group(group).role(role).build());
    }

    private void session(User user, Group island, FocusSessionLifecycle lifecycle, Instant startedAt,
                         Instant endedAt) {
        UUID id = sessions.save(FocusSession.builder().user(user).focusType(FocusType.INFINITE)
                .startedAt(startedAt).endedAt(endedAt).build()).getId();
        details.save(FocusSessionDetail.builder().sessionId(id).userId(user.getId()).islandId(island.getId())
                .membershipEpochAtStart(1L).subject("알고리즘").targetMinutes(25).lifecycle(lifecycle)
                .lastTransitionAt(endedAt != null ? endedAt : startedAt).build());
        intervals.save(FocusSessionInterval.builder().sessionId(id).ordinal(1).kind(FocusIntervalKind.ACTIVE)
                .startedAt(startedAt).endedAt(endedAt).build());
    }
}
