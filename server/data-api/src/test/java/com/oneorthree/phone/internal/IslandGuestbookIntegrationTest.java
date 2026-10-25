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
import com.oneorthree.phone.internal.dto.IslandGuestbookViews;
import com.oneorthree.phone.internal.service.IslandGuestbookService;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
    IslandManagementService management;
    @Autowired
    IslandGuestbookService guestbook;
    @Autowired
    PlatformTransactionManager transactions;
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
    @Autowired
    ObjectMapper mapper;

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
        assertThat(jdbc.queryForObject("select greeting from islands where id=?", String.class, islandId)).isNull();
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
    @DisplayName("인사말 길이는 앞뒤 공백을 자른 뒤 코드포인트로 센다 — 40자에 공백이 붙어도 200(공백은 잘려 저장), 41자는 400, 공백뿐이면 기본 문구")
    void greetingLengthIsCountedAfterStrip() throws Exception {
        Island island = island(false);
        String forty = "🐟".repeat(40);

        // 반각 공백 + 전각 공백(U+3000) + EM SPACE(U+2003)가 앞뒤에 붙은 40자 — 자르면 40자라 통과한다.
        patchGreeting(island.host, island.id, "  \\u3000" + forty + "\\u2003 ").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).as("공백은 잘려 저장된다").isEqualTo(forty);
        IslandSummaryView view = islands.view(island.id, newUser()).visitor();
        assertThat(view.greeting()).isEqualTo(forty);
        assertThat(view.greetingIsDefault()).isFalse();

        // 자른 뒤 41자는 공백과 무관하게 400 이고 이전 값이 남는다.
        patchGreeting(island.host, island.id, "  " + forty + "🐟 ").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(storedGreeting(island.id)).isEqualTo(forty);

        // 공백뿐이면 «빈 값» 이다 — 400 이 아니라 기본 문구로 되돌린다.
        patchGreeting(island.host, island.id, "   ").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).isNull();
        assertThat(islands.view(island.id, newUser()).visitor().greetingIsDefault()).isTrue();
    }

    @Test
    @DisplayName("인사말은 한 줄이다 — 중간의 줄바꿈·탭·널·DEL·C1·줄/문단 구분자·양방향 제어문자는 400 INVALID_REQUEST 이고 값이 남지 않으며, 앞뒤 개행·탭은 잘려 200")
    void greetingMustBeSingleLine() throws Exception {
        Island island = island(false);

        // JSON 이스케이프로 넘긴다 — 본문 파서가 실제 제어문자로 풀어 섬 이름과 같은 NAME_PATTERN 에 걸린다.
        for (String escaped : List.of("줄1\\n줄2", "줄1\\r\\n줄2", "탭\\t탭", "널\\u0000널", "삭제\\u007f삭제", "C1\\u0085제어",
                "줄\\u2028구분", "문단\\u2029구분", "방향\\u202e뒤집기")) {
            patchGreeting(island.host, island.id, escaped).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        // 공백이 아닌 제어문자(널·DEL·C1·양방향)는 앞뒤에 붙어도 잘리지 않아 거절된다.
        for (String escaped : List.of("끝널\\u0000", "\\u007f앞DEL", "끝C1\\u0085", "\\u202e앞방향")) {
            patchGreeting(island.host, island.id, escaped).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        assertThat(storedGreeting(island.id)).as("거절된 인사말은 저장되지 않는다").isNull();

        // 앞뒤 개행·탭·줄 구분자는 공백처럼 잘려 통과하고 저장값은 잘린 한 줄이다(방명록 본문과 같다).
        patchGreeting(island.host, island.id, "끝줄바꿈\\n").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).isEqualTo("끝줄바꿈");
        patchGreeting(island.host, island.id, "\\n앞줄바꿈").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).isEqualTo("앞줄바꿈");
        patchGreeting(island.host, island.id, "\\n\\t 함께해요 \\r\\n\\u2028").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).isEqualTo("함께해요");

        // 이모지·문장부호가 든 한 줄은 그대로 통과한다.
        patchGreeting(island.host, island.id, "함께 집중해요! 🐟 (환영)").andExpect(status().isOk());
        assertThat(storedGreeting(island.id)).isEqualTo("함께 집중해요! 🐟 (환영)");
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
    @DisplayName("금칙어 인사말·방명록은 내부 HTTP 표면에서 400 BANNED_WORD 봉투로 거절되고 저장되지 않는다")
    void bannedWordsAreRejectedOverHttp() throws Exception {
        Island island = island(true);

        patchGreeting(island.host, island.id, "너 씨발").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BANNED_WORD"));
        assertThat(jdbc.queryForObject("select greeting from islands where id=?", String.class, island.id)).isNull();

        write(island.visitor, island.id, "씨 발!!").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BANNED_WORD"));
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isZero();
        // 거절은 «오늘 썼다» 로 치지 않는다 — 같은 날 멀쩡한 글은 그대로 쓸 수 있다.
        write(island.visitor, island.id, "같이 집중해요").andExpect(status().isCreated());
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
                .andExpect(jsonPath("$.items").isEmpty())
                .andExpect(jsonPath("$.hasMore").value(false));
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
        // 공백뿐인 본문은 strip 뒤 비어 400 이다 — trim 이 아니라 strip 이라 탭·개행·전각 공백(U+3000)·EM SPACE 도 같다.
        for (String blank : List.of("", " ", "   ", "\\t", "\\n", "\\u3000", " \\u2003\\u3000 ")) {
            write(island.member, island.id, blank).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        write(newGuest(), island.id, "게스트").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("SOCIAL_LOGIN_REQUIRED"));
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("방명록 본문은 한 줄이다 — 중간 줄바꿈·CRLF·탭·NUL·U+2028·U+202E 는 400 INVALID_REQUEST 이고 저장되지 않으며, 이모지·문장부호 한 줄은 201")
    void guestbookContentMustBeSingleLine() throws Exception {
        Island island = island(true);

        // JSON 이스케이프로 넘긴다 — 본문 파서가 실제 제어문자로 풀어 섬 이름·인사말과 같은 NAME_PATTERN 에 걸린다.
        // 같은 작성자로 계속 시도해도 된다: 거절은 «오늘 썼다» 로 치지 않으므로 마지막 정상 글이 201 이다.
        for (String escaped : List.of("줄1\\n줄2", "줄1\\r\\n줄2", "탭\\t탭", "널\\u0000널", "줄\\u2028구분",
                "방향\\u202e뒤집기")) {
            write(island.visitor, island.id, escaped).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id))
                .as("거절된 본문은 저장되지 않는다").isZero();

        // 이모지·문장부호가 든 한 줄은 그대로 통과한다.
        write(island.visitor, island.id, "안녕! 🐟 (환영)").andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value("안녕! 🐟 (환영)"));

        // 판정은 자른 뒤 값에 한다 — 앞뒤 개행·탭은 잘려 통과하고 저장값은 잘린 한 줄이다. 공백·개행뿐이면 400 이다
        // (contentValidationAndGuestGuard).
        write(island.member, island.id, "\\n\\t 반가워요 \\r\\n").andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value("반가워요"));
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isEqualTo(2);
    }

    @Test
    @DisplayName("본문 길이는 앞뒤 공백을 자른 뒤 코드포인트로 센다 — 20자에 공백이 붙어도 201(공백은 잘려 저장), 21자는 400")
    void guestbookContentLengthIsCountedAfterStrip() throws Exception {
        Island island = island(true);
        String twenty = "🐟".repeat(20);

        write(island.visitor, island.id, "  " + twenty + "\\u3000 ").andExpect(status().isCreated())
                .andExpect(jsonPath("$.content").value(twenty));
        write(island.member, island.id, " " + twenty + "🐟 ").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and content=?", island.id,
                twenty)).isEqualTo(1);
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isEqualTo(1);
    }

    @Test
    @DisplayName("31번째 글을 써도 앞선 글이 모두 남고 다음 페이지로 읽을 수 있다")
    void keepsAllEntriesBeyondThirty() throws Exception {
        Island island = island(true);
        List<UUID> authors = java.util.stream.IntStream.range(0, 31).mapToObj(i -> newUser()).toList();
        for (int i = 0; i < authors.size(); i++) {
            write(authors.get(i), island.id, "글 " + i).andExpect(status().isCreated());
        }

        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is null",
                island.id)).isEqualTo(31);
        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is not null",
                island.id)).isZero();
        IslandGuestbookViews.Page first = readPage(island.visitor, island.id, null);
        assertThat(first.items()).hasSize(30);
        assertThat(first.hasMore()).isTrue();
        IslandGuestbookViews.Page second = readPage(island.visitor, island.id, first.items().get(29));
        assertThat(second.items()).hasSize(1);
        assertThat(second.items().get(0).content()).isEqualTo("글 0");
        assertThat(second.hasMore()).isFalse();
    }

    @Test
    @DisplayName("29개인 섬에 서로 다른 두 작성자가 동시에 쓰면 기존 글과 새 글 31개가 모두 남는다")
    void concurrentWritesFromDifferentAuthorsKeepAllEntries() throws Exception {
        Island island = island(true);
        seedFillerEntries(island.id, 29);
        UUID first = newUser();
        UUID second = newUser();
        List<Throwable> failures = race(() -> guestbook.write(island.id, first, "동시 A"),
                () -> guestbook.write(island.id, second, "동시 B"));

        assertThat(failures).isEmpty();
        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is null",
                island.id)).as("활성 글").isEqualTo(31);
        assertThat(count("select count(*) from island_guestbook_entries where island_id=? and deleted_at is not null",
                island.id)).isZero();
    }

    @ParameterizedTest
    @ValueSource(ints = {0, 30, 31, 61})
    @DisplayName("같은 시각의 글도 id 내림차순으로 30개씩 중복·누락 없이 끝까지 읽는다")
    void pagesAllEntriesWithTiedTimestamps(int total) throws Exception {
        Island island = island(true);
        seedFillerEntries(island.id, total);
        jdbc.update("update island_guestbook_entries set created_at=? where island_id=?",
                java.sql.Timestamp.from(Instant.parse("2020-01-01T00:00:00.123456Z")), island.id);
        List<UUID> expected = jdbc.queryForList("select id from island_guestbook_entries where island_id=? "
                + "order by created_at desc, id desc", UUID.class, island.id);
        List<UUID> actual = new ArrayList<>();
        IslandGuestbookViews.Item anchor = null;
        for (int offset = 0; offset <= total; offset += 30) {
            IslandGuestbookViews.Page page = readPage(island.visitor, island.id, anchor);
            assertThat(page.boardBuilt()).isTrue();
            assertThat(page.items()).hasSize(Math.min(30, total - offset));
            assertThat(page.hasMore()).isEqualTo(total - offset > 30);
            actual.addAll(page.items().stream().map(IslandGuestbookViews.Item::id).toList());
            if (!page.hasMore()) {
                break;
            }
            anchor = page.items().get(page.items().size() - 1);
        }
        assertThat(actual).containsExactlyElementsOf(expected).doesNotHaveDuplicates();
    }

    @Test
    @DisplayName("페이지 사이에 새 글이 생기고 경계 글·다음 쪽 글이 삭제돼도 남은 과거 글을 이어 읽는다")
    void keysetSurvivesInsertionAndDeletion() throws Exception {
        Island island = island(true);
        seedFillerEntries(island.id, 61);
        List<UUID> expected = jdbc.queryForList("select id from island_guestbook_entries where island_id=? "
                + "order by created_at desc, id desc", UUID.class, island.id);
        IslandGuestbookViews.Page first = readPage(island.visitor, island.id, null);
        IslandGuestbookViews.Item anchor = first.items().get(29);
        remove(island.host, island.id, anchor.id().toString()).andExpect(status().isOk());
        remove(island.host, island.id, expected.get(35).toString()).andExpect(status().isOk());
        write(island.visitor, island.id, "새 글").andExpect(status().isCreated());

        IslandGuestbookViews.Page second = readPage(island.visitor, island.id, anchor);

        assertThat(second.items().stream().map(IslandGuestbookViews.Item::id).toList())
                .containsExactlyElementsOf(expected.subList(30, 61).stream()
                        .filter(id -> !id.equals(expected.get(35))).toList());
        assertThat(second.hasMore()).isFalse();
    }

    @Test
    @DisplayName("내부 페이지 경계는 시각·id 한 쌍이고 크기는 1~100이다 — 잘못된 요청은 400")
    void invalidInternalPageBoundariesAreRejected() throws Exception {
        Island island = island(true);
        for (String query : List.of("afterCreatedAt=2020-01-01T00:00:00Z", "afterId=" + UUID.randomUUID(),
                "limit=0", "limit=101")) {
            mvc.perform(get("/internal/islands/" + island.id + "/guestbook?" + query)
                            .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", island.visitor))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("ILLEGAL_ARGUMENT"));
        }
    }

    @Test
    @DisplayName("쓰기는 섬 행 잠금 아래에서 돈다 — 다른 트랜잭션이 섬 행을 쥐고 있으면 풀릴 때까지 기다린다")
    void writeWaitsForTheIslandRowLock() throws Exception {
        Island island = island(true);
        CountDownLatch held = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> holder = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                // NO KEY UPDATE — 방명록 삽입의 FK 검사(KEY SHARE)와는 부딪치지 않고, 섬 행 잠금(lockGroup)하고만
                // 부딪친다. FOR UPDATE 로 쥐면 잠금이 없어도 삽입이 FK 검사에서 막혀 이 테스트가 잠금을 증명하지 못한다.
                jdbc.queryForObject("select id from islands where id=? for no key update", UUID.class, island.id);
                held.countDown();
                await(release);
            }));
            assertThat(held.await(10, TimeUnit.SECONDS)).isTrue();

            Future<?> writer = pool.submit(() -> guestbook.write(island.id, island.visitor, "기다려요"));
            assertThatThrownBy(() -> writer.get(1, TimeUnit.SECONDS))
                    .as("섬 행을 쥔 트랜잭션이 끝나기 전에는 쓰기가 끝나지 않는다").isInstanceOf(TimeoutException.class);
            assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id)).isZero();

            release.countDown();
            writer.get(10, TimeUnit.SECONDS);
            holder.get(10, TimeUnit.SECONDS);
            assertThat(count("select count(*) from island_guestbook_entries where island_id=?", island.id))
                    .isEqualTo(1);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
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

    @Test
    @DisplayName("섬이 닫혀(purge) 방명록이 지워진다 — 그 섬 것만이고, 섬 행은 소프트 삭제라 CASCADE 가 돌지 않는다")
    void closingTheIslandPurgesItsGuestbookOnly() throws Exception {
        UUID host = newUser();
        UUID islandId = islands.create(host, new CreateIslandCommandRequest("닫힐", null, false, null),
                UUID.randomUUID()).id();
        jdbc.update("insert into island_facilities (island_id, building_id, status, cost, cost_revision) "
                + "values (?, 'board', 'COMPLETED', 0, 1)", islandId);
        write(newUser(), islandId, "안녕").andExpect(status().isCreated());
        // 다른 섬의 글 — WHERE island_id 가 빠져 전부 지우는 실수를 잡는다.
        Island staying = island(true);
        write(staying.visitor, staying.id, "남을 글").andExpect(status().isCreated());
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", islandId)).isEqualTo(1);

        management.leave(host, islandId, UUID.randomUUID());

        assertThat(count("select count(*) from islands where id=? and deleted_at is not null", islandId))
                .as("삭제 묘비").isEqualTo(1);
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", islandId))
                .as("닫힌 섬의 방명록").isZero();
        assertThat(count("select count(*) from island_guestbook_entries where island_id=?", staying.id))
                .as("다른 섬의 방명록").isEqualTo(1);
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
        return jwt.extractUserId(auth.guestSession(java.util.UUID.randomUUID().toString()).accessToken());
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

    private IslandGuestbookViews.Page readPage(UUID actor, UUID islandId, IslandGuestbookViews.Item anchor)
            throws Exception {
        var request = get("/internal/islands/" + islandId + "/guestbook")
                .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", actor);
        if (anchor != null) {
            request.queryParam("afterCreatedAt", anchor.createdAt().toString())
                    .queryParam("afterId", anchor.id().toString());
        }
        String body = mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse()
                .getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        return mapper.readValue(body, IslandGuestbookViews.Page.class);
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

    /** 채움 작성자 한 명이 날짜를 달리해 쓴 오래된 글 {@code n} 개 — 유니크 키 (섬, 작성자, 날짜) 를 지킨다. */
    private void seedFillerEntries(UUID islandId, int n) {
        UUID filler = newUser();
        Instant base = Instant.parse("2020-01-01T00:00:00Z");
        for (int i = 0; i < n; i++) {
            jdbc.update("insert into island_guestbook_entries (id, island_id, author_id, content, written_on, "
                    + "created_at) values (?, ?, ?, ?, ?, ?)", UUID.randomUUID(), islandId, filler, "채움 " + i,
                    LocalDate.of(2026, 9, 1).plusDays(i), java.sql.Timestamp.from(base.plusSeconds(60L * i)));
        }
    }

    /** 두 쓰기를 동시에 출발시키고 실패만 모은다. */
    private static List<Throwable> race(Callable<?> left, Callable<?> right) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (Callable<?> task : List.of(left, right)) {
                futures.add(pool.submit(() -> {
                    start.await();
                    return task.call();
                }));
            }
            start.countDown();
            List<Throwable> failures = new ArrayList<>();
            for (Future<?> future : futures) {
                try {
                    future.get(30, TimeUnit.SECONDS);
                } catch (ExecutionException e) {
                    failures.add(e.getCause());
                }
            }
            return failures;
        } finally {
            pool.shutdownNow();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(30, TimeUnit.SECONDS)) {
                throw new IllegalStateException("latch timeout");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private String storedGreeting(UUID islandId) {
        return jdbc.queryForObject("select greeting from islands where id=?", String.class, islandId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
