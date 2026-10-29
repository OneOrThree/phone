package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.service.MagazineReviewService;
import com.oneorthree.phone.internal.scheduler.MagazinePublishScheduler;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.notification.producer.NotificationExpiry;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.test.web.servlet.MockMvc;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 V0+후속 PostgreSQL에서 공개 여부·원자성·경합·관리 자격 경계를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ContentPublicationIntegrationTest {
    private static final Instant NOW = Instant.parse("2034-05-10T01:00:00Z");
    private static final LocalDate DATE = LocalDate.of(2034, 5, 10);
    private static final String ADMIN = "/internal/admin/content";
    private static final String LAYOUT = "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[],\"tape\":null}";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.console.token", () -> "content-test-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.console.allow[0]", () -> "GET /internal/admin/content/notices");
        registry.add("internal.api.callers.console.allow[1]", () -> "POST /internal/admin/content/magazine/previews");
        registry.add("internal.api.callers.business.token", () -> "content-test-business");
        // 실수로 넓은 허용목록을 등록해도 관리 경로는 전용 자격만 통과해야 한다.
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/admin/content/notices");
    }

    @Autowired DeveloperNoticeService notices;
    @Autowired MagazineReviewService reviews;
    @Autowired MagazinePublishScheduler scheduler;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired GroupRepository groups;
    @MockitoBean Clock clock;
    @MockitoSpyBean NotificationOutboxProducer producer;

    @BeforeEach
    void reset() {
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(call -> Clock.fixed(NOW, call.getArgument(0)));
        jdbc.execute("TRUNCATE developer_notices, content_publications, magazine_review_snapshots, "
                + "magazine_receipts, magazine_issues, island_promotion_reports, island_promotions, telescope_pins");
    }

    @Test
    void noticesRespectWindowAndReplayAnImmutablePublication() {
        UUID id = UUID.randomUUID();
        var draft = draft(NOW.minusSeconds(60), NOW.plusSeconds(60));
        var first = notices.publish(id, draft, "member-1");
        assertThat(notices.publish(id, draft, "member-2")).isEqualTo(first);
        assertThat(notices.get(id)).isEqualTo(first);
        notices.publish(UUID.randomUUID(), draft(NOW.plusSeconds(1), null), "member-1");
        UUID expired = UUID.randomUUID();
        notices.publish(expired, draft(NOW.minusSeconds(60), NOW), "member-1");
        assertThat(notices.list(false).items()).containsExactly(first);
        assertThat(notices.list(true).items()).hasSize(3);
        assertThatThrownBy(() -> notices.get(expired)).isInstanceOf(ContentException.class);
        assertThatThrownBy(() -> notices.publish(id, draft(NOW, null), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("다른 내용");
        assertThat(jdbc.queryForObject("SELECT actor FROM content_publications WHERE publication_id=?",
                String.class, id)).isEqualTo("member-1");
    }

    @Test
    void concurrentNoticeRetriesCreateExactlyOnePublication() throws Exception {
        UUID id = UUID.randomUUID();
        var pool = Executors.newFixedThreadPool(4);
        try {
            List<Future<DeveloperNoticeService.Notice>> futures = new ArrayList<>();
            for (int i = 0; i < 8; i++) {
                futures.add(pool.submit(() -> notices.publish(id, draft(NOW, null), "member-1")));
            }
            for (var future : futures) {
                assertThat(future.get(15, TimeUnit.SECONDS).publicationId()).isEqualTo(id);
            }
            assertThat(count("developer_notices")).isEqualTo(1);
            assertThat(count("content_publications")).isEqualTo(1);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void failedReceiptRollsBackTheNoticeAsWell() {
        assertThatThrownBy(() -> notices.publish(UUID.randomUUID(), draft(NOW, null), "untrusted-actor"))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(count("developer_notices")).isZero();
        assertThat(count("content_publications")).isZero();
    }

    @Test
    void previewIsPrivateAndPublishUsesTheReviewedSnapshot() throws Exception {
        UUID promotion = promotion();
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, "검토한 편집부 소식"), "member-1");
        assertThat(count("magazine_issues")).isZero();
        assertThat(jdbc.queryForObject("SELECT snapshot IS NULL FROM island_promotions WHERE id=?",
                Boolean.class, promotion)).isTrue();
        var command = new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest());
        UUID publicationId = UUID.randomUUID();
        var pool = Executors.newFixedThreadPool(2);
        try {
            var left = pool.submit(() -> reviews.publish(publicationId, command, "member-1"));
            var right = pool.submit(() -> reviews.publish(publicationId, command, "member-2"));
            var result = left.get(20, TimeUnit.SECONDS);
            assertThat(right.get(20, TimeUnit.SECONDS)).isEqualTo(result);
            assertThat(result.issueNo()).isEqualTo(preview.issueNo());
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("magazine_issues")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT editorial->'note'->>'body' FROM magazine_issues", String.class))
                .isEqualTo("검토한 편집부 소식");
        assertThat(jdbc.queryForObject("SELECT snapshot->>'name' FROM island_promotions WHERE id=?",
                String.class, promotion)).isEqualTo(preview.cells().get(0).card().name());
        assertThatThrownBy(() -> reviews.publish(UUID.randomUUID(), command, "member-1"))
                .isInstanceOf(ContentException.class);
        assertThat(count("content_publications")).isEqualTo(1);
    }

    @Test
    void changedPromotionInvalidatesTheReviewWithoutPartialPublication() {
        UUID promotion = promotion();
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1");
        jdbc.update("UPDATE island_promotions SET body='검토 후 바뀐 글' WHERE id=?", promotion);
        assertThatThrownBy(() -> reviews.publish(UUID.randomUUID(),
                new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest()), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("다시 검토");
        assertThat(count("magazine_issues")).isZero();
        assertThat(count("content_publications")).isZero();
        assertThat(jdbc.queryForObject("SELECT snapshot IS NULL FROM island_promotions WHERE id=?",
                Boolean.class, promotion)).isTrue();
    }

    @Test
    void closedEditorialIslandRequiresReviewAgain() {
        Group island = groups.save(Group.builder().name("새로 생긴 검토 섬").maxMembers(10).isPrivate(false).build());
        jdbc.update("UPDATE islands SET created_at=? WHERE id=?", Timestamp.from(NOW.minusSeconds(86400)),
                island.getId());
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1");
        assertThat(preview.editorial().newIslands()).extracting(row -> row.islandId()).contains(island.getId());
        jdbc.update("UPDATE islands SET deleted_at=? WHERE id=?", Timestamp.from(NOW), island.getId());
        assertThatThrownBy(() -> reviews.publish(UUID.randomUUID(),
                new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest()), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("다시 검토");
        assertThat(count("magazine_issues")).isZero();
    }

    @Test
    void schedulerDoesNotCreateOrPublishAnUnreviewedIssue() {
        reviews.preview(new MagazineReviewService.PreviewRequest(DATE, "아직 검토 중"), "member-1");
        runTick();
        assertThat(count("magazine_issues")).isZero();
        assertThat(count("content_publications")).isZero();
    }

    @Test
    void latePublicationResumesAfterMidnightFailureAndStopsAtSeven() {
        // 이 테스트 전용 DB의 이전 정식 계정은 대상에서 빼고 정확히 세 수신자로 부분 실패를 만든다.
        jdbc.update("UPDATE users SET is_deleted=true WHERE is_guest=false AND is_deleted=false");
        for (int i = 0; i < 3; i++) {
            users.save(User.builder().nickname("자정 재시도-" + UUID.randomUUID()).language("ko").build());
        }
        Instant publishedAt = DATE.atTime(23, 55).atZone(ZonePolicy.KST).toInstant();
        setClock(publishedAt);
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, "늦게 게시한 소식"), "member-1");
        var published = reviews.publish(UUID.randomUUID(),
                new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest()), "member-1");
        assertThat(published.publishedAt()).isEqualTo(publishedAt);
        assertThat(count("magazine_issues")).isEqualTo(1);
        assertThat(notificationEvents(published.issueId())).isEmpty();

        // 00:00 틱의 첫 수신자는 커밋하고 둘째에서 실패한다. 공개 호는 유지하고 완료 표시를 쓰지 않는다.
        Instant midnight = DATE.plusDays(1).atStartOfDay(ZonePolicy.KST).toInstant();
        setClock(midnight);
        doCallRealMethod().doThrow(new IllegalStateException("시험용 outbox 기록 실패")).doCallRealMethod()
                .when(AopTestUtils.<NotificationOutboxProducer>getUltimateTargetObject(producer)).appendAll(any());
        runTick();
        assertThat(notificationEvents(published.issueId())).hasSize(1);
        assertThat(notifiedAt(published.issueId())).isNull();
        assertThat(count("magazine_issues")).isEqualTo(1);

        // 00:10 틱은 전날 호를 다시 찾고 이미 커밋한 사건은 결정적 키로 접는다.
        Instant retryAt = midnight.plusSeconds(600);
        setClock(retryAt);
        runTick();
        assertThat(notificationEvents(published.issueId())).hasSize(3).doesNotHaveDuplicates();
        assertThat(notifiedAt(published.issueId())).isEqualTo(retryAt);

        // 미완료로 남았더라도 다음 날 07시부터는 새 펼치기를 하지 않는다. quiet-hour 정책은 바꾸지 않는다.
        jdbc.update("UPDATE magazine_issues SET notified_at=NULL WHERE id=?", published.issueId());
        Instant expiry = DATE.plusDays(1).atTime(7, 0).atZone(ZonePolicy.KST).toInstant();
        assertThat(NotificationExpiry.expiresAt(NotificationKind.MAGAZINE_PUBLISHED, publishedAt)).isEqualTo(expiry);
        setClock(expiry);
        runTick();
        assertThat(notifiedAt(published.issueId())).isNull();
        assertThat(notificationEvents(published.issueId())).hasSize(3);
    }

    private void runTick() {
        // ShedLock의 실제 벽시계 대신 테스트 Clock으로 10분 간격을 이동한다.
        AopTestUtils.<MagazinePublishScheduler>getUltimateTargetObject(scheduler).publishToday();
    }

    private void setClock(Instant now) {
        when(clock.instant()).thenReturn(now);
        doAnswer(call -> Clock.fixed(now, call.getArgument(0))).when(clock).withZone(any());
    }

    private List<String> notificationEvents(UUID issueId) {
        return jdbc.queryForList("SELECT event_id FROM event_outbox WHERE event_id LIKE ?", String.class,
                "noti:MAGAZINE_PUBLISHED:%:" + issueId + ":%");
    }

    private Instant notifiedAt(UUID issueId) {
        Timestamp value = jdbc.queryForObject("SELECT notified_at FROM magazine_issues WHERE id=?",
                Timestamp.class, issueId);
        return value == null ? null : value.toInstant();
    }

    @Test
    void aFutureIssueCannotBePublishedEarly() {
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE.plusDays(1), null), "member-1");
        assertThatThrownBy(() -> reviews.publish(UUID.randomUUID(),
                new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest()), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("오전 7시");
        assertThat(count("magazine_issues")).isZero();
    }

    @Test
    void missingOrSpoofedManagementCredentialsNeverReachContent() throws Exception {
        mvc.perform(get(ADMIN + "/notices")).andExpect(status().isUnauthorized());
        mvc.perform(get(ADMIN + "/notices").header("Authorization", "Bearer content-test-business"))
                .andExpect(status().isForbidden());
        mvc.perform(get(ADMIN + "/notices").header("Authorization", "Bearer content-test-console")
                .header("X-Console-Actor", "member-2")).andExpect(status().isForbidden());
        mvc.perform(post(ADMIN + "/magazine/previews").header("Authorization", "Bearer content-test-console")
                .contentType(MediaType.APPLICATION_JSON).content("{\"issueDate\":\"2034-05-10\"}"))
                .andExpect(status().isOk());
        assertThat(count("magazine_issues")).isZero();
    }

    private long count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
    }

    private DeveloperNoticeService.Draft draft(Instant starts, Instant ends) {
        return new DeveloperNoticeService.Draft("개발자 소식", "검토한 본문", starts, ends);
    }

    private UUID promotion() {
        User owner = users.save(User.builder().nickname("검토-" + UUID.randomUUID()).build());
        Group island = groups.save(Group.builder().name("검토 섬").maxMembers(10).isPrivate(false).build());
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO island_promotions(id,island_id,issue_date,applied_by,applied_at,updated_at,body,layout)"
                        + " VALUES(?,?,?,?,?,?,?,?::jsonb)", id, island.getId(), DATE, owner.getId(),
                Timestamp.from(NOW.minusSeconds(86400)), Timestamp.from(NOW.minusSeconds(86400)), "검토한 홍보", LAYOUT);
        return id;
    }
}
