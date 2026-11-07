package com.oneorthree.phone.internal;

import com.oneorthree.phone.focus.exception.FocusException;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.internal.service.IslandJoinService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.WebIslandEntryService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 로컬 PostgreSQL에서 정원 경계·멱등·최초 동시 배정을 검증한다. 외부 서버를 호출하지 않는다. */
@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class WebIslandEntryIntegrationTest {
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.callers.business.token", () -> "test-web-island-business");
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/web-island");
    }

    @Autowired WebIslandEntryService web;
    @Autowired IslandMembershipService islands;
    @Autowired IslandJoinService joins;
    @Autowired UserRepository users;
    @Autowired GroupRepository groups;
    @Autowired GroupMemberRepository members;
    @Autowired FocusSessionRepository sessions;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;

    @Test
    @Order(1)
    void sameIslandBeyondFifteenAndNormalCapacityStillApplies() throws Exception {
        assertThat(jdbc.queryForObject("select island_id from web_island_pools where id = 'main'",
                UUID.class)).isNull();
        User first = guest();
        User second = guest();
        var executor = Executors.newFixedThreadPool(2);
        UUID islandId;
        try {
            var a = executor.submit(() -> web.enter(first.getId(), UUID.randomUUID()));
            var b = executor.submit(() -> web.enter(second.getId(), UUID.randomUUID()));
            islandId = a.get(20, TimeUnit.SECONDS).id();
            assertThat(b.get(20, TimeUnit.SECONDS).id()).isEqualTo(islandId);
        } finally {
            executor.shutdownNow();
        }
        for (int index = 0; index < 14; index++) {
            assertThat(web.enter(guest().getId(), UUID.randomUUID()).id()).isEqualTo(islandId);
        }
        assertThat(jdbc.queryForObject("select count(*) from islands where web_lobby", Long.class)).isEqualTo(1);
        var island = groups.findById(islandId).orElseThrow();
        assertThat(island.isPrivate()).isTrue();
        assertThat(members.findByGroup(island)).hasSizeGreaterThan(15);
        assertThat(members.findAnyByUserAndGroup(first, island).orElseThrow().getRole())
                .isEqualTo(GroupMemberRole.MEMBER);
        assertThat(jdbc.queryForObject("select count(*) from island_facilities where island_id = ?",
                Long.class, islandId)).isEqualTo(7);

        UUID key = UUID.randomUUID();
        var receipt = web.enter(first.getId(), key);
        long before = members.findByGroup(island).size();
        assertThat(web.enter(first.getId(), key)).isEqualTo(receipt);
        assertThat(web.enter(first.getId(), UUID.randomUUID()).id()).isEqualTo(islandId);
        assertThat(members.findByGroup(island)).hasSize((int) before);

        User host = guest();
        var ordinary = islands.create(host.getId(), new CreateIslandCommandRequest("일반섬", "", false, 1),
                UUID.randomUUID());
        assertThatThrownBy(() -> joins.join(guest().getId(), ordinary.id(), new JoinIslandCommandRequest(null),
                UUID.randomUUID())).isInstanceOf(GroupException.class).hasMessageContaining("정원");
        var kicked = members.findAnyByUserAndGroup(first, island).orElseThrow();
        kicked.kick(Instant.now());
        members.save(kicked);
        assertThatThrownBy(() -> web.enter(first.getId(), UUID.randomUUID()))
                .isInstanceOf(GroupException.class);
        assertThatThrownBy(() -> web.enter(first.getId(), key)).isInstanceOf(GroupException.class);
    }

    @Test
    void profileAndLiveFocusArePreserved() {
        User incomplete = users.save(User.builder().isGuest(true).build());
        assertThatThrownBy(() -> web.enter(incomplete.getId(), UUID.randomUUID()))
                .isInstanceOf(GroupException.class).hasMessageContaining("고양이");
        User user = guest();
        var ordinary = islands.create(user.getId(), new CreateIslandCommandRequest("내섬", "", false, 15),
                UUID.randomUUID());
        var active = sessions.save(FocusSession.builder().user(user).startedAt(Instant.now()).build());
        assertThatThrownBy(() -> web.enter(user.getId(), UUID.randomUUID())).isInstanceOf(FocusException.class);
        assertThat(sessions.findById(active.getId()).orElseThrow().getEndedAt()).isNull();
        assertThat(jdbc.queryForObject("select current_island_id from user_island_contexts where user_id = ?",
                UUID.class, user.getId())).isEqualTo(ordinary.id());
        sessions.deleteById(active.getId());
        UUID webId = web.enter(user.getId(), UUID.randomUUID()).id();
        assertThat(members.findAnyByUserAndGroup(user, groups.findById(ordinary.id()).orElseThrow())
                .orElseThrow().isLeft()).isFalse();
        var webFocus = sessions.save(FocusSession.builder().user(user).startedAt(Instant.now()).build());
        assertThat(web.enter(user.getId(), UUID.randomUUID()).id()).isEqualTo(webId);
        assertThat(sessions.findById(webFocus.getId()).orElseThrow().getEndedAt()).isNull();
    }

    @Test
    void internalEntryBindsPathToAuthenticatedCaller() throws Exception {
        User user = guest();
        String path = "/internal/users/" + user.getId() + "/web-island";
        mvc.perform(post(path).header("Authorization", "Bearer test-web-island-business")
                        .header("X-User-Id", user.getId().toString())
                        .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.role").value("member"));
        mvc.perform(post(path).header("Authorization", "Bearer test-web-island-business")
                        .header("X-User-Id", UUID.randomUUID().toString())
                        .header("Idempotency-Key", UUID.randomUUID().toString()))
                .andExpect(status().isForbidden());
    }

    private User guest() {
        return users.save(User.builder().isGuest(true).catColor("cream")
                .nickname(UUID.randomUUID().toString().substring(0, 10)).build());
    }
}
