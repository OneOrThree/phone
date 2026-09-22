package com.oneorthree.phone.common.support;

import com.oneorthree.phone.auth.service.AuthService;
import com.oneorthree.phone.auth.support.JwtProvider;
import com.oneorthree.phone.common.exception.BannedWordException;
import com.oneorthree.phone.common.exception.CommonErrorCode;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.dto.CreateGroupRequest;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.group.service.GroupService;
import com.oneorthree.phone.internal.dto.CreateIslandCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageCommandRequest;
import com.oneorthree.phone.internal.dto.IslandManageView;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.service.IslandManagementService;
import com.oneorthree.phone.internal.service.IslandMembershipService;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.dto.UserProfileUpdateRequest;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.service.UserService;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
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
 * 금칙어 차단 (GROMO-1986) — 사용자 입력 <b>6종</b>이 실제 Flyway PostgreSQL 위에서 400
 * {@code BANNED_WORD} 로 거절되고 <b>행을 남기지 않는지</b> 본다.
 *
 * <p>6종은 ① 공지 본문 ② 댓글 ③ 편지 ④ 닉네임 ⑤ 섬 이름 ⑥ 섬 소개다. 한 클래스에 모은 이유는
 * 이 티켓이 검증해야 하는 것이 「각 서비스가 저마다 막는가」가 아니라 <b>「여섯 입구가 같은 목록·같은
 * 코드로 막히는가」</b> 이기 때문이다 — 하나라도 다른 코드로 새면 앱이 안내를 갈라 써야 한다.
 *
 * <p>마지막 테스트가 이 티켓의 핵심 회귀다: 레거시 {@code /api/v1} 경로({@code GroupService} ·
 * {@code GroupAnnouncementService})는 2.0 섬 서비스와 <b>다른 클래스</b>인데 <b>같은
 * {@code groups}·{@code group_announcements} 행</b>을 만든다. 2.0 쪽에만 검사를 두면 레거시가 그대로
 * 우회로가 된다 — DTO 애노테이션이 아니라 저장 직전 서비스 계층을 고른 이유가 이것이다.
 *
 * <p>목록 자체는 {@code src/main/resources/moderation/banned-words.txt} 다. 테스트가 쓰는 낱말은 그
 * 파일에 실제로 있는 항목이어야 한다 — 목록에서 지우면 여기가 먼저 빨개진다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class BannedWordsIntegrationTest {

    private static final String TOKEN = "test-banned-words-business";

    /** 목록에 있는 낱말. 정규화(문자·숫자 외 제거 + 소문자)를 함께 확인하려고 변형도 쓴다. */
    private static final String DIRTY = "씨발";
    private static final String DIRTY_SPACED = "씨 발!!";
    private static final String DIRTY_EN = "F U C K";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("notification.dispatch.mode", () -> "OUTBOX");
        registry.add("island-board.writes-enabled", () -> true);
        registry.add("island-management.commands-enabled", () -> true);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "POST /internal/users/*/letters");
    }

    @Autowired
    BannedWords bannedWords;
    @Autowired
    IslandNoticeService notices;
    @Autowired
    IslandMembershipService islands;
    @Autowired
    IslandManagementService management;
    @Autowired
    GroupService legacyGroups;
    @Autowired
    GroupAnnouncementService legacyNotices;
    @Autowired
    UserService userService;
    @Autowired
    FriendService friends;
    @Autowired
    AuthService auth;
    @Autowired
    JwtProvider jwt;
    @Autowired
    UserRepository users;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- 판정기 자체

    @Test
    @DisplayName("목록은 기동 때 실제로 로드됐고, 띄어쓰기·특수문자·대소문자 회피는 같은 낱말로 접힌다")
    void listIsLoadedAndEvasionsNormalizeToTheSameWord() {
        assertThat(bannedWords.contains(DIRTY)).isTrue();
        assertThat(bannedWords.contains(DIRTY_SPACED)).as("띄어쓰기·느낌표를 끼워도 같은 낱말이다").isTrue();
        assertThat(bannedWords.contains(DIRTY_EN)).as("대문자·공백 회피도 접힌다").isTrue();
        assertThat(bannedWords.contains("오늘도 집중해요")).as("멀쩡한 문장은 통과한다").isFalse();
        assertThat(bannedWords.contains(null)).as("null 은 «안 보냄» 이라 판정 대상이 아니다").isFalse();
    }

    @Test
    @DisplayName("허용어가 오탐을 막는다 — 시발점·grape 는 통과하고 시발·rape 는 막힌다 (Scunthorpe)")
    void allowedWordsCancelFalsePositivesWithoutOpeningAnEvasion() {
        // 오탐: 금칙어를 «품은» 정상어. 여기서 400 이 나면 멀쩡한 사용자가 막힌다.
        assertThat(bannedWords.contains("이 노선의 시발점은 여기예요")).isFalse();
        assertThat(bannedWords.contains("시발역에서 만나요")).isFalse();
        assertThat(bannedWords.contains("I ate a grape and some grapefruit")).as("파생형도 짧은 허용어가 덮는다")
                .isFalse();
        assertThat(bannedWords.contains("therapeutic drapes")).isFalse();
        assertThat(bannedWords.contains("Scunthorpe")).isFalse();
        assertThat(bannedWords.contains("a niggardly sum")).isFalse();

        // 진짜 금칙어는 그대로 막힌다.
        assertThat(bannedWords.contains("시발")).isTrue();
        assertThat(bannedWords.contains("rape")).isTrue();

        // 허용어를 방패로 쓰는 회피는 안 열린다 — 상쇄는 «붙여 쓴 원문» 에서 정확히 쓴 횟수만큼만 준다.
        assertThat(bannedWords.contains("시발 점")).as("띄어 쓰면 허용어가 아니다").isTrue();
        assertThat(bannedWords.contains("시발점에서 시발")).as("적중 2 · 상쇄 1 이면 남는 1 이 걸린다").isTrue();
        assertThat(bannedWords.contains("g rape")).as("영어도 같다").isTrue();
        assertThat(bannedWords.contains("grapefruit rape")).as("파생형이 상쇄를 두 번 벌지 않는다").isTrue();
    }

    // ---------------------------------------------------------------- ① 공지 본문 · ② 댓글

    @Test
    @DisplayName("① 공지 본문 — 작성·수정 둘 다 BANNED_WORD 로 거절되고 행·본문이 남지 않는다")
    void noticeCreateAndUpdateRejectBannedWords() {
        Island is = island();

        assertBanned(() -> notices.create(is.id(), is.owner(), "제목", "우리 섬 " + DIRTY + " 하자", key()));
        assertBanned(() -> notices.create(is.id(), is.owner(), DIRTY_SPACED, "본문은 멀쩡", key()));
        assertThat(noticeCount(is.id())).as("거절된 작성은 행을 남기지 않는다").isZero();

        IslandNoticeViews.Notice clean = notices.create(is.id(), is.owner(), "제목", "같이 집중해요", key());
        assertBanned(() -> notices.update(is.id(), clean.id(), is.owner(), null, DIRTY, key()));
        assertThat(noticeBody(clean.id())).as("거절된 수정은 본문을 바꾸지 않는다").isEqualTo("같이 집중해요");
    }

    @Test
    @DisplayName("② 댓글 — 수정 API 가 없으므로 작성 한 곳이 유일한 입구다")
    void commentRejectsBannedWords() {
        Island is = island();
        IslandNoticeViews.Notice notice = notices.create(is.id(), is.owner(), "제목", "같이 집중해요", key());

        assertBanned(() -> notices.comment(is.id(), notice.id(), is.owner(), DIRTY_EN, key()));
        assertThat(count("select count(*) from group_announcement_comments where notice_id=?", notice.id()))
                .as("거절된 댓글은 행을 남기지 않는다").isZero();
    }

    // ---------------------------------------------------------------- ③ 편지 (HTTP 표면)

    @Test
    @DisplayName("③ 편지 — 내부 HTTP 표면에서 400 BANNED_WORD 봉투가 나가고 행이 남지 않는다")
    void letterRejectsBannedWordsOverHttp() throws Exception {
        // 발신자는 회원이어야 한다 (GROMO-1992) — 게스트는 계정 gate 의 403 이 금칙어 판정보다 먼저다.
        UUID sender = newMember();
        assertThat(jdbc.queryForObject("select is_guest from users where id = ?", Boolean.class, sender))
                .as("회원이어야 게스트 gate 를 지나 BANNED_WORD 판정에 도달한다").isFalse();
        UUID receiver = newUser();  // 수신자는 gate 대상이 아니라 게스트 그대로다
        friends.acceptRequest(receiver, friends.createRequest(sender, receiver));
        jdbc.update("delete from letters");

        mvc.perform(post("/internal/users/" + sender + "/letters")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", sender.toString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"receiverId\":\"" + receiver + "\",\"content\":\"너 " + DIRTY + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("BANNED_WORD"));

        assertThat(count("select count(*) from letters")).as("거절된 발송은 행을 남기지 않는다").isZero();
    }

    // ---------------------------------------------------------------- ④ 닉네임

    @Test
    @DisplayName("④ 닉네임 — 저장이 거절되고, 사전 검사도 같은 값을 «사용 가능» 으로 답하지 않는다")
    void nicknameRejectsBannedWordsAndTheCheckApiAgrees() {
        UUID userId = newUser();
        userService.updateProfile(userId, nickname("집중고양이"));

        assertBanned(() -> userService.updateProfile(userId, nickname(DIRTY + "냥")));
        assertThat(users.findById(userId).orElseThrow().getNickname())
                .as("거절된 변경은 닉네임을 바꾸지 않는다").isEqualTo("집중고양이");
        // 체크 API 가 true 를 주면 앱은 「쓸 수 있다」고 안내한 뒤 저장에서 400 을 맞는다.
        assertThat(userService.isNicknameAvailable(userId, DIRTY + "냥")).isFalse();
    }

    // ---------------------------------------------------------------- ⑤ 섬 이름 · ⑥ 섬 소개

    @Test
    @DisplayName("⑤⑥ 섬 이름·소개 — 생성과 수정 두 입구 모두에서 거절되고 행·값이 남지 않는다")
    void islandNameAndIntroRejectBannedWordsOnCreateAndUpdate() {
        UUID host = newUser();

        assertBanned(() -> islands.create(host, new CreateIslandCommandRequest(DIRTY + "섬", "소개", false, null), key()));
        assertBanned(() -> islands.create(host,
                new CreateIslandCommandRequest("멀쩡섬", "여긴 " + DIRTY_EN + " 한 곳", false, null), key()));
        assertThat(count("select count(*) from groups where name like ?", "%섬%"))
                .as("거절된 생성은 섬 행을 남기지 않는다").isZero();

        UUID islandId = islands.create(host, new CreateIslandCommandRequest("고요한섬", "같이 집중해요", false, null), key()).id();
        assertBanned(() -> management.manage(host, islandId,
                new IslandManageCommandRequest(DIRTY_SPACED, null, null, null), key()));
        assertBanned(() -> management.manage(host, islandId,
                new IslandManageCommandRequest(null, DIRTY, null, null), key()));

        Group island = groups.findById(islandId).orElseThrow();
        assertThat(island.getName()).as("거절된 수정은 이름을 바꾸지 않는다").isEqualTo("고요한섬");
        assertThat(island.getDescription()).as("거절된 수정은 소개를 바꾸지 않는다").isEqualTo("같이 집중해요");
    }

    @Test
    @DisplayName("금칙어 판정은 멱등 판정 «뒤» 다 — 성공한 키의 재생은 목록이 늘어도 원 결과고, 키 재사용은 409 다")
    void bannedWordCheckSitsBehindTheReceiptSoReplayKeepsItsResult() {
        UUID host = newUser();
        UUID islandId = islands.create(host, new CreateIslandCommandRequest("조용한섬", "같이 집중해요", false, null), key()).id();

        UUID usedKey = key();
        IslandManageView first = management.manage(host, islandId,
                new IslandManageCommandRequest("새이름", null, null, null), usedKey);

        // ① 같은 키 + 같은 본문 = 성공 재생. 판정이 앞에 있으면 배포 사이에 목록이 늘었을 때 여기가 400 이 된다.
        IslandManageView replay = management.manage(host, islandId,
                new IslandManageCommandRequest("새이름", null, null, null), usedKey);
        assertThat(replay.version()).as("재생은 원 결과 그대로다").isEqualTo(first.version());

        // ② 같은 키 + 다른 본문(금칙어) = 지문 불일치 409 다. 400 BANNED_WORD 가 나오면 판정이 너무 앞에 있다.
        assertThatThrownBy(() -> management.manage(host, islandId,
                new IslandManageCommandRequest(DIRTY + "섬", null, null, null), usedKey))
                .isNotInstanceOf(BannedWordException.class)
                .isInstanceOf(OutboxException.class)
                .extracting(e -> ((OutboxException) e).getErrorCode())
                .isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);

        // ③ 새 키 + 금칙어 = 정상적으로 400 이다(판정이 죽은 게 아니다).
        assertBanned(() -> management.manage(host, islandId,
                new IslandManageCommandRequest(DIRTY + "섬", null, null, null), key()));
        assertThat(groups.findById(islandId).orElseThrow().getName()).isEqualTo("새이름");
    }

    // ---------------------------------------------------------------- 우회 구멍 회귀

    @Test
    @DisplayName("레거시 /api/v1 경로도 같은 목록에 막힌다 — 같은 행을 쓰는 두 번째 입구가 우회로가 되지 않는다")
    void legacyGroupPathsAreBlockedByTheSameList() {
        UUID host = newUser();

        assertBanned(() -> legacyGroups.createGroup(host, CreateGroupRequest.builder()
                .name(DIRTY + "모임").description("소개").build()));
        assertBanned(() -> legacyGroups.createGroup(host, CreateGroupRequest.builder()
                .name("멀쩡모임").description("여긴 " + DIRTY_EN).build()));
        assertThat(count("select count(*) from groups where name like ?", "%모임%"))
                .as("레거시 생성도 행을 남기지 않는다").isZero();

        Island is = island();
        assertBanned(() -> legacyNotices.createAnnouncement(is.id(), is.owner(),
                new CreateAnnouncementRequest("공지", DIRTY_SPACED)));
        assertThat(noticeCount(is.id())).as("레거시 공지도 행을 남기지 않는다").isZero();

        legacyNotices.createAnnouncement(is.id(), is.owner(), new CreateAnnouncementRequest("공지", "같이 집중해요"));
        UUID noticeId = jdbc.queryForObject("select id from group_announcements where group_id=?",
                UUID.class, is.id());
        assertBanned(() -> legacyNotices.updateAnnouncement(is.id(), noticeId, is.owner(),
                new CreateAnnouncementRequest("공지", DIRTY)));
        assertThat(noticeBody(noticeId)).as("레거시 수정도 본문을 바꾸지 않는다").isEqualTo("같이 집중해요");
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, UUID owner) {
    }

    /** 여섯 입구가 같은 사유로 거절되는지 — 예외 타입이 아니라 «앱이 분기하는 code» 로 단언한다. */
    private static void assertBanned(ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOf(BannedWordException.class)
                .extracting(e -> ((BannedWordException) e).getErrorCode())
                .isEqualTo(CommonErrorCode.BANNED_WORD);
    }

    private Island island() {
        UUID owner = newUser();
        Group island = groups.save(Group.builder().name("고요한터").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.findById(owner).orElseThrow()).group(island)
                .role(GroupMemberRole.OWNER).build());
        return new Island(island.getId(), owner);
    }

    private UUID newUser() {
        return jwt.extractUserId(auth.guestLogin().accessToken());
    }

    /** 게스트로 만든 뒤 {@code is_guest} 만 내린 회원 — 2.0 회원 전용 표면(편지 발송)을 통과시킬 때만 쓴다. */
    private UUID newMember() {
        UUID id = newUser();
        jdbc.update("update users set is_guest = false where id = ?", id);
        return id;
    }

    private static UserProfileUpdateRequest nickname(String value) {
        return new UserProfileUpdateRequest(value, null, null, null, null);
    }

    private static UUID key() {
        return UUID.randomUUID();
    }

    private long noticeCount(UUID islandId) {
        return count("select count(*) from group_announcements where group_id=?", islandId);
    }

    private String noticeBody(UUID noticeId) {
        return jdbc.queryForObject("select content from group_announcements where id=?", String.class, noticeId);
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
