package com.oneorthree.phone.internal;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.exception.FocusErrorCode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IslandCreatedView;
import com.oneorthree.phone.internal.dto.IslandDiscoverPageView;
import com.oneorthree.phone.internal.dto.IslandSearchPageView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.dto.IslandViewResponse;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserQueryService;
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

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 소속·탐색 6종 (GROMO-1759)을 <b>실제 Flyway PostgreSQL</b> 위에서 검증한다.
 *
 * <p>커서·trgm·md5 셔플이 전부 네이티브 SQL 이라 인메모리 DB 로는 의미가 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandMembershipIntegrationTest {

    private static final String TOKEN = "test-island-membership-business";
    private static final String SEED = "5eed0001";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/users/*/islands");
    }

    @Autowired
    IslandMembershipService islands;
    @Autowired
    FocusService legacyFocus;
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

    // ---------------------------------------------------------------- 1. 커서 페이징

    @Test
    @DisplayName("이름 검색 커서는 동률 거리에서도 항목을 빠뜨리거나 중복하지 않는다")
    void nameSearchCursorNeitherSkipsNorRepeatsAcrossIdenticalDistances() {
        UUID searcher = newUser();
        // 이름이 «전부 같다» — trgm 거리가 동률이라 id 동률키가 없으면 페이지 경계에서 섞인다.
        Set<UUID> expected = new LinkedHashSet<>();
        for (int i = 0; i < 7; i++) {
            expected.add(publicIsland("동률섬"));
        }
        giveCurrentIsland(searcher);

        List<UUID> seen = pageThroughSearch(searcher, "동률섬", 2);

        assertThat(seen).as("중복 없음").doesNotHaveDuplicates();
        assertThat(new HashSet<>(seen)).as("빠뜨림 없음").containsAll(expected);
    }

    @Test
    @DisplayName("검색어 없는 목록도 한 페이지 크기 1 로 전부 한 번씩만 돌려준다")
    void recentListCursorVisitsEveryIslandExactlyOnce() {
        UUID searcher = newUser();
        Set<UUID> expected = new LinkedHashSet<>();
        for (int i = 0; i < 5; i++) {
            expected.add(publicIsland("최신섬" + i));
        }
        giveCurrentIsland(searcher);

        List<UUID> seen = pageThroughSearch(searcher, null, 1);

        assertThat(seen).doesNotHaveDuplicates();
        assertThat(new HashSet<>(seen)).containsAll(expected);
    }

    @Test
    @DisplayName("종료·삭제·비공개 섬은 검색에 나오지 않는다")
    void searchHidesEndedDeletedAndPrivateIslands() {
        UUID searcher = newUser();
        UUID alive = publicIsland("생존섬");
        UUID ended = publicIsland("생존섬");
        UUID deleted = publicIsland("생존섬");
        UUID secret = island("생존섬", true, 10);
        jdbc.update("update groups set status='ENDED' where id=?", ended);
        jdbc.update("update groups set deleted_at=now() where id=?", deleted);
        giveCurrentIsland(searcher);

        Set<UUID> seen = new HashSet<>(pageThroughSearch(searcher, "생존섬", 50));

        assertThat(seen).contains(alive).doesNotContain(ended, deleted, secret);
    }

    // ---------------------------------------------------------------- 2. 전망대 가드

    @Test
    @DisplayName("현재 섬이 없으면 검색은 403 이고, 같은 사용자의 발견은 가드 없이 200 이다")
    void searchNeedsCurrentIslandButDiscoverDoesNot() {
        UUID rookie = newUser();
        publicIsland("첫섬");

        assertThatThrownBy(() -> islands.search(rookie, null, null, 20))
                .isInstanceOf(GroupException.class)
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.OBSERVATORY_LOCKED);

        IslandDiscoverPageView discovered = islands.discover(rookie, SEED, null, 10);
        assertThat(discovered.items()).isNotEmpty();
    }

    @Test
    @DisplayName("발견 후보는 승인제·만원·내 소속·강퇴 이력 섬을 제외한다")
    void discoverExcludesApprovalFullJoinedAndKickedIslands() {
        UUID hunter = newUser();
        UUID open = publicIsland("열린섬");
        UUID approval = island("승인섬", false, 10);
        jdbc.update("update groups set approval_required=true where id=?", approval);
        UUID full = island("만원섬", false, 1);
        joinAs(newUser(), full, GroupMemberRole.MEMBER);
        UUID mine = publicIsland("내섬");
        joinAs(hunter, mine, GroupMemberRole.MEMBER);
        UUID kicked = publicIsland("강퇴섬");
        joinAs(hunter, kicked, GroupMemberRole.MEMBER);
        jdbc.update("update group_members set is_left=true, left_reason='KICKED' "
                + "where group_id=? and user_id=?", kicked, hunter);

        Set<UUID> candidates = new HashSet<>(pageThroughDiscover(hunter, 50));

        assertThat(candidates).contains(open).doesNotContain(approval, full, mine, kicked);
    }

    @Test
    @DisplayName("같은 seed 는 같은 순서를 주고 커서는 후보를 중복·누락 없이 소진한다")
    void discoverOrderIsStableForOneSeedAndCursorExhaustsCandidates() {
        UUID hunter = newUser();
        Set<UUID> expected = new LinkedHashSet<>();
        for (int i = 0; i < 6; i++) {
            expected.add(publicIsland("발견섬" + i));
        }

        List<UUID> first = pageThroughDiscover(hunter, 2);
        List<UUID> again = pageThroughDiscover(hunter, 2);

        assertThat(first).doesNotHaveDuplicates();
        assertThat(new HashSet<>(first)).containsAll(expected);
        assertThat(again).as("같은 seed 면 순서까지 같다").isEqualTo(first);
    }

    // ---------------------------------------------------------------- 3. 범위 분기

    @Test
    @DisplayName("주민은 상세, 비소속은 공개 요약, 비공개 비소속은 403, 종료는 404 다")
    void islandViewScopeFollowsStoredMembershipOnly() {
        UUID owner = newUser();
        UUID visitor = newUser();
        UUID open = publicIsland("공개섬");
        joinAs(owner, open, GroupMemberRole.OWNER);

        IslandViewResponse asMember = islands.view(open, owner);
        assertThat(asMember.scope()).isEqualTo("member");
        assertThat(asMember.member().role()).isEqualTo("host");
        assertThat(asMember.visitor()).isNull();

        IslandViewResponse asVisitor = islands.view(open, visitor);
        assertThat(asVisitor.scope()).isEqualTo("visitor");
        assertThat(asVisitor.member()).as("방문자 응답에 주민 상세가 실리지 않는다").isNull();
        assertThat(asVisitor.visitor().membershipStatus()).isEqualTo("none");

        UUID secret = island("비밀섬", true, 10);
        assertThatThrownBy(() -> islands.view(secret, visitor))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);

        UUID ended = publicIsland("끝난섬");
        jdbc.update("update groups set status='ENDED' where id=?", ended);
        assertThatThrownBy(() -> islands.view(ended, visitor))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("role·isMember 를 쿼리로 넣어도 방문자 응답이 주민 상세로 바뀌지 않는다")
    void scopeCannotBeForcedByQueryParameters() throws Exception {
        UUID visitor = newUser();
        UUID open = publicIsland("조작섬");
        joinAs(newUser(), open, GroupMemberRole.OWNER);

        mvc.perform(get("/internal/islands/" + open)
                        .param("role", "host").param("isMember", "true").param("scope", "member")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", visitor.toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("visitor"))
                .andExpect(jsonPath("$.member").doesNotExist())
                .andExpect(jsonPath("$.visitor.membershipStatus").value("none"))
                .andExpect(jsonPath("$.visitor.role").doesNotExist())
                .andExpect(jsonPath("$.data").doesNotExist());
    }

    // ---------------------------------------------------------------- 4. 진행 중 세션 409

    @Test
    @DisplayName("진행 중 집중 세션이 있으면 생성도 이동도 409 다 — 생성으로 이동 가드를 우회할 수 없다")
    void liveFocusSessionBlocksBothCreateAndSwitch() {
        UUID user = newUser();
        IslandCreatedView home = islands.create(user, new CreateIslandCommandRequest("집중섬", null, false),
                UUID.randomUUID());
        UUID other = publicIsland("다른섬");
        joinAs(user, other, GroupMemberRole.MEMBER);

        // v0.3 수명주기 start 는 FocusSessionStartGate 가 아직 «항상 닫혀» 있다 — 그 게이트가 적은
        // 선행 조건 1번이 바로 이 티켓(현재 섬을 채우는 경로)이다. 그래서 오늘 실제로 만들어지는
        // 진행 세션인 «레거시 마커» 로 검증한다. 가드가 신·구 프로토콜을 가리지 않고 같은 조회
        // (endedAt=null) 로 잡는다는 것까지 여기서 함께 확인된다.
        legacyFocus.startFocusSession(user, new FocusSessionStartRequest(null, null));

        assertThatThrownBy(() -> islands.create(user,
                new CreateIslandCommandRequest("몰래섬", null, false), UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThatThrownBy(() -> islands.switchCurrentIsland(user, other, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", FocusErrorCode.SESSION_IN_PROGRESS);
        assertThat(currentIsland(user)).as("거절된 명령은 현재 섬을 바꾸지 않는다").isEqualTo(home.id());
    }

    // ---------------------------------------------------------------- 5. 같은 섬 PUT

    @Test
    @DisplayName("같은 섬 PUT 은 상태확인이라 이벤트도 membership 도 만들지 않는다")
    void switchingToTheSameIslandIsAStatusCheckOnly() {
        UUID user = newUser();
        IslandCreatedView home = islands.create(user, new CreateIslandCommandRequest("제자리섬", null, false),
                UUID.randomUUID());
        long eventsBefore = count("select count(*) from event_outbox where subject_id=?",
                home.id().toString());
        long membershipsBefore = count("select count(*) from group_members where group_id=?", home.id());

        assertThat(islands.switchCurrentIsland(user, home.id(), UUID.randomUUID()).currentIslandId())
                .isEqualTo(home.id());

        assertThat(count("select count(*) from event_outbox where subject_id=?", home.id().toString()))
                .isEqualTo(eventsBefore);
        assertThat(count("select count(*) from group_members where group_id=?", home.id()))
                .isEqualTo(membershipsBefore);
    }

    @Test
    @DisplayName("현재 섬이 없어도 첫 선택은 실제 소속이어야 하고, 남의 섬으로는 옮길 수 없다")
    void firstSelectionStillRequiresRealMembership() {
        UUID user = newUser();
        UUID strangers = publicIsland("남의섬");

        assertThat(currentIsland(user)).isNull();
        assertThatThrownBy(() -> islands.switchCurrentIsland(user, strangers, UUID.randomUUID()))
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertThat(currentIsland(user)).isNull();

        joinAs(user, strangers, GroupMemberRole.MEMBER);
        assertThat(islands.switchCurrentIsland(user, strangers, UUID.randomUUID()).currentIslandId())
                .isEqualTo(strangers);
    }

    @Test
    @DisplayName("내 섬 목록의 currentIslandId 는 아직 활성 소속인 섬일 때만 나온다")
    void myIslandsHidesACurrentIslandThatIsNoLongerMine() {
        UUID user = newUser();
        IslandCreatedView home = islands.create(user, new CreateIslandCommandRequest("떠난섬", null, false),
                UUID.randomUUID());
        assertThat(islands.myIslands(user).currentIslandId()).isEqualTo(home.id());

        jdbc.update("update group_members set is_left=true, left_reason='LEFT' "
                + "where group_id=? and user_id=?", home.id(), user);

        assertThat(islands.myIslands(user).items()).isEmpty();
        assertThat(islands.myIslands(user).currentIslandId())
                .as("권한 없는 대상을 현재 섬으로 «보여주지» 않는다").isNull();
        assertThat(jdbc.queryForObject(
                "select current_island_id from user_island_contexts where user_id=?", UUID.class, user))
                .as("저장값은 그대로 둔다 — null 로 «쓰는» 것은 IM-D06 이 관장한다").isEqualTo(home.id());
    }

    // ---------------------------------------------------------------- 6. 멱등

    @Test
    @DisplayName("같은 키·같은 본문은 원 응답을 재생하고 섬을 두 번 만들지 않는다")
    void sameKeyAndBodyReplaysTheOriginalIsland() {
        UUID user = newUser();
        UUID key = UUID.randomUUID();
        CreateIslandCommandRequest body = new CreateIslandCommandRequest("멱등섬", "소개", false);

        IslandCreatedView first = islands.create(user, body, key);
        IslandCreatedView replay = islands.create(user, body, key);

        assertThat(replay.id()).isEqualTo(first.id());
        assertThat(count("select count(*) from groups where name='멱등섬'")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 키에 다른 본문은 409 다")
    void sameKeyWithDifferentBodyConflicts() {
        UUID user = newUser();
        UUID key = UUID.randomUUID();
        islands.create(user, new CreateIslandCommandRequest("원본섬", null, false), key);

        assertThatThrownBy(() -> islands.create(user,
                new CreateIslandCommandRequest("다른섬", null, false), key))
                .isInstanceOf(OutboxException.class);
    }

    @Test
    @DisplayName("생성은 섬 상태와 주민 목록 두 축의 사건을 함께 남긴다")
    void createEmitsBothIslandAndMemberEvents() {
        UUID user = newUser();
        IslandCreatedView created = islands.create(user,
                new CreateIslandCommandRequest("사건섬", null, true), UUID.randomUUID());

        assertThat(created.role()).isEqualTo("host");
        assertThat(created.currentIslandId()).isEqualTo(created.id());
        assertThat(count("select count(*) from event_outbox where subject_id=? and type='island.updated'",
                created.id().toString())).isEqualTo(1);
        assertThat(count("select count(*) from event_outbox where subject_id=?"
                + " and type='island.members.updated'", created.id().toString())).isEqualTo(1);
        assertThat(jdbc.queryForObject("select approval_required from groups where id=?",
                Boolean.class, created.id())).isTrue();
    }

    // ---------------------------------------------------------------- 리뷰 후속 (PR #793)

    @Test
    @DisplayName("양방향 제어문자·개행이 든 이름은 레거시 그룹과 같은 규칙으로 400 이다")
    void controlCharacterNamesAreRejectedByTheLegacyNameRule() throws Exception {
        UUID user = newUser();
        String[] bodies = {
            "{\"name\":\"\\u202E몰래섬\",\"approvalRequired\":false}",
            "{\"name\":\"몰래\\n섬\",\"approvalRequired\":false}",
            "{\"name\":\"\\u2066섬\",\"approvalRequired\":false}",
        };
        for (String body : bodies) {
            mvc.perform(post("/internal/users/" + user + "/islands")
                            .header("Authorization", "Bearer " + TOKEN)
                            .header("X-User-Id", user.toString())
                            .header("Idempotency-Key", UUID.randomUUID().toString())
                            .contentType("application/json").content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        assertThat(count("select count(*) from group_members where user_id=?", user))
                .as("거절된 이름으로 섬이 만들어지지 않는다").isZero();
    }

    @Test
    @DisplayName("강퇴돼 «죽은» 현재 섬만 남은 사용자는 검색도, 같은 섬 확인도 할 수 없다")
    void deadCurrentIslandOpensNeitherSearchNorSameIslandConfirmation() {
        UUID user = newUser();
        IslandCreatedView home = islands.create(user, new CreateIslandCommandRequest("강퇴전섬", null, false),
                UUID.randomUUID());
        jdbc.update("update group_members set is_left=true, left_reason='KICKED' "
                + "where group_id=? and user_id=?", home.id(), user);

        assertThatThrownBy(() -> islands.search(user, null, null, 20))
                .as("저장된 현재 섬이 있어도 활성 소속이 아니면 검색 가드에 걸린다")
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.OBSERVATORY_LOCKED);
        assertThatThrownBy(() -> islands.switchCurrentIsland(user, home.id(), UUID.randomUUID()))
                .as("같은 섬 PUT 도 멤버십을 다시 본다")
                .hasFieldOrPropertyWithValue("errorCode", GroupErrorCode.MEMBER_ONLY);
        assertThat(islands.myIslands(user).currentIslandId()).isNull();
        assertThat(currentIsland(user)).as("저장값은 그대로 — 비우는 쓰기는 IM-D06 몫").isEqualTo(home.id());
    }

    // ---------------------------------------------------------------- 도구

    private List<UUID> pageThroughSearch(UUID userId, String q, int limit) {
        List<UUID> seen = new ArrayList<>();
        UUID cursor = null;
        // 공유 DB 의 섬 총수는 스위트가 커질수록 는다 — 한계는 무한 커서 감지용이지 데이터 수 상한이 아니다.
        for (int guard = 0; guard < 500; guard++) {
            IslandSearchPageView page = islands.search(userId, q, cursor, limit);
            page.items().stream().map(IslandSummaryView::id).forEach(seen::add);
            cursor = page.nextIslandId();
            if (cursor == null) {
                return seen;
            }
        }
        throw new IllegalStateException("커서가 끝나지 않는다");
    }

    private List<UUID> pageThroughDiscover(UUID userId, int limit) {
        List<UUID> seen = new ArrayList<>();
        String handle = null;
        for (int guard = 0; guard < 500; guard++) {
            IslandDiscoverPageView page = islands.discover(userId, SEED, handle, limit);
            page.items().stream().map(IslandSummaryView::id).forEach(seen::add);
            handle = page.nextHandle();
            if (handle == null) {
                return seen;
            }
        }
        throw new IllegalStateException("커서가 끝나지 않는다");
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    private UUID publicIsland(String name) {
        return island(name, false, 10);
    }

    private UUID island(String name, boolean isPrivate, int maxMembers) {
        return groups.save(Group.builder().name(name).description(null).maxMembers(maxMembers)
                .isPrivate(isPrivate).approvalRequired(false).status(GroupStatus.WAITING).build()).getId();
    }

    private void joinAs(UUID userId, UUID islandId, GroupMemberRole role) {
        User user = users.getCaller(userId);
        Group island = groups.findById(islandId).orElseThrow();
        members.save(GroupMember.builder().user(user).group(island).role(role).build());
    }

    /** 검색 가드를 통과시키려고 현재 섬 하나를 쥐여 준다. */
    private void giveCurrentIsland(UUID userId) {
        islands.create(userId, new CreateIslandCommandRequest("본거지", null, false), UUID.randomUUID());
    }

    /** 컨텍스트 행 자체가 없을 수 있다 — 그 «없음» 도 null 로 읽는다. */
    private UUID currentIsland(UUID userId) {
        List<UUID> rows = jdbc.queryForList(
                "select current_island_id from user_island_contexts where user_id=?", UUID.class, userId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
