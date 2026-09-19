package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 게시판의 <b>기본 스위치</b> 검증 (GROMO-1771) — {@code island-board.writes-enabled} 와
 * {@code construction.facility-gates.enforce} 를 건드리지 않은 배포 그대로다.
 *
 * <p>BQ02·BQ03 결정 전이라 네 쓰기는 receipt·잠금보다 먼저 503 으로 닫히고, 조회는 열려 있다. 시설 게이트가
 * 꺼져 있어 게시판이 없는 섬도 읽힌다(적립 경로 배포 전 종전 동작 보존). legacy 공지 경로는 이 스위치와
 * 무관하게 그대로 동작한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandNoticeGateDefaultsTest {

    private static final String TOKEN = "test-island-notice-gate-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/islands/*/notices");
    }

    @Autowired
    IslandNoticeService notices;
    @Autowired
    GroupAnnouncementService legacy;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    @Test
    @DisplayName("쓰기 4종은 기본 OFF — NOTICE_WRITE_UNAVAILABLE(503), 행·receipt·사건이 남지 않는다")
    void writesAreClosedByDefault() throws Exception {
        UUID owner = user();
        UUID islandId = island(owner);
        legacy.createAnnouncement(islandId, owner, new CreateAnnouncementRequest("legacy 공지", "본문"));
        UUID noticeId = jdbc.queryForObject("select id from group_announcements where group_id=?", UUID.class,
                islandId);
        long receipts = count("select count(*) from command_idempotency");

        assertThatThrownBy(() -> notices.create(islandId, owner, "공지", "본문", UUID.randomUUID()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_WRITE_UNAVAILABLE);
        assertThatThrownBy(() -> notices.update(islandId, noticeId, owner, "제목", null, UUID.randomUUID()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_WRITE_UNAVAILABLE);
        assertThatThrownBy(() -> notices.delete(islandId, noticeId, owner, UUID.randomUUID()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_WRITE_UNAVAILABLE);
        assertThatThrownBy(() -> notices.comment(islandId, noticeId, owner, "댓글", UUID.randomUUID()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_WRITE_UNAVAILABLE);

        mvc.perform(post("/internal/islands/" + islandId + "/notices")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", owner.toString())
                        .header("Idempotency-Key", UUID.randomUUID().toString())
                        .contentType("application/json")
                        .content("{\"title\":\"공지\",\"body\":\"본문\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("NOTICE_WRITE_UNAVAILABLE"));

        assertThat(count("select count(*) from group_announcements where group_id=?", islandId)).isEqualTo(1);
        // 공유 DB 라 다른 테스트 클래스의 댓글이 섞인다 — 이 공지로 좁혀 센다.
        assertThat(count("select count(*) from group_announcement_comments where notice_id=?", noticeId)).isZero();
        assertThat(count("select count(*) from command_idempotency")).isEqualTo(receipts);
        assertThat(count("select count(*) from event_outbox where type='notice.updated' and aggregate_id=?",
                noticeId.toString())).isEqualTo(1);
    }

    @Test
    @DisplayName("조회는 열려 있고, 게이트 OFF 라 게시판이 없는 섬도 주민은 읽는다")
    void readsWorkWithoutBoardWhenGateIsOff() {
        UUID owner = user();
        UUID islandId = island(owner);
        legacy.createAnnouncement(islandId, owner, new CreateAnnouncementRequest("legacy 공지", "본문"));

        IslandNoticeViews.Page page = notices.list(islandId, owner, null, null, 30);
        assertThat(page.items()).singleElement().satisfies(item -> {
            assertThat(item.title()).isEqualTo("legacy 공지");
            assertThat(item.commentCount()).isZero();
        });
        IslandNoticeViews.Detail detail = notices.detail(islandId, page.items().get(0).id(), owner, null, null, 30);
        assertThat(detail.body()).isEqualTo("본문");
        assertThat(detail.version()).isEqualTo(1);
        assertThat(detail.comments()).isEmpty();
    }

    private UUID user() {
        return users.save(User.builder().nickname("방장-" + UUID.randomUUID().toString().substring(0, 8)).build())
                .getId();
    }

    private UUID island(UUID owner) {
        Group island = groups.save(Group.builder().name("기본섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.findById(owner).orElseThrow()).group(island)
                .role(GroupMemberRole.OWNER).build());
        return island.getId();
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
