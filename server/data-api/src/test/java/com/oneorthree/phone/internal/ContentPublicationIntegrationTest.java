package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.internal.service.ContentHistoryService;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.internal.service.MagazineReviewService;
import com.oneorthree.phone.internal.service.MagazinePublishService;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 실제 V0+후속 PostgreSQL에서 공개 여부·원자성·경합·관리 자격 경계를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ContentPublicationIntegrationTest {
    private static final Instant NOW = Instant.parse("2034-05-10T01:00:00Z");
    private static final LocalDate DATE = LocalDate.of(2034, 5, 10);
    private static final String ADMIN = "/internal/admin/content";
    private static final String NOTICES = "/internal/users/%s/developer-notices";
    private static final String LAYOUT = "{\"v\":1,\"frameId\":\"mag.frame-scallop\",\"stickers\":[],\"tape\":null}";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.console.token", () -> "content-test-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.console.allow[0]", () -> "GET /internal/admin/content/notices");
        registry.add("internal.api.callers.console.allow[1]", () -> "POST /internal/admin/content/magazine/previews");
        registry.add("internal.api.callers.console.allow[2]", () ->
                "POST /internal/admin/content/notices/*/withdraw");
        registry.add("internal.api.callers.business.token", () -> "content-test-business");
        // 실수로 넓은 허용목록을 등록해도 관리 경로는 전용 자격만 통과해야 한다.
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/admin/content/notices");
        // 운영 application-satellites.yml 이 Business 에 여는 공개 소식 목록 — 이어 읽기를 실제 경로로 본다.
        registry.add("internal.api.callers.business.allow[1]", () -> "GET /internal/users/*/developer-notices");
    }

    @Autowired DeveloperNoticeService notices;
    @Autowired ContentHistoryService history;
    @Autowired MagazineReviewService reviews;
    @Autowired MagazinePublishScheduler scheduler;
    @Autowired JdbcTemplate jdbc;
    @Autowired com.oneorthree.phone.internal.service.ConstructionPolicyAdminService construction;
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @Autowired GroupRepository groups;
    @MockitoBean Clock clock;
    @MockitoSpyBean NotificationOutboxProducer producer;
    @MockitoSpyBean MagazinePublishService publisher;

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
    void publicListReadsEveryActiveNoticeOnceInOrderAcrossPages() throws Exception {
        // 7건씩 같은 published_at(마이크로초 포함). 같은 시각에 미시작·만료·철회 행을 섞어 id 가 가르는 구간을 만든다.
        Map<UUID, Instant> active = new HashMap<>();
        for (int i = 0; i < 105; i++) {
            Instant at = NOW.minusSeconds(60L * (i / 7)).plusNanos(123_456_000L);
            active.put(publishAt(at, draft(NOW.minusSeconds(3600), null)), at);
            if (i % 6 == 0) {
                publishAt(at, draft(NOW.plusSeconds(60), null));
                publishAt(at, draft(NOW.minusSeconds(7200), NOW));
                notices.withdraw(publishAt(at, draft(NOW.minusSeconds(3600), null)), "member-1");
            }
        }
        when(clock.instant()).thenReturn(NOW);
        // 기대 순서는 Java UUID.compareTo 가 아니라 소문자 문자열 비교로 만든다 — PostgreSQL uuid 는 바이트 순서다.
        List<String> expected = active.entrySet().stream()
                .sorted(Map.Entry.<UUID, Instant>comparingByValue()
                        .thenComparing(entry -> entry.getKey().toString()).reversed())
                .map(entry -> entry.getKey().toString()).toList();
        UUID reader = users.save(User.builder().nickname("공지 독자-" + UUID.randomUUID()).build()).getId();

        for (int limit : new int[]{100, 35, 7}) {
            Walk walk = walk(reader, limit);
            assertThat(walk.ids()).as("limit %d", limit).containsExactlyElementsOf(expected);
            List<Integer> sizes = new ArrayList<>();
            for (int left = expected.size(); left > 0; left -= limit) {
                sizes.add(Math.min(left, limit));
            }
            assertThat(walk.sizes()).as("limit %d 쪽 크기", limit).containsExactlyElementsOf(sizes);
        }
        String first = mvc.perform(noticesRequest(reader)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(JsonPath.<List<String>>read(first, "$.items[*].publicationId"))
                .as("파라미터 없는 호출은 예전처럼 첫 100건").containsExactlyElementsOf(expected.subList(0, 100));
        assertThat(JsonPath.<Boolean>read(first, "$.hasMore")).isTrue();
        assertThat(notices.list(false).items()).extracting(notice -> notice.publicationId().toString())
                .containsExactlyElementsOf(expected.subList(0, 100));
        // 관리 목록은 활성 여부와 무관하게 지금처럼 100건에서 멈춘다.
        assertThat(notices.list(true).items()).hasSize(100);
        assertThat(notices.list(true).hasMore()).isTrue();
    }

    @Test
    void exactlyOneHundredActiveNoticesEndWithoutAnotherPage() throws Exception {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 101; i++) {
            ids.add(publishAt(NOW.minusSeconds(i), draft(NOW.minusSeconds(3600), null)));
        }
        when(clock.instant()).thenReturn(NOW);
        UUID reader = users.save(User.builder().nickname("공지 독자-" + UUID.randomUUID()).build()).getId();
        assertThat(walk(reader, 100).sizes()).containsExactly(100, 1);

        // 가장 오래된 1건을 내리면 정확히 100건 — 다음 쪽이 없다.
        notices.withdraw(ids.get(100), "member-1");
        assertThat(walk(reader, 100).sizes()).containsExactly(100);
        assertThat(notices.list(null, null, 100).hasMore()).isFalse();
    }

    @Test
    void publicListRejectsAHalfAnchorAndAnOutOfRangeLimit() throws Exception {
        UUID reader = users.save(User.builder().nickname("공지 독자-" + UUID.randomUUID()).build()).getId();
        for (Map<String, String> query : List.of(Map.of("afterPublishedAt", NOW.toString()),
                Map.of("afterId", UUID.randomUUID().toString()), Map.of("limit", "0"), Map.of("limit", "101"),
                Map.of("limit", "-1"))) {
            var request = noticesRequest(reader);
            query.forEach(request::param);
            mvc.perform(request).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        // 형식이 틀린 값은 서비스까지 오기 전에 전역 변환 오류로 거절된다.
        for (Map<String, String> query : List.of(
                Map.of("afterPublishedAt", "어제", "afterId", UUID.randomUUID().toString()),
                Map.of("afterPublishedAt", NOW.toString(), "afterId", "not-a-uuid"), Map.of("limit", "many"))) {
            var request = noticesRequest(reader);
            query.forEach(request::param);
            mvc.perform(request).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_PARAMETER"));
        }
        assertThatThrownBy(() -> notices.list(NOW, null, 10)).isInstanceOf(ContentException.class);
        assertThatThrownBy(() -> notices.list(null, UUID.randomUUID(), 10)).isInstanceOf(ContentException.class);
    }

    @Test
    void withdrawalImmediatelyEndsExposureAndKeepsThePublicationHistory() throws Exception {
        UUID id = UUID.randomUUID();
        notices.publish(id, draft(NOW.minusSeconds(60), null), "member-1");
        String path = ADMIN + "/notices/" + id + "/withdraw";
        mvc.perform(post(path).header("Authorization", "Bearer content-test-business"))
                .andExpect(status().isForbidden());
        mvc.perform(post(path).header("Authorization", "Bearer content-test-console"))
                .andExpect(status().isOk());
        assertThatThrownBy(() -> notices.get(id)).isInstanceOf(ContentException.class);
        assertThat(notices.list(false).items()).isEmpty();
        assertThat(notices.list(true).items()).hasSize(1);
        assertThat(history.notices(null, 10).items().get(0))
                .containsEntry("status", "WITHDRAWN").containsEntry("withdrawnBy", "member-1");
        var first = notices.withdraw(id, "member-2");
        assertThat(first.withdrawnBy()).isEqualTo("member-1");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM content_publications WHERE publication_id=?",
                Long.class, id)).isEqualTo(1);
    }

    @Test
    void noticeHistoryIncludesScheduledLiveExpiredAndAllPages() {
        notices.publish(UUID.randomUUID(), draft(NOW.minusSeconds(60), NOW.plusSeconds(60)), "member-1");
        notices.publish(UUID.randomUUID(), draft(NOW.plusSeconds(60), null), "member-2");
        notices.publish(UUID.randomUUID(), draft(NOW.minusSeconds(120), NOW), "member-3");

        var first = history.notices(null, 2);
        when(clock.instant()).thenReturn(NOW.plusSeconds(1));
        UUID inserted = UUID.randomUUID();
        notices.publish(inserted, draft(NOW.minusSeconds(60), NOW.plusSeconds(60)), "member-1");
        var second = history.notices(first.nextCursor(), 2);
        assertThat(first.total()).isEqualTo(3);
        assertThat(first.nextCursor()).isNotNull();
        assertThat(second.nextCursor()).isNull();
        assertThat(java.util.stream.Stream.concat(first.items().stream(), second.items().stream())
                .map(item -> item.get("id"))).doesNotHaveDuplicates().doesNotContain(inserted.toString());
        assertThat(java.util.stream.Stream.concat(first.items().stream(), second.items().stream())
                .map(item -> item.get("status"))).containsExactlyInAnyOrder("LIVE", "SCHEDULED", "EXPIRED");
        assertThat(first.items()).allSatisfy(item -> assertThat(item.get("actor")).isNotNull());
    }

    @Test
    void magazineHistoryReadsOlderIssuesWithoutBackofficeReceipts() {
        UUID older = UUID.randomUUID();
        UUID newer = UUID.randomUUID();
        jdbc.update("INSERT INTO magazine_issues(id,issue_date,issue_no,published_at,editorial,promotion_count)"
                + " VALUES(?,?,1,?,'{}'::jsonb,0)", older, java.sql.Date.valueOf(DATE.minusDays(1)),
                Timestamp.from(NOW.minusSeconds(86400)));
        jdbc.update("INSERT INTO magazine_issues(id,issue_date,issue_no,published_at,editorial,promotion_count)"
                + " VALUES(?,?,2,?,'{}'::jsonb,0)", newer, java.sql.Date.valueOf(DATE), Timestamp.from(NOW));

        var first = history.magazines(null, 1);
        UUID later = UUID.randomUUID();
        jdbc.update("INSERT INTO magazine_issues(id,issue_date,issue_no,published_at,editorial,promotion_count)"
                + " VALUES(?,?,3,?,'{}'::jsonb,0)", later, java.sql.Date.valueOf(DATE.plusDays(1)),
                Timestamp.from(NOW.plusSeconds(86400)));
        var second = history.magazines(first.nextCursor(), 1);
        assertThat(first.items().get(0)).containsEntry("id", newer.toString())
                .containsEntry("status", "NOTIFICATION_PENDING").containsEntry("actor", null);
        assertThat(second.items().get(0)).containsEntry("id", older.toString());
        assertThat(second.nextCursor()).isNull();
        assertThat(second.items().get(0)).containsEntry("status", "NOTIFICATION_EXPIRED");
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
    void newlyPrivateIslandRequiresReviewAgain() {
        Group island = groups.save(Group.builder().name("공개로 소개할 새 섬").maxMembers(10).isPrivate(false).build());
        jdbc.update("UPDATE islands SET created_at=? WHERE id=?", Timestamp.from(NOW.minusSeconds(86400)),
                island.getId());
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1");
        assertThat(preview.editorial().newIslands()).extracting(row -> row.islandId()).contains(island.getId());
        jdbc.update("UPDATE islands SET is_private=true WHERE id=?", island.getId());
        assertThatThrownBy(() -> reviews.publish(UUID.randomUUID(),
                new MagazineReviewService.PublishRequest(preview.snapshotId(), preview.digest()), "member-1"))
                .isInstanceOf(ContentException.class).hasMessageContaining("다시 검토");
        assertThat(count("magazine_issues")).isZero();
        assertThat(count("content_publications")).isZero();
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
    void previewRejectsFutureAndUnclosedWindowsBeforeWritingAverages() {
        for (LocalDate date : List.of(DATE.minusDays(1), DATE.plusDays(1))) {
            assertThatThrownBy(() -> reviews.preview(new MagazineReviewService.PreviewRequest(date, null), "member-1"))
                    .isInstanceOf(ContentException.class).hasMessageContaining("오전 7시");
        }
        Group island = groups.save(Group.builder().name("아직 집계할 수 없는 섬").maxMembers(10).build());
        setClock(DATE.atTime(6, 59).atZone(ZonePolicy.KST).toInstant());
        assertThatThrownBy(() -> reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1"))
                    .isInstanceOf(ContentException.class).hasMessageContaining("오전 7시");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_focus_averages WHERE island_id=?",
                Long.class, island.getId())).isZero();
        assertThat(count("magazine_review_snapshots")).isZero();
        assertThat(count("magazine_issues")).isZero();
    }

    @Test
    void previewComputesTheClosedWindowBeforeFreezingCards() {
        Group island = groups.save(Group.builder().name("오늘 평균을 기다리는 섬").maxMembers(10).build());
        jdbc.update("UPDATE islands SET created_at=? WHERE id=?", Timestamp.from(NOW.minusSeconds(86400)),
                island.getId());
        jdbc.update("INSERT INTO island_focus_averages(snapshot_date,island_id,member_count,avg_minutes_per_member_day)"
                + " VALUES(?,?,?,?)", DATE.minusDays(1), island.getId(), 1, 77);
        setClock(DATE.atTime(7, 0).atZone(ZonePolicy.KST).toInstant());
        var preview = reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1");
        assertThat(jdbc.queryForObject("SELECT member_count FROM island_focus_averages"
                + " WHERE snapshot_date=? AND island_id=?", Integer.class, DATE, island.getId())).isZero();
        var card = preview.editorial().newIslands().stream()
                .filter(row -> row.islandId().equals(island.getId())).findFirst().orElseThrow();
        assertThat(card.averageFocusMinutesPerDay()).as("전날 77분 대신 오늘 주민0명의 null 평균을 동결한다").isNull();
        assertThat(count("magazine_review_snapshots")).isEqualTo(1);
        assertThat(count("magazine_issues")).isZero();
    }

    @Test
    void averageCommitSurvivesAFailedReviewWithoutPublishing() {
        Group island = groups.save(Group.builder().name("집계 후 검토 실패 섬").maxMembers(10).build());
        doThrow(new IllegalStateException("검토 읽기 실패")).when(publisher).preview(DATE, null);
        assertThatThrownBy(() -> reviews.preview(new MagazineReviewService.PreviewRequest(DATE, null), "member-1"))
                .isInstanceOf(IllegalStateException.class).hasMessage("검토 읽기 실패");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM island_focus_averages"
                + " WHERE snapshot_date=? AND island_id=?", Long.class, DATE, island.getId())).isEqualTo(1);
        assertThat(count("magazine_review_snapshots")).isZero();
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

    @Test
    void draftWithoutMinVersionsKeepsTheLegacyDigestBytes() {
        var open = new DeveloperNoticeService.Draft("t", "b", Instant.parse("2026-10-29T00:00:00Z"), null, null, null);
        var closed = new DeveloperNoticeService.Draft("t", "b", Instant.parse("2026-10-29T00:00:00Z"),
                Instant.parse("2026-10-30T00:00:00Z"), null, null);
        assertThat(com.oneorthree.phone.content.service.ContentJson.write(open))
                .isEqualTo("{\"title\":\"t\",\"body\":\"b\",\"startsAt\":\"2026-10-29T00:00:00Z\",\"endsAt\":null}");
        assertThat(com.oneorthree.phone.content.service.ContentJson.write(closed))
                .isEqualTo("{\"title\":\"t\",\"body\":\"b\",\"startsAt\":\"2026-10-29T00:00:00Z\","
                        + "\"endsAt\":\"2026-10-30T00:00:00Z\"}");
    }

    @Test
    void minVersionsAreStoredReplayedAndValidated() {
        UUID id = UUID.randomUUID();
        var forced = new DeveloperNoticeService.Draft("강제", "본문", NOW.minusSeconds(60), null, "2.1.0", null);
        var first = notices.publish(id, forced, "member-1");
        assertThat(notices.publish(id, forced, "member-2")).isEqualTo(first);
        assertThat(notices.get(id).minIosVersion()).isEqualTo("2.1.0");
        assertThat(notices.get(id).minAndroidVersion()).isNull();
        assertThat(jdbc.queryForObject("SELECT min_ios_version FROM developer_notices WHERE publication_id=?",
                String.class, id)).isEqualTo("2.1.0");
        assertThat(history.notices(null, 10).items().get(0)).containsEntry("minIosVersion", "2.1.0");
        for (String bad : new String[]{"", "2.1", "v2.1.0", "2.1.0.1", "1234567890.0.0"}) {
            assertThatThrownBy(() -> notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft(
                    "강제", "본문", NOW, null, bad, null), "member-1")).as(bad).isInstanceOf(ContentException.class);
            assertThatThrownBy(() -> notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft(
                    "강제", "본문", NOW, null, null, bad), "member-1")).as(bad).isInstanceOf(ContentException.class);
        }
    }

    @Test
    void appRequirementPicksTheLatestLiveNoticeOfThePlatform() throws Exception {
        assertThat(notices.appRequirement("ios").minVersion()).isNull();
        UUID old = UUID.randomUUID();
        notices.publish(old, new DeveloperNoticeService.Draft("옛", "b", NOW.minusSeconds(60), null, "2.0.0",
                "3.0.0"), "member-1");
        when(clock.instant()).thenReturn(NOW.plusSeconds(10));
        UUID latest = UUID.randomUUID();
        notices.publish(latest, new DeveloperNoticeService.Draft("최신", "b", NOW, null, "0.0.0", null), "member-1");
        // 다른 플랫폼 min 만 있는 더 최신 공지, 기간 전·후 공지는 빠진다.
        when(clock.instant()).thenReturn(NOW.plusSeconds(20));
        notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft("안드", "b", NOW, null, null, "9.9.9"),
                "member-1");
        notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft("예약", "b", NOW.plusSeconds(3600), null,
                "8.0.0", null), "member-1");
        notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft("종료", "b", NOW.minusSeconds(60),
                NOW.plusSeconds(21), "7.0.0", null), "member-1");
        when(clock.instant()).thenReturn(NOW.plusSeconds(30));
        var ios = notices.appRequirement("ios");
        assertThat(ios.minVersion()).isEqualTo("0.0.0");
        assertThat(ios.publicationId()).isEqualTo(latest);
        assertThat(ios.title()).isEqualTo("최신");
        assertThat(notices.appRequirement("android").minVersion()).isEqualTo("9.9.9");
        // 최신을 철회하면 이전 공지로 돌아간다.
        notices.withdraw(latest, "member-1");
        assertThat(notices.appRequirement("ios").publicationId()).isEqualTo(old);
        assertThatThrownBy(() -> notices.appRequirement("web")).isInstanceOf(ContentException.class);
        assertThatThrownBy(() -> notices.appRequirement(null)).isInstanceOf(ContentException.class);
    }

    @Test
    void earlierPublishedFutureStartBeatsLaterPublishedImmediateOnceItStarts() {
        // 어제 게시한 다음 주 시작(3.0.0)과 오늘 게시한 즉시(2.5.0).
        when(clock.instant()).thenReturn(NOW.minusSeconds(86400));
        notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft("다음 주", "b", NOW.plusSeconds(7 * 86400),
                null, "3.0.0", null), "member-1");
        when(clock.instant()).thenReturn(NOW);
        notices.publish(UUID.randomUUID(), new DeveloperNoticeService.Draft("즉시", "b", NOW, null, "2.5.0", null),
                "member-1");
        assertThat(notices.appRequirement("ios").minVersion()).isEqualTo("2.5.0");
        when(clock.instant()).thenReturn(NOW.plusSeconds(7 * 86400));
        assertThat(notices.appRequirement("ios").minVersion()).isEqualTo("3.0.0");
    }

    private long count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class);
    }

    private DeveloperNoticeService.Draft draft(Instant starts, Instant ends) {
        return new DeveloperNoticeService.Draft("개발자 소식", "검토한 본문", starts, ends, null, null);
    }

    /** published_at 은 게시 시각이라 시계를 그 시각으로 옮겨 게시한다. */
    private UUID publishAt(Instant at, DeveloperNoticeService.Draft draft) {
        UUID id = UUID.randomUUID();
        when(clock.instant()).thenReturn(at);
        notices.publish(id, draft, "member-1");
        return id;
    }

    private MockHttpServletRequestBuilder noticesRequest(UUID reader) {
        return get(NOTICES.formatted(reader)).header("Authorization", "Bearer content-test-business")
                .header("X-User-Id", reader.toString());
    }

    private record Walk(List<String> ids, List<Integer> sizes) { }

    /** 공개 경로를 앵커 없이 시작해 hasMore 가 꺼질 때까지 읽는다 — Business 처럼 마지막 행의 두 값을 되돌려 보낸다. */
    private Walk walk(UUID reader, int limit) throws Exception {
        Walk walk = new Walk(new ArrayList<>(), new ArrayList<>());
        String afterPublishedAt = null;
        String afterId = null;
        boolean more = true;
        while (more) {
            assertThat(walk.sizes()).as("끝나지 않는 이어 읽기").hasSizeLessThan(200);
            var request = noticesRequest(reader).param("limit", Integer.toString(limit));
            if (afterId != null) {
                request.param("afterPublishedAt", afterPublishedAt).param("afterId", afterId);
            }
            String body = mvc.perform(request).andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();
            List<String> ids = JsonPath.read(body, "$.items[*].publicationId");
            List<String> published = JsonPath.read(body, "$.items[*].publishedAt");
            walk.ids().addAll(ids);
            walk.sizes().add(ids.size());
            more = JsonPath.<Boolean>read(body, "$.hasMore");
            if (more) {
                afterPublishedAt = published.get(published.size() - 1);
                afterId = ids.get(ids.size() - 1);
            }
        }
        return walk;
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

    @Test
    void environmentContractUsesTheActualDatabaseMarker() throws Exception {
        var environment = new org.springframework.mock.env.MockEnvironment();
        environment.setActiveProfiles("prod");
        var controller = new InternalContentAdminController(notices, history, reviews,
                construction,
                environment, jdbc);
        var http = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        String database = jdbc.queryForObject("SELECT current_database()", String.class);
        // 테스트 컨테이너의 컨텍스트 전용 DB에만 표식을 설정한다.
        assertThat(database).matches("ctx_[a-f0-9]+");
        jdbc.execute("ALTER DATABASE " + database + " SET gromo.environment='prod'");
        // 실패 행(version 999)은 success 필터가, 성공 행 '1.5'(문자열로는 최대 버전보다 작음)는
        // installed_rank 정렬이 지켜야 한다. 기대값은 마지막 rank 의 성공 행 '1.5'.
        int rank = jdbc.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class);
        String insertHistory = "INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,"
                + "installed_by,execution_time,success) VALUES(?,?,?,?,?,?,?,?)";
        jdbc.update(insertHistory, rank + 1, "1.5", "t", "SQL", "t1.sql", "t", 1, true);
        jdbc.update(insertHistory, rank + 2, "999", "t", "SQL", "t2.sql", "t", 1, false);
        try {
            http.perform(get(ADMIN + "/environment")).andExpect(status().isOk())
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                            "$.environment").value("prod"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                            "$.contractVersion").value("1"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                            "$.schemaVersion").value("1.5"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath(
                            "$.capabilities").value(org.hamcrest.Matchers.contains("content.publication.v1",
                                    "content.history.v1", "content.notice.withdraw.v1",
                                    "content.app-requirements.v1",
                                    "construction.policy.v1", "focus.policy.v1")));
            jdbc.execute("ALTER DATABASE " + database + " SET gromo.environment='dev'");
            assertThatThrownBy(controller::environment).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("DB 환경");
        } finally {
            jdbc.update("DELETE FROM flyway_schema_history WHERE installed_rank > ?", rank);
            jdbc.execute("ALTER DATABASE " + database + " RESET gromo.environment");
        }
    }
}
