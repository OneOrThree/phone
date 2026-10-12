package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
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

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 방명록의 <b>기본 시설 게이트</b> 검증 (GROMO-2262) — {@code construction.facility-gates.enforce} 를 건드리지
 * 않은 배포 그대로다. 이 상태에서 {@code hasBoard} 는 어느 섬에도 true 라서, 응답 {@code boardBuilt} 를 그 값으로
 * 채우면 게시판 없는 섬도 true 가 되어 섬 상세의 {@code buildings} 와 모순된다. {@code boardBuilt} 는 게이트가 아니라
 * <b>실제 COMPLETED 시설</b>을 말해야 하고, 쓰기 게이트는 종전대로 플래그를 따른다
 * ({@code IslandNoticeGateDefaultsTest} 와 같은 이유로 별도 클래스다 — 플래그는 컨텍스트 단위다).
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandGuestbookGateDefaultsTest {

    private static final String TOKEN = "test-island-guestbook-gate-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*/guestbook");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/islands/*/guestbook");
    }

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

    @Test
    @DisplayName("게이트가 꺼져 있어도 boardBuilt 는 실제 완공 여부다 — 없거나 공사 중이면 false, 완공이면 true")
    void boardBuiltReportsActualCompletionWithGatesOff() throws Exception {
        UUID owner = newMember();
        UUID islandId = island(owner);

        read(owner, islandId).andExpect(status().isOk()).andExpect(jsonPath("$.boardBuilt").value(false));

        jdbc.update("insert into island_facilities (island_id, building_id, status, cost, cost_revision) "
                + "values (?, 'board', 'BUILDING', 0, 1)", islandId);
        read(owner, islandId).andExpect(jsonPath("$.boardBuilt").value(false));

        jdbc.update("update island_facilities set status = 'COMPLETED' where island_id = ? and building_id = 'board'",
                islandId);
        read(owner, islandId).andExpect(jsonPath("$.boardBuilt").value(true));
    }

    @Test
    @DisplayName("쓰기 게이트는 종전대로 플래그를 따른다 — 게이트가 꺼진 기본 배포에서는 게시판 없는 섬에도 쓸 수 있다")
    void writeGateStillFollowsTheFlag() throws Exception {
        UUID owner = newMember();
        UUID islandId = island(owner);

        mvc.perform(post("/internal/islands/" + islandId + "/guestbook")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", newMember())
                        .contentType("application/json").content("{\"content\":\"안녕\"}"))
                .andExpect(status().isCreated());
    }

    private ResultActions read(UUID actor, UUID islandId) throws Exception {
        return mvc.perform(get("/internal/islands/" + islandId + "/guestbook")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private UUID island(UUID owner) {
        Group island = groups.save(Group.builder().name("기본게이트").maxMembers(10).isPrivate(false)
                .status(GroupStatus.WAITING).build());
        members.save(GroupMember.builder().user(users.getCaller(owner)).group(island)
                .role(GroupMemberRole.OWNER).build());
        return island.getId();
    }

    /** 회원 — 게스트로 만든 뒤 {@code is_guest} 만 내린다(방명록 쓰기는 회원 전용). */
    private UUID newMember() {
        UUID id = jwt.extractUserId(auth.guestLogin().accessToken());
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }
}
