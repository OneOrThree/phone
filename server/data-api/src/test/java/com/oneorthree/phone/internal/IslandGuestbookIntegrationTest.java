package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 인사말 · 방명록 (GROMO-2262)을 <b>실제 Flyway PostgreSQL</b> 위에서 생산 진입점(내부 표면)으로 검증한다.
 * 시설 게이트·섬 관리 명령 스위치를 켜고, 시계는 고정한다(KST 하루 경계). 시드는 전부 생산 엔티티·서비스다 —
 * 게시판만 {@code island_facilities} 행으로 «지어진 것» 으로 둔다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandGuestbookIntegrationTest {

    private static final String TOKEN = "test-island-guestbook-business";
    private static final Instant DAY1 = Instant.parse("2026-10-12T05:00:00Z"); // KST 14:00

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"PATCH /internal/islands/*", "GET /internal/islands/*",
            "GET /internal/islands/*/guestbook",
            "POST /internal/islands/*/guestbook", "DELETE /internal/islands/*/guestbook/*"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @MockitoBean
    Clock clock;
    @Autowired
    IslandMembershipService islands;
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

    private final AtomicReference<Instant> now = new AtomicReference<>(DAY1);

    @BeforeEach
    void fixClock() {
        now.set(DAY1);
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
    }

    // ---------------------------------------------------------------- 인사말

    @Test
    @DisplayName("생성 직후 인사말은 합성 기본 문구(greetingIsDefault=true)이고 섬 이름이 바뀌면 따라간다")
    void newIslandGreetingIsSynthesizedDefault() {
        UUID host = newUser();
        UUID islandId = islands.create(host, new CreateIslandCommandRequest("고래", null, false, null),
                UUID.randomUUID()).id();

        IslandSummaryView view = islands.view(islandId, newUser()).visitor();

        assertThat(view.greeting()).isEqualTo("고래섬에 온 걸 환영해요! 같이 집중해요 🐟");
        assertThat(view.greetingIsDefault()).isTrue();
        assertThat(jdbc.queryForObject("select greeting from groups where id=?", String.class, islandId)).isNull();
    }

    @Test
    @DisplayName("섬장은 40 코드포인트(이모지 포함)까지 인사말을 쓰고, 41 은 400, 빈 문자열은 기본 문구로 되돌린다")
    void hostEditsGreetingByCodePoints() throws Exception {
        Island island = island(false);
        String forty = "🐟".repeat(40); // UTF-16 80 단위 — 코드포인트로 센다

        patchGreeting(island.host, island.id, forty).andExpect(status().isOk());
        IslandSummaryView view = islands.view(island.id, newUser()).visitor();
        assertThat(view.greeting()).isEqualTo(forty);
        assertThat(view.greetingIsDefault()).isFalse();

        patchGreeting(island.host, island.id, forty + "🐟").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(islands.view(island.id, newUser()).visitor().greeting()).isEqualTo(forty);

        patchGreeting(island.host, island.id, "").andExpect(status().isOk());
        view = islands.view(island.id, newUser()).visitor();
        assertThat(view.greetingIsDefault()).isTrue();
        assertThat(view.greeting()).isEqualTo("테스트섬에 온 걸 환영해요! 같이 집중해요 🐟");
    }

    @Test
    @DisplayName("인사말 수정 — 섬장이 아니면 403 NOT_OWNER, 게스트는 403 SOCIAL_LOGIN_REQUIRED")
    void greetingEditIsHostAndMemberOnly() throws Exception {
        Island island = island(false);
        UUID guest = newGuest();

        patchGreeting(island.member, island.id, "탈취").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        patchGreeting(guest, island.id, "게스트").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
    }

    @Test
    @DisplayName("주민 상세(GET /internal/islands/{id}, member 범위)에도 인사말이 실린다 — 기본 문구 → 수정 뒤 값")
    void memberDetailCarriesGreeting() throws Exception {
        Island island = island(false);

        readIsland(island.host, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("member"))
                .andExpect(jsonPath("$.member.greeting").value("테스트섬에 온 걸 환영해요! 같이 집중해요 🐟"))
                .andExpect(jsonPath("$.member.greetingIsDefault").value(true));

        patchGreeting(island.host, island.id, "🐟 같이 해요").andExpect(status().isOk());
        for (UUID resident : List.of(island.host, island.member)) {
            readIsland(resident, island.id).andExpect(status().isOk())
                    .andExpect(jsonPath("$.member.greeting").value("🐟 같이 해요"))
                    .andExpect(jsonPath("$.member.greetingIsDefault").value(false));
        }
        // 방문자 요약과 같은 값이다 — 두 범위가 어긋나지 않는다.
        readIsland(island.visitor, island.id).andExpect(jsonPath("$.scope").value("visitor"))
                .andExpect(jsonPath("$.visitor.greeting").value("🐟 같이 해요"))
                .andExpect(jsonPath("$.visitor.greetingIsDefault").value(false));

        patchGreeting(island.host, island.id, "  ").andExpect(status().isOk());
        readIsland(island.host, island.id)
                .andExpect(jsonPath("$.member.greeting").value("테스트섬에 온 걸 환영해요! 같이 집중해요 🐟"))
                .andExpect(jsonPath("$.member.greetingIsDefault").value(true));
    }

    // ---------------------------------------------------------------- 방명록 쓰기

    @Test
    @DisplayName("게시판이 없는 섬은 쓰기 403 BOARD_LOCKED, 읽기는 boardBuilt=false 와 빈 목록")
    void noBoardLocksGuestbook() throws Exception {
        Island island = island(false);

        write(island.visitor, island.id, "안녕").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("BOARD_LOCKED"));
        read(island.visitor, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.boardBuilt").value(false))
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    @DisplayName("방문자 쓰기 201, 같은 KST 날 두 번째 409, 다음 날 201 — KST 자정 경계를 따른다")
    void oneEntryPerUserIslandKstDay() throws Exception {
        Island island = island(true);

        write(island.visitor, island.id, "🐟 안녕").andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value("🐟 안녕"))
                .andExpect(jsonPath("$.authorId").value(island.visitor.toString()))
                .andExpect(jsonPath("$.mine").value(true));
        write(island.visitor, island.id, "또 왔어요").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GUESTBOOK_ALREADY_WRITTEN_TODAY"));

        // 같은 UTC 날이라도 KST 자정(= 15:00Z) 전이면 같은 날이다.
        now.set(Instant.parse("2026-10-12T14:59:00Z"));
        write(island.visitor, island.id, "또 왔어요").andExpect(status().isConflict());
        now.set(Instant.parse("2026-10-12T15:01:00Z")); // KST 10/13 00:01
        write(island.visitor, island.id, "다음 날").andExpect(status().isCreated());

        // 다른 사람은 같은 날에도 쓸 수 있다 — 주민도 쓸 수 있다.
        write(island.member, island.id, "주민도 씀").andExpect(status().isCreated());
        read(island.visitor, island.id).andExpect(status().isOk())
                .andExpect(jsonPath("$.boardBuilt").value(true))
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[?(@.content=='주민도 씀')].mine").value(false));
    }

    @Test
    @DisplayName("본문 검증 — 20 코드포인트까지, 21 이나 공백뿐이면 400, 게스트는 403 SOCIAL_LOGIN_REQUIRED")
    void contentValidationAndGuestGuard() throws Exception {
        Island island = island(true);
        write(island.visitor, island.id, "🐟".repeat(20)).andExpect(status().isCreated());

        write(island.member, island.id, "🐟".repeat(21)).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        write(island.member, island.id, "   ").andExpect(status().isBadRequest());
        write(newGuest(), island.id, "게스트").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("31번째 글을 쓰면 가장 오래된 1개가 deleted_at 으로 지워지고 목록은 30개다")
    void keepsOnlyLatestThirty() throws Exception {
        Island island = island(true);
        List<UUID> authors = java.util.stream.IntStream.range(0, 31).mapToObj(i -> newUser()).toList();
        for (int i = 0; i < authors.size(); i++) {
            write(authors.get(i), island.id, "글 " + i).andExpect(status().isCreated());
        }

        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is null",
                island.id)).isEqualTo(30);
        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is not null "
                + "and content='글 0'", island.id)).isEqualTo(1);
        read(island.visitor, island.id).andExpect(jsonPath("$.items.length()").value(30))
                .andExpect(jsonPath("$.items[0].content").value("글 30"));
    }

    // ---------------------------------------------------------------- 삭제

    @Test
    @DisplayName("섬장 삭제는 200 {deleted:true}, 주민·방문자 삭제는 403 NOT_OWNER — 지운 날엔 다시 못 쓴다")
    void onlyHostDeletes() throws Exception {
        Island island = island(true);
        String entryId = writeAndGetId(island.visitor, island.id, "지워질 글");

        remove(island.member, island.id, entryId).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        remove(island.visitor, island.id, entryId).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_OWNER"));
        remove(island.host, island.id, entryId).andExpect(status().isOk())
                .andExpect(jsonPath("$.deleted").value(true));
        read(island.visitor, island.id).andExpect(jsonPath("$.items").isEmpty());

        remove(island.host, island.id, entryId).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        // 하루 1개는 «쓴 횟수» — 섬장이 지운 날에도 유니크 위반(500)이 아니라 409 다.
        write(island.visitor, island.id, "다시").andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GUESTBOOK_ALREADY_WRITTEN_TODAY"));
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, UUID host, UUID member, UUID visitor) {
    }

    private Island island(boolean withBoard) {
        UUID host = newUser();
        UUID member = newUser();
        UUID islandId = groups.save(Group.builder().name("테스트").maxMembers(10).isPrivate(false)
                .status(GroupStatus.WAITING).build()).getId();
        join(host, islandId, GroupMemberRole.OWNER);
        join(member, islandId, GroupMemberRole.MEMBER);
        if (withBoard) {
            jdbc.update("insert into island_facilities (island_id, building_id, status, cost, cost_revision) "
                    + "values (?, 'board', 'COMPLETED', 0, 1)", islandId);
        }
        return new Island(islandId, host, member, newUser());
    }

    private void join(UUID userId, UUID islandId, GroupMemberRole role) {
        members.save(GroupMember.builder().user(users.getCaller(userId))
                .group(groups.findById(islandId).orElseThrow()).role(role).build());
    }

    /** 회원 — 게스트로 만든 뒤 {@code is_guest} 만 내린다. */
    private UUID newUser() {
        UUID id = newGuest();
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private UUID newGuest() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private ResultActions patchGreeting(UUID actor, UUID islandId, String greeting) throws Exception {
        return mvc.perform(patch("/internal/islands/" + islandId).header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor).header("Idempotency-Key", UUID.randomUUID())
                .contentType("application/json").content("{\"greeting\":\"" + greeting + "\"}"));
    }

    private ResultActions readIsland(UUID actor, UUID islandId) throws Exception {
        return mvc.perform(get("/internal/islands/" + islandId)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private ResultActions read(UUID actor, UUID islandId) throws Exception {
        return mvc.perform(get("/internal/islands/" + islandId + "/guestbook")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private ResultActions write(UUID actor, UUID islandId, String content) throws Exception {
        return mvc.perform(post("/internal/islands/" + islandId + "/guestbook")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor)
                .contentType("application/json").content("{\"content\":\"" + content + "\"}"));
    }

    private String writeAndGetId(UUID actor, UUID islandId, String content) throws Exception {
        String body = write(actor, islandId, content).andExpect(status().isCreated()).andReturn().getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
    }

    private ResultActions remove(UUID actor, UUID islandId, String entryId) throws Exception {
        return mvc.perform(delete("/internal/islands/" + islandId + "/guestbook/" + entryId)
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor));
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
