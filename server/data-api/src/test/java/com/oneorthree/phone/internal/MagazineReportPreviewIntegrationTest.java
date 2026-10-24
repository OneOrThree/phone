package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupLeaveReason;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.internal.dto.TelescopeItemView;
import com.oneorthree.phone.internal.service.MagazinePublishService;
import com.oneorthree.phone.internal.service.TelescopePinService;
import com.oneorthree.phone.internal.service.TelescopeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
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

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 고양이 잡지 홍보 칸 신고·망원경 칸 미리보기 (GROMO-2289)를 <b>실제 Flyway PostgreSQL</b>
 * 위에서 본다. 호는 발행 서비스로 내고, 핀은 생산 서비스, 신고는 내부 표면으로 부른다. 시계는 고정한다.
 *
 * <p>호는 DB 전체에 한 줄로 쌓이므로 테스트마다 잡지 표를 비우고 2주씩 떨어진 다른 날을 쓴다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class MagazineReportPreviewIntegrationTest {

    private static final String TOKEN = "test-magazine-report-business";
    private static final LocalDate FIRST_DATE = LocalDate.of(2035, 3, 7); // 수요일
    private static final AtomicInteger DATE_SEQ = new AtomicInteger();
    private static final String LAYOUT = "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[],\"tape\":null}";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("magazine.enabled", () -> true);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        String[] allow = {"POST /internal/users/*/islands/*/promotions/*/reports"};
        for (int i = 0; i < allow.length; i++) {
            String entry = allow[i];
            registry.add("internal.api.callers.business.allow[" + i + "]", () -> entry);
        }
    }

    @MockitoBean
    Clock clock;
    @Autowired
    MagazinePublishService publisher;
    @Autowired
    TelescopePinService pins;
    @Autowired
    TelescopeService telescope;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository islands;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    private final AtomicReference<Instant> now = new AtomicReference<>();
    private LocalDate date;

    @BeforeEach
    void setUp() {
        date = FIRST_DATE.plusWeeks(2L * DATE_SEQ.getAndIncrement());
        now.set(kst(date, 7, 0));
        when(clock.instant()).thenAnswer(invocation -> now.get());
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(invocation -> Clock.fixed(now.get(), invocation.getArgument(0)));
        jdbc.execute("TRUNCATE island_promotion_reports, magazine_receipts, magazine_issues, "
                + "island_promotions, magazine_editorial_notes, telescope_pins");
    }

    // ---------------------------------------------------------------- 신고

    @Test
    @DisplayName("서로 다른 사람 3명이 신고하면 그 칸이 숨겨진다 — 같은 사람의 두 번째는 200 이고 수가 그대로, 게스트는 403")
    void threeReportsHideTheCell() throws Exception {
        Island island = island("신고섬", false);
        UUID promotion = promotion(island, date);
        publisher.publish(date).orElseThrow();
        User first = user();

        report(first, island, promotion, "SPAM_FRAUD").andExpect(status().isCreated())
                .andExpect(jsonPath("$.reported").value(true));
        report(first, island, promotion, "HATE").andExpect(status().isOk())
                .andExpect(jsonPath("$.reported").value(true));
        report(user(), island, promotion, "HATE").andExpect(status().isCreated());
        assertThat(moderation(promotion)).as("2건까지는 그대로").isEqualTo("NONE");
        User guest = user();
        jdbc.update("update users set is_guest = true where id = ?", guest.getId());
        report(guest, island, promotion, "OTHER").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));

        now.set(kst(date, 9, 0));
        report(user(), island, promotion, "SEXUAL").andExpect(status().isCreated());

        assertThat(moderation(promotion)).isEqualTo("HIDDEN");
        assertThat(jdbc.queryForObject("select hidden_at from island_promotions where id = ?", Timestamp.class,
                promotion).toInstant()).isEqualTo(kst(date, 9, 0));
        assertThat(jdbc.queryForObject("select count(*) from island_promotion_reports where promotion_id = ?",
                Integer.class, promotion)).isEqualTo(3);
        assertThat(jdbc.queryForObject("select reason from island_promotion_reports where promotion_id = ? "
                + "and reporter_id = ?", String.class, promotion, first.getId())).as("처음 사유가 남는다")
                .isEqualTo("SPAM_FRAUD");
    }

    @Test
    @DisplayName("지금 주민인 섬의 칸은 신고할 수 없다(403) — 섬장·주민 모두, 떠난·강퇴된 사람은 일반 독자라 신고된다")
    void residentsCannotReportTheirOwnIsland() throws Exception {
        Island island = island("우리섬", false);
        UUID promotion = promotion(island, date);
        publisher.publish(date).orElseThrow();
        User resident = member(island, null);
        User left = member(island, GroupLeaveReason.LEFT);
        User kicked = member(island, GroupLeaveReason.KICKED);

        report(island.owner, island, promotion, "OTHER").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PROMOTION_REPORT_OWN_ISLAND"));
        report(resident, island, promotion, "SPAM_FRAUD").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PROMOTION_REPORT_OWN_ISLAND"));
        report(left, island, promotion, "OTHER").andExpect(status().isCreated());
        report(kicked, island, promotion, "OTHER").andExpect(status().isCreated());

        assertThat(jdbc.queryForList("select reporter_id from island_promotion_reports where promotion_id = ?",
                UUID.class, promotion)).containsExactlyInAnyOrder(left.getId(), kicked.getId());
        assertThat(moderation(promotion)).isEqualTo("NONE");
    }

    @Test
    @DisplayName("운영이 되살린 칸(CLEARED)은 신고가 더 와도 다시 숨기지 않는다")
    void clearedCellIsNotHiddenAgain() throws Exception {
        Island island = island("되살린섬", false);
        UUID promotion = promotion(island, date);
        publisher.publish(date).orElseThrow();
        jdbc.update("update island_promotions set moderation = 'CLEARED' where id = ?", promotion);

        for (int i = 0; i < 4; i++) {
            report(user(), island, promotion, "OTHER").andExpect(status().isCreated());
        }

        assertThat(moderation(promotion)).isEqualTo("CLEARED");
    }

    @Test
    @DisplayName("신고 대상은 실린 칸뿐이다 — 아직 발행 전·실리지 않은 칸·다른 섬 경로·없는 칸은 404, 사유가 8종 글자가 아니면(소문자·숫자 포함) 400")
    void onlyPublishedCellsCanBeReported() throws Exception {
        Island island = island("대상섬", false);
        Island other = island("다른섬", false);
        Island hidden = island("닫힌섬", false);
        jdbc.update("update islands set deleted_at = now() where id = ?", hidden.id);
        UUID published = promotion(island, date);
        UUID skipped = promotion(hidden, date);
        UUID tomorrow = promotion(island, date.plusDays(1));
        publisher.publish(date).orElseThrow();
        User reporter = user();

        report(reporter, island, tomorrow, "OTHER").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("PROMOTION_NOT_FOUND"));
        report(reporter, hidden, skipped, "OTHER").andExpect(status().isNotFound());
        report(reporter, other, published, "OTHER").andExpect(status().isNotFound());
        report(reporter, island, UUID.randomUUID(), "OTHER").andExpect(status().isNotFound());
        report(reporter, island, published, "BORING").andExpect(status().isBadRequest());
        report(reporter, island, published, "hate").andExpect(status().isBadRequest());
        // 열거형 순서 번호(0 = HARASSMENT)로 사유가 되지 않는다.
        mvc.perform(post("/internal/users/" + reporter.getId() + "/islands/" + island.id + "/promotions/" + published
                        + "/reports").header("Authorization", "Bearer " + TOKEN).header("X-User-Id", reporter.getId())
                        .contentType("application/json").content("{\"reason\":0}"))
                .andExpect(status().isBadRequest());
        assertThat(jdbc.queryForObject("select count(*) from island_promotion_reports", Integer.class)).isZero();
    }

    @Test
    @DisplayName("기존 전망대·편집부 핀을 홍보 칸에서 다시 넣어도 출처와 미리보기를 바꾸지 않는다")
    void repeatingExistingPinPreservesItsPreview() {
        Island island = island("기존핀섬", false);
        UUID promotion = promotion(island, date);
        publisher.publish(date).orElseThrow();

        for (String source : List.of("observatory", "magazine")) {
            User reader = user();
            now.set(kst(date, 8, 0));
            var original = pins.pin(reader.getId(), island.id, source, null);
            assertThat(original.created()).isTrue();

            // 핀은 넣은 1시간 버킷의 끝에 만료된다(GROMO-2306) — 같은 버킷 안에서 다시 넣는다.
            now.set(kst(date, 8, 30));
            var repeated = pins.pin(reader.getId(), island.id, "magazine", promotion);
            assertThat(repeated.created()).isFalse();
            TelescopeItemView item = pinned(reader, island);
            assertThat(item.pinnedFrom()).isEqualTo(source);
            assertThat(item.pinnedAt()).isEqualTo(original.item().pinnedAt());
            assertThat(item.magazineCell()).isNull();
        }
    }

    @Test
    @DisplayName("기존 핀이 만료된 뒤 잡지 칸에서 새로 넣으면 새 핀과 홍보 미리보기를 남긴다")
    void expiredPinCanBeReplacedByAMagazinePin() {
        Island island = island("만료핀섬", false);
        UUID promotion = promotion(island, date);
        User reader = user();
        now.set(kst(date.minusDays(1), 8, 0));
        pins.pin(reader.getId(), island.id, "observatory", null);
        now.set(kst(date, 7, 0));
        publisher.publish(date).orElseThrow();

        now.set(kst(date, 8, 0));
        var replacement = pins.pin(reader.getId(), island.id, "magazine", promotion);
        assertThat(replacement.created()).isTrue();
        assertThat(replacement.item().pinnedFrom()).isEqualTo("magazine");
        assertThat(replacement.item().magazineCell().promotionId()).isEqualTo(promotion);
    }

    // ---------------------------------------------------------------- 망원경 칸 미리보기

    @Test
    @DisplayName("망원경 — 홍보 칸에서 넣은 핀만 그 칸을 미리보기로 싣고, 편집부 칸·다른 섬의 칸·전망대 핀·숨겨진 칸·"
            + "핀과 다른 칸·현재 호가 아니면 null")
    void telescopeCarriesTheMagazineCell() {
        Island fromMagazine = island("잡지핀섬", false);
        Island fromObservatory = island("전망대핀섬", false);
        Island fromEditorial = island("편집부핀섬", false);
        Island wrongCell = island("남의칸핀섬", false);
        UUID earlier = promotion(fromMagazine, date.minusDays(1));
        UUID promotion = promotion(fromMagazine, date);
        promotion(fromObservatory, date);
        promotion(fromEditorial, date);
        promotion(wrongCell, date);
        publisher.publish(date).orElseThrow();
        User viewer = user();
        now.set(kst(date, 8, 0));
        pins.pin(viewer.getId(), fromMagazine.id, "magazine", promotion);
        pins.pin(viewer.getId(), fromObservatory.id, "observatory", null);
        // 같은 호에 홍보를 실은 섬이라도 편집부 무료 칸(promotionId 없음)이나 다른 섬의 칸으로 넣었으면 미리보기가 없다.
        pins.pin(viewer.getId(), fromEditorial.id, "magazine", null);
        pins.pin(viewer.getId(), wrongCell.id, "magazine", promotion);
        assertThat(pinned(viewer, fromEditorial).magazineCell()).as("편집부 칸").isNull();
        assertThat(pinned(viewer, wrongCell).magazineCell()).as("다른 섬의 칸").isNull();

        TelescopeItemView magazinePin = pinned(viewer, fromMagazine);
        assertThat(magazinePin.magazineCell()).isNotNull();
        assertThat(magazinePin.magazineCell().promotionId()).isEqualTo(promotion);
        assertThat(magazinePin.magazineCell().name()).isEqualTo("잡지핀섬");
        assertThat(magazinePin.magazineCell().body()).isEqualTo("홍보");
        assertThat(magazinePin.magazineCell().privateIsland()).isFalse();
        assertThat(magazinePin.magazineCell().buildingCount()).as("시설이 없는 섬").isZero();
        assertThat(magazinePin.magazineCell().layout().frameId()).isEqualTo("mag.frame-scallop");
        assertThat(pinned(viewer, fromObservatory).magazineCell()).isNull();

        jdbc.update("update island_promotions set moderation = 'HIDDEN' where id = ?", promotion);
        assertThat(pinned(viewer, fromMagazine).magazineCell()).as("숨겨진 칸").isNull();
        jdbc.update("update island_promotions set moderation = 'NONE' where id = ?", promotion);
        jdbc.update("update telescope_pins set promotion_id = ? where island_id = ?", earlier, fromMagazine.id);
        assertThat(pinned(viewer, fromMagazine).magazineCell()).as("핀은 지난 호 칸 — 섬의 현재 호 칸을 대신 싣지 않는다")
                .isNull();
        jdbc.update("update telescope_pins set promotion_id = ? where island_id = ?", promotion, fromMagazine.id);
        // 핀은 넣은 1시간 버킷의 끝에 만료된다(GROMO-2306) — 현재 호의 마지막 버킷(06시대)에 다시 넣고 경계를 본다.
        now.set(kst(date.plusDays(1), 6, 30));
        assertThat(pins.pin(viewer.getId(), fromMagazine.id, "magazine", promotion).created()).isTrue();
        now.set(kst(date.plusDays(1), 6, 59));
        assertThat(pinned(viewer, fromMagazine).magazineCell()).isNotNull();
        now.set(kst(date.plusDays(1), 7, 0));
        var expiredIssuePin = pins.pin(viewer.getId(), fromMagazine.id, "magazine", promotion);
        assertThat(expiredIssuePin.created()).isTrue();
        assertThat(expiredIssuePin.item().magazineCell()).as("현재 호가 끝나면 미리보기를 연결하지 않는다").isNull();
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, Group group, User owner) {
    }

    private Island island(String name, boolean isPrivate) {
        User owner = user();
        Group group = islands.save(Group.builder().name(name).maxMembers(10).isPrivate(isPrivate).build());
        members.save(GroupMember.builder().user(owner).group(group).role(GroupMemberRole.OWNER).build());
        return new Island(group.getId(), group, owner);
    }

    /** 그 섬의 주민 — {@code left} 가 있으면 그 사유로 떠난 사람이다. */
    private User member(Island island, GroupLeaveReason left) {
        User user = user();
        GroupMember member = GroupMember.builder().user(user).group(island.group).role(GroupMemberRole.MEMBER).build();
        if (left == GroupLeaveReason.LEFT) {
            member.leave(kst(date, 8, 0));
        } else if (left == GroupLeaveReason.KICKED) {
            member.kick(kst(date, 8, 0));
        }
        members.save(member);
        return user;
    }

    private User user() {
        return users.save(User.builder().nickname("잡지-" + UUID.randomUUID()).build());
    }

    /** 그 호의 칸 — 전날 08:00 KST 에 신청한 것으로 둔다. */
    private UUID promotion(Island island, LocalDate issueDate) {
        UUID id = UUID.randomUUID();
        Timestamp applied = Timestamp.from(kst(issueDate.minusDays(1), 8, 0));
        jdbc.update("insert into island_promotions (id, island_id, issue_date, applied_by, applied_at, updated_at, "
                + "body, layout) values (?, ?, ?, ?, ?, ?, '홍보', ?::jsonb)", id, island.id, issueDate,
                island.owner.getId(), applied, applied, LAYOUT);
        return id;
    }

    private String moderation(UUID promotionId) {
        return jdbc.queryForObject("select moderation from island_promotions where id = ?", String.class,
                promotionId);
    }

    private TelescopeItemView pinned(User viewer, Island island) {
        return telescope.list(viewer.getId()).items().stream()
                .filter(item -> island.id.equals(item.islandId()) && "pinned".equals(item.slot()))
                .findFirst().orElseThrow();
    }

    private static Instant kst(LocalDate day, int hour, int minute) {
        return day.atTime(hour, minute).atZone(ZonePolicy.KST).toInstant();
    }

    private ResultActions report(User actor, Island island, UUID promotionId, String reason) throws Exception {
        return mvc.perform(post("/internal/users/" + actor.getId() + "/islands/" + island.id + "/promotions/"
                + promotionId + "/reports").header("Authorization", "Bearer " + TOKEN)
                .header("X-User-Id", actor.getId()).contentType("application/json")
                .content("{\"reason\":\"" + reason + "\"}"));
    }

}
