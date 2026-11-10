package com.oneorthree.phone.internal;

import com.jayway.jsonpath.JsonPath;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.content.exception.ContentException;
import com.oneorthree.phone.content.service.ContentJson;
import com.oneorthree.phone.content.service.DeveloperNoticeService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 공지 대상 플랫폼(GROMO-2849): 운영 V0+후속 PostgreSQL에서 게시 규칙·플랫폼별 조회·표시를 검증한다. */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class DeveloperNoticeTargetPlatformIntegrationTest {
    private static final Instant NOW = Instant.parse("2034-05-10T01:00:00Z");
    private static final String NOTICES = "/internal/users/%s/developer-notices";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("internal.api.callers.console.token", () -> "platform-test-console");
        registry.add("internal.api.callers.console.console-actor", () -> "member-1");
        registry.add("internal.api.callers.console.allow[0]", () -> "GET /internal/admin/content/notices");
        registry.add("internal.api.callers.console.allow[1]", () -> "PUT /internal/admin/content/notices/*");
        registry.add("internal.api.callers.business.token", () -> "platform-test-business");
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/users/*/developer-notices");
        registry.add("internal.api.callers.business.allow[1]", () -> "GET /internal/users/*/developer-notices/*");
    }

    @Autowired DeveloperNoticeService notices;
    @Autowired JdbcTemplate jdbc;
    @Autowired MockMvc mvc;
    @Autowired UserRepository users;
    @MockitoBean Clock clock;

    @BeforeEach
    void reset() {
        when(clock.instant()).thenReturn(NOW);
        when(clock.getZone()).thenReturn(ZonePolicy.KST);
        when(clock.withZone(any())).thenAnswer(call -> Clock.fixed(NOW, call.getArgument(0)));
        jdbc.execute("TRUNCATE developer_notices, content_publications");
    }

    private DeveloperNoticeService.Draft draft(String ios, String android, String target) {
        return new DeveloperNoticeService.Draft("제목", "본문", NOW.minusSeconds(60), null, ios, android, target);
    }

    private UUID publish(Instant at, String target) {
        UUID id = UUID.randomUUID();
        when(clock.instant()).thenReturn(at);
        notices.publish(id, draft(null, null, target), "member-1");
        when(clock.instant()).thenReturn(NOW);
        return id;
    }

    @Test
    void publishDerivesOrValidatesTheTargetPlatform() {
        assertThat(notices.publish(UUID.randomUUID(), draft(null, null, null), "member-1").targetPlatform()).isEqualTo("ALL");
        assertThat(notices.publish(UUID.randomUUID(), draft("2.0.0", null, null), "member-1").targetPlatform())
                .isEqualTo("IOS");
        assertThat(notices.publish(UUID.randomUUID(), draft(null, "2.0.0", null), "member-1").targetPlatform())
                .isEqualTo("ANDROID");
        assertThat(notices.publish(UUID.randomUUID(), draft("2.0.0", "2.0.1", null), "member-1").targetPlatform())
                .isEqualTo("ALL");
        for (String target : new String[]{"ALL", "IOS", "ANDROID"}) {
            assertThat(notices.publish(UUID.randomUUID(), draft(null, null, target), "member-1").targetPlatform())
                    .isEqualTo(target);
        }
        assertThat(notices.publish(UUID.randomUUID(), draft("2.0.0", null, "IOS"), "member-1").targetPlatform())
                .isEqualTo("IOS");
        assertThat(notices.publish(UUID.randomUUID(), draft("2.0.0", "2.0.1", "ALL"), "member-1").targetPlatform())
                .isEqualTo("ALL");
        assertThat(jdbc.queryForList("SELECT DISTINCT target_platform FROM developer_notices", String.class))
                .containsExactlyInAnyOrder("ALL", "IOS", "ANDROID");

        for (DeveloperNoticeService.Draft bad : List.of(draft("2.0.0", null, "ANDROID"),
                draft("2.0.0", null, "ALL"), draft(null, "2.0.0", "IOS"), draft("2.0.0", "2.0.1", "IOS"),
                draft(null, null, "ios"), draft(null, null, "Android"), draft(null, null, "WEB"),
                draft(null, null, ""))) {
            assertThatThrownBy(() -> notices.publish(UUID.randomUUID(), bad, "member-1")).as(bad.toString())
                    .isInstanceOf(ContentException.class);
        }
    }

    @Test
    void anOldShapeDraftKeepsItsDigestAndReplaysTheFirstResult() {
        var old = new DeveloperNoticeService.Draft("t", "b", Instant.parse("2026-10-29T00:00:00Z"), null, null, null);
        assertThat(ContentJson.write(old)).isEqualTo(
                "{\"title\":\"t\",\"body\":\"b\",\"startsAt\":\"2026-10-29T00:00:00Z\",\"endsAt\":null}");
        UUID id = UUID.randomUUID();
        var first = notices.publish(id, old, "member-1");
        assertThat(notices.publish(id, old, "member-2")).isEqualTo(first);

        // 대상 열 이전에 저장된 결과(targetPlatform 없음)도 같은 digest 로 다시 읽히고 ALL 이 된다.
        UUID stored = UUID.randomUUID();
        var oldDraft = new DeveloperNoticeService.Draft("옛", "b", NOW.minusSeconds(60), null, null, null);
        jdbc.update("INSERT INTO content_publications VALUES (?,?,?,?::jsonb,?,?)", stored, "NOTICE",
                ContentJson.digest(oldDraft), "{\"publicationId\":\"" + stored + "\",\"title\":\"옛\",\"body\":\"b\","
                        + "\"startsAt\":\"" + NOW.minusSeconds(60) + "\",\"publishedAt\":\"" + NOW + "\"}",
                "member-1", Timestamp.from(NOW));
        assertThat(notices.publish(stored, oldDraft, "member-2").targetPlatform()).isEqualTo("ALL");
    }

    @Test
    void userListFiltersByPlatformAndMarksTitlesOnlyWhenThePlatformIsUnknown() throws Exception {
        UUID all = publish(NOW.minusSeconds(30), "ALL");
        UUID ios = publish(NOW.minusSeconds(20), "IOS");
        UUID android = publish(NOW.minusSeconds(10), "ANDROID");
        UUID reader = users.save(User.builder().nickname("플랫폼 독자-" + UUID.randomUUID()).build()).getId();

        assertThat(notices.list(null, null, 100, "ios").items()).extracting(n -> n.publicationId())
                .containsExactly(ios, all);
        assertThat(notices.list(null, null, 100, "android").items()).extracting(n -> n.publicationId())
                .containsExactly(android, all);
        assertThat(notices.list(null, null, 100, "ios").items()).extracting(n -> n.title())
                .containsOnly("제목");
        var unknown = notices.list(null, null, 100, null).items();
        assertThat(unknown).extracting(n -> n.publicationId()).containsExactly(android, ios, all);
        assertThat(unknown).extracting(n -> n.title()).containsExactly("[Android] 제목", "[iOS] 제목", "제목");
        assertThat(notices.list(null, null, 100).items()).extracting(n -> n.title())
                .containsExactly("[Android] 제목", "[iOS] 제목", "제목");
        // 관리 목록은 표시 없이 대상 값을 싣는다.
        assertThat(notices.list(true).items()).extracting(n -> n.title()).containsOnly("제목");
        assertThat(notices.list(true).items()).extracting(n -> n.targetPlatform())
                .containsExactly("ANDROID", "IOS", "ALL");

        String body = mvc.perform(request(reader, "ios")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        assertThat(JsonPath.<List<String>>read(body, "$.items[*].targetPlatform")).containsExactly("IOS", "ALL");
        assertThat(JsonPath.<List<String>>read(body, "$.items[*].title")).containsOnly("제목");
        mvc.perform(request(reader, null)).andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("[Android] 제목"));
        for (String bad : new String[]{"IOS", "web", "", "ios,android"}) {
            mvc.perform(request(reader, bad)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
    }

    @Test
    void filteredPagesKeepHasMoreAndTheKeysetBoundary() {
        // 최신순: A1(ANDROID) I1 A2 L1(ALL) I2 A3 I3
        List<UUID> order = new ArrayList<>();
        String[] targets = {"ANDROID", "IOS", "ANDROID", "ALL", "IOS", "ANDROID", "IOS"};
        for (int i = 0; i < targets.length; i++) {
            order.add(publish(NOW.minusSeconds(10L * (i + 1)), targets[i]));
        }
        List<UUID> expected = List.of(order.get(1), order.get(3), order.get(4), order.get(6));
        List<UUID> seen = new ArrayList<>();
        Instant afterAt = null;
        UUID afterId = null;
        List<Boolean> more = new ArrayList<>();
        do {
            var page = notices.list(afterAt, afterId, 2, "ios");
            page.items().forEach(n -> seen.add(n.publicationId()));
            more.add(page.hasMore());
            var last = page.items().get(page.items().size() - 1);
            afterAt = last.publishedAt();
            afterId = last.publicationId();
            if (!page.hasMore()) {
                break;
            }
        } while (true);
        assertThat(seen).containsExactlyElementsOf(expected);
        assertThat(more).containsExactly(true, false);
        // 정확히 limit 건이면 hasMore 는 false 다.
        assertThat(notices.list(null, null, 4, "ios").hasMore()).isFalse();
        assertThat(notices.list(null, null, 3, "ios").hasMore()).isTrue();
    }

    @Test
    void userGetHidesOtherPlatformNoticesAndMarksTheTitleWithoutPlatform() throws Exception {
        UUID ios = publish(NOW.minusSeconds(20), "IOS");
        UUID all = publish(NOW.minusSeconds(10), "ALL");
        UUID reader = users.save(User.builder().nickname("플랫폼 독자-" + UUID.randomUUID()).build()).getId();

        assertThat(notices.get(ios, "ios").title()).isEqualTo("제목");
        assertThatThrownBy(() -> notices.get(ios, "android")).isInstanceOf(ContentException.class);
        assertThat(notices.get(ios, null).title()).isEqualTo("[iOS] 제목");
        assertThat(notices.get(all, "android").title()).isEqualTo("제목");

        mvc.perform(detail(reader, ios, "android")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mvc.perform(detail(reader, ios, "ios")).andExpect(status().isOk())
                .andExpect(jsonPath("$.targetPlatform").value("IOS")).andExpect(jsonPath("$.title").value("제목"));
        mvc.perform(detail(reader, ios, null)).andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("[iOS] 제목"));
        mvc.perform(detail(reader, all, null)).andExpect(jsonPath("$.title").value("제목"));
        mvc.perform(detail(reader, ios, "web")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }

    private String body(String extra) {
        return "{\"title\":\"패치\",\"body\":\"본문\",\"startsAt\":\"" + NOW.minusSeconds(60)
                + "\",\"endsAt\":null" + extra + "}";
    }

    private MockHttpServletRequestBuilder publishRequest(UUID id, String json) {
        return put("/internal/admin/content/notices/" + id).header("Authorization", "Bearer platform-test-console")
                .contentType(MediaType.APPLICATION_JSON).content(json);
    }

    @Test
    void publishOverHttpCarriesTheTargetPlatformAndRejectsAConflictWithMinVersions() throws Exception {
        UUID id = UUID.randomUUID();
        mvc.perform(publishRequest(id, body(",\"targetPlatform\":\"IOS\"")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.targetPlatform").value("IOS"))
                .andExpect(jsonPath("$.title").value("패치"));
        mvc.perform(get("/internal/admin/content/notices").header("Authorization", "Bearer platform-test-console"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].publicationId").value(id.toString()))
                .andExpect(jsonPath("$.items[0].targetPlatform").value("IOS"))
                .andExpect(jsonPath("$.items[0].title").value("패치"));
        // 최소 버전 없이 targetPlatform 도 없으면 ALL.
        mvc.perform(publishRequest(UUID.randomUUID(), body("")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.targetPlatform").value("ALL"));

        UUID conflict = UUID.randomUUID();
        mvc.perform(publishRequest(conflict, body(",\"minIosVersion\":\"2.0.0\",\"targetPlatform\":\"ANDROID\"")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        mvc.perform(publishRequest(conflict, body(",\"targetPlatform\":\"ios\"")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM developer_notices WHERE publication_id=?",
                Integer.class, conflict)).isZero();
    }

    @Test
    void httpKeysetPageWorksTogetherWithThePlatformFilter() throws Exception {
        // 최신순: A1(ANDROID) I1 L1(ALL) I2 A2 I3 → ios: I1 L1 I2 I3
        String[] targets = {"ANDROID", "IOS", "ALL", "IOS", "ANDROID", "IOS"};
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < targets.length; i++) {
            ids.add(publish(NOW.minusSeconds(10L * (i + 1)), targets[i]));
        }
        UUID reader = users.save(User.builder().nickname("플랫폼 독자-" + UUID.randomUUID()).build()).getId();
        String first = mvc.perform(request(reader, "ios").param("limit", "2")).andExpect(status().isOk())
                .andExpect(jsonPath("$.hasMore").value(true)).andReturn().getResponse().getContentAsString();
        assertThat(JsonPath.<List<String>>read(first, "$.items[*].publicationId"))
                .containsExactly(ids.get(1).toString(), ids.get(2).toString());
        String at = JsonPath.read(first, "$.items[1].publishedAt");
        mvc.perform(request(reader, "ios").param("afterPublishedAt", at).param("afterId", ids.get(2).toString())
                        .param("limit", "2"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.hasMore").value(false))
                .andExpect(jsonPath("$.items[*].publicationId").value(
                        org.hamcrest.Matchers.contains(ids.get(3).toString(), ids.get(5).toString())));
    }

    @Test
    void aWithdrawnPlatformNoticeIsHiddenFromTheListAndTheSingleGet() throws Exception {
        UUID ios = publish(NOW.minusSeconds(10), "IOS");
        UUID reader = users.save(User.builder().nickname("플랫폼 독자-" + UUID.randomUUID()).build()).getId();
        assertThat(notices.list(null, null, 100, "ios").items()).hasSize(1);
        notices.withdraw(ios, "member-1");
        assertThat(notices.list(null, null, 100, "ios").items()).isEmpty();
        assertThatThrownBy(() -> notices.get(ios, "ios")).isInstanceOf(ContentException.class);
        mvc.perform(request(reader, "ios")).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(detail(reader, ios, "ios")).andExpect(status().isNotFound());
    }

    @Test
    void appRequirementIsUnchangedByTheTargetPlatform() {
        notices.publish(UUID.randomUUID(), draft("2.1.0", null, null), "member-1");
        assertThat(notices.appRequirement("ios").minVersion()).isEqualTo("2.1.0");
        assertThat(notices.appRequirement("android").minVersion()).isNull();
    }

    private MockHttpServletRequestBuilder request(UUID reader, String platform) {
        var request = get(NOTICES.formatted(reader)).header("Authorization", "Bearer platform-test-business")
                .header("X-User-Id", reader.toString());
        return platform == null ? request : request.param("platform", platform);
    }

    private MockHttpServletRequestBuilder detail(UUID reader, UUID id, String platform) {
        var request = get(NOTICES.formatted(reader) + "/" + id)
                .header("Authorization", "Bearer platform-test-business").header("X-User-Id", reader.toString());
        return platform == null ? request : request.param("platform", platform);
    }
}
