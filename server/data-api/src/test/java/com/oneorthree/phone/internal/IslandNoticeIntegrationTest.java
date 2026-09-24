package com.oneorthree.phone.internal;

import com.oneorthree.phone.construction.repository.IslandFacilityRepository;
import com.oneorthree.phone.construction.repository.domain.IslandFacility;
import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import com.oneorthree.phone.outbox.exception.OutboxErrorCode;
import com.oneorthree.phone.outbox.exception.OutboxException;
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

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 섬 게시판 (GROMO-1771) 을 <b>실제 Flyway PostgreSQL(V66)</b> 위에서 검증한다 — 권한 행렬·게시판 잠금·다른 섬
 * 공지·멱등 재생·동률 커서·공지 version 축(legacy writer 포함)·내부 HTTP 표면.
 *
 * <p>시설 게이트를 <b>켜고</b>({@code construction.facility-gates.enforce=true}) 쓰기 스위치도 켠다
 * ({@code island-board.writes-enabled=true}). 기본값(둘 다 OFF)의 동작은 {@link IslandNoticeGateDefaultsTest}
 * 가 본다. 데이터는 전부 운영 엔티티·서비스로 심는다 — 동률 시각만 JDBC 로 맞춘다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandNoticeIntegrationTest {

    private static final String TOKEN = "test-island-notice-business";

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
        registry.add("construction.facility-gates.enforce", () -> true);
        registry.add("island-board.writes-enabled", () -> true);
        registry.add("island-board.notice-body-max-length", () -> 20);
        registry.add("island-board.comment-max-length", () -> 10);
        registry.add("internal.api.enabled", () -> true);
        registry.add("internal.api.callers.business.token", () -> TOKEN);
        registry.add("internal.api.callers.business.allow[0]", () -> "GET /internal/islands/*/notices");
        registry.add("internal.api.callers.business.allow[1]", () -> "POST /internal/islands/*/notices");
    }

    @Autowired
    IslandNoticeService notices;
    @Autowired
    GroupAnnouncementService legacy;
    @Autowired
    GroupMemberService memberService;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;
    @Autowired
    IslandFacilityRepository facilities;
    @Autowired
    IslandJoinRequestRepository joinRequests;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    MockMvc mvc;

    // ---------------------------------------------------------------- 권한 행렬 (B01·B03)

    @Test
    @DisplayName("방장은 작성·수정·삭제하고, 작성은 version 1·notice.updated 1건을 같은 TX 에 남긴다")
    void ownerWritesAndEachWriteBumpsTheNoticeVersion() {
        Island is = boardIsland();

        IslandNoticeViews.Notice created = notices.create(is.id, is.owner, "환영해요", "같이 집중해요", key());
        assertThat(created.title()).isEqualTo("환영해요");
        assertThat(version(created.id())).isEqualTo(1);
        assertThat(events(created.id())).containsExactly(1L);

        // 생략은 유지 — 제목만 바꿔도 본문이 남고 version 이 오른다.
        IslandNoticeViews.Notice patched = notices.update(is.id, created.id(), is.owner, "새 제목", null, key());
        assertThat(patched.title()).isEqualTo("새 제목");
        assertThat(patched.body()).isEqualTo("같이 집중해요");
        assertThat(notices.detail(is.id, created.id(), is.owner, null, null, 30).version()).isEqualTo(2);

        assertThat(notices.delete(is.id, created.id(), is.owner, key()).deleted()).isTrue();
        assertThat(count("select count(*) from group_announcements where id=?", created.id())).isZero();
        // 삭제도 마지막 version+1 을 남긴다.
        assertThat(events(created.id())).containsExactly(1L, 2L, 3L);
    }

    @Test
    @DisplayName("ALLOW 주민은 더는 공지를 쓰지 못한다 — 방장 전용이다(2026-09-25 결정 GROMO-2136, B03 재확정)")
    void allowResidentCanNoLongerWriteNotices() {
        Island is = boardIsland();
        UUID allowed = resident(is.id, GroupAnnouncementGrant.ALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "방장 공지", "본문", key()).id();

        assertThatThrownBy(() -> notices.create(is.id, allowed, "주민 공지", "본문", key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        assertThatThrownBy(() -> notices.update(is.id, noticeId, allowed, null, "주민이 고침", key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        assertThatThrownBy(() -> notices.delete(is.id, noticeId, allowed, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        // legacy /api/v1 경로는 그대로 ALLOW 주민을 허용한다 — 이 새 API 만 방장 전용으로 바뀌었다.
        legacy.updateAnnouncement(is.id, noticeId, allowed, new CreateAnnouncementRequest("ALLOW 주민이 고침", "본문"));
        assertThat(notices.detail(is.id, noticeId, is.owner, null, null, 30).title()).isEqualTo("ALLOW 주민이 고침");
    }

    @Test
    @DisplayName("일반 주민은 읽고 댓글만 단다 — 공지 쓰기는 NOTICE_FORBIDDEN")
    void plainResidentReadsAndCommentsOnly() {
        Island is = boardIsland();
        UUID plain = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();

        assertThatThrownBy(() -> notices.create(is.id, plain, "몰래", "본문", key()))
                .isInstanceOf(GroupException.class).extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        assertThatThrownBy(() -> notices.update(is.id, noticeId, plain, "몰래", null, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        assertThatThrownBy(() -> notices.delete(is.id, noticeId, plain, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);

        IslandNoticeViews.CommentCreated comment = notices.comment(is.id, noticeId, plain, "좋아요", key());
        assertThat(comment.text()).isEqualTo("좋아요");
        assertThat(comment.name()).startsWith("주민-");
        assertThat(notices.list(is.id, plain, null, null, 30).items()).singleElement()
                .satisfies(item -> assertThat(item.commentCount()).isEqualTo(1));
        IslandNoticeViews.Detail detail = notices.detail(is.id, noticeId, plain, null, null, 30);
        assertThat(detail.comments()).singleElement().satisfies(c -> {
            assertThat(c.userId()).isEqualTo(plain);
            assertThat(c.name()).isEqualTo(comment.name());
        });
        // 댓글도 같은 공지 version 을 올린다(B08).
        assertThat(detail.version()).isEqualTo(2);
        // 거절된 쓰기는 행·사건을 남기지 않는다.
        assertThat(events(noticeId)).containsExactly(1L, 2L);
    }

    @Test
    @DisplayName("방문자·가입 대기자는 공지 목록·상세·댓글을 읽고, 댓글·공지 쓰기는 MEMBER_ONLY 다(V-읽기, GROMO-1937)")
    void visitorsReadButCannotWrite() throws Exception {
        Island is = boardIsland();
        UUID resident = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        notices.comment(is.id, noticeId, resident, "좋아요", key());
        UUID visitor = user("방문자");
        UUID applicant = user("신청자");
        joinRequests.save(IslandJoinRequest.pending(groups.findById(is.id).orElseThrow(),
                users.findById(applicant).orElseThrow(), null));

        for (UUID reader : List.of(visitor, applicant)) {
            assertThat(notices.list(is.id, reader, null, null, 30).items()).singleElement()
                    .satisfies(item -> assertThat(item.commentCount()).isEqualTo(1));
            IslandNoticeViews.Detail detail = notices.detail(is.id, noticeId, reader, null, null, 30);
            assertThat(detail.body()).isEqualTo("본문");
            assertThat(detail.comments()).singleElement()
                    .satisfies(c -> assertThat(c.userId()).isEqualTo(resident));

            assertThatThrownBy(() -> notices.comment(is.id, noticeId, reader, "안녕", key()))
                    .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
            assertThatThrownBy(() -> notices.create(is.id, reader, "몰래", "본문", key()))
                    .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
            assertThatThrownBy(() -> notices.update(is.id, noticeId, reader, "몰래", null, key()))
                    .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
            assertThatThrownBy(() -> notices.delete(is.id, noticeId, reader, key()))
                    .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
        }
        // 내부 표면도 방문자 읽기가 200 이다.
        mvc.perform(get("/internal/islands/" + is.id + "/notices").param("limit", "30")
                        .header("Authorization", "Bearer " + TOKEN).header("X-User-Id", visitor))
                .andExpect(status().isOk());
        // 거절된 쓰기는 행·사건을 남기지 않는다.
        assertThat(events(noticeId)).containsExactly(1L, 2L);
    }

    @Test
    @DisplayName("방문자도 미완공 게시판은 BOARD_LOCKED, 삭제·종료된 섬은 GROUP_NOT_FOUND 다")
    void visitorsStillSeeBoardLockAndDeadIslands() {
        UUID visitor = user("방문자");
        Island locked = island();
        assertThatThrownBy(() -> notices.list(locked.id, visitor, null, null, 30))
                .extracting("errorCode").isEqualTo(GroupErrorCode.BOARD_LOCKED);

        Island ended = boardIsland();
        jdbc.update("update groups set status='ENDED' where id=?", ended.id);
        assertThatThrownBy(() -> notices.list(ended.id, visitor, null, null, 30))
                .extracting("errorCode").isEqualTo(GroupErrorCode.GROUP_NOT_FOUND);
    }

    @Test
    @DisplayName("게시판 미완공 섬(enforce=ON)은 주민의 읽기·쓰기 모두 BOARD_LOCKED")
    void lockedBoardRejectsResidents() {
        Island is = island();

        assertThatThrownBy(() -> notices.list(is.id, is.owner, null, null, 30))
                .extracting("errorCode").isEqualTo(GroupErrorCode.BOARD_LOCKED);
        assertThatThrownBy(() -> notices.create(is.id, is.owner, "공지", "본문", key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.BOARD_LOCKED);
        assertThat(count("select count(*) from group_announcements where group_id=?", is.id)).isZero();
    }

    @Test
    @DisplayName("다른 섬의 공지 id 는 경로 섬으로 다시 좁혀 NOT_FOUND 다")
    void anotherIslandsNoticeIsNotFound() {
        Island a = boardIsland();
        Island b = boardIsland();
        UUID noticeOfA = notices.create(a.id, a.owner, "A 공지", "본문", key()).id();

        assertThatThrownBy(() -> notices.detail(b.id, noticeOfA, b.owner, null, null, 30))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> notices.update(b.id, noticeOfA, b.owner, "탈취", null, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> notices.delete(b.id, noticeOfA, b.owner, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThatThrownBy(() -> notices.comment(b.id, noticeOfA, b.owner, "끼어들기", key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThat(events(noticeOfA)).containsExactly(1L);
    }

    // ---------------------------------------------------------------- 멱등 (B07)

    @Test
    @DisplayName("같은 키·같은 본문은 원 결과 재생(행·사건 추가 없음), 같은 키·다른 본문은 IDEMPOTENCY_KEY_CONFLICT")
    void sameKeyReplaysAndDifferentBodyConflicts() {
        Island is = boardIsland();
        UUID key = key();

        IslandNoticeViews.Notice first = notices.create(is.id, is.owner, "공지", "본문", key);
        IslandNoticeViews.Notice replay = notices.create(is.id, is.owner, "공지", "본문", key);

        assertThat(replay).isEqualTo(first);
        assertThat(count("select count(*) from group_announcements where group_id=?", is.id)).isEqualTo(1);
        assertThat(events(first.id())).containsExactly(1L);
        assertThatThrownBy(() -> notices.create(is.id, is.owner, "공지", "다른 본문", key))
                .isInstanceOf(OutboxException.class)
                .extracting("errorCode").isEqualTo(OutboxErrorCode.IDEMPOTENCY_KEY_CONFLICT);
    }

    @Test
    @DisplayName("삭제의 같은 키 재생은 공지가 없어도 deleted=true, 새 키로 없는 공지를 지우면 NOT_FOUND")
    void deleteReplayAfterDeletionAndNewKeyNotFound() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID key = key();

        assertThat(notices.delete(is.id, noticeId, is.owner, key).deleted()).isTrue();
        assertThat(notices.delete(is.id, noticeId, is.owner, key).deleted()).isTrue();
        assertThatThrownBy(() -> notices.delete(is.id, noticeId, is.owner, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThat(events(noticeId)).containsExactly(1L, 2L);
    }

    @Test
    @DisplayName("재생도 현재 인가가 필요하다 — 방장 위임 뒤 같은 키 재전송은 옛 방장에게 NOTICE_FORBIDDEN")
    void replayRequiresCurrentAuthorization() {
        Island is = boardIsland();
        UUID key = key();
        notices.create(is.id, is.owner, "공지", "본문", key);

        UUID successor = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        memberService.transferOwner(is.id, successor, is.owner);

        assertThatThrownBy(() -> notices.create(is.id, is.owner, "공지", "본문", key))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
    }

    // ---------------------------------------------------------------- 댓글 삭제 (B11, 2026-09-25 결정 GROMO-2136)

    @Test
    @DisplayName("댓글은 작성자 본인이 지운다 — 200 deleted=true, 공지 version 도 오른다")
    void authorDeletesOwnComment() {
        Island is = boardIsland();
        UUID plain = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID commentId = notices.comment(is.id, noticeId, plain, "댓글", key()).id();

        assertThat(notices.deleteComment(is.id, noticeId, commentId, plain, key()).deleted()).isTrue();

        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isZero();
        assertThat(events(noticeId)).containsExactly(1L, 2L, 3L);
    }

    @Test
    @DisplayName("방장은 남의 댓글도 지운다")
    void hostDeletesOthersComment() {
        Island is = boardIsland();
        UUID plain = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID commentId = notices.comment(is.id, noticeId, plain, "댓글", key()).id();

        assertThat(notices.deleteComment(is.id, noticeId, commentId, is.owner, key()).deleted()).isTrue();

        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isZero();
    }

    @Test
    @DisplayName("작성자도 방장도 아닌 주민은 NOTICE_COMMENT_FORBIDDEN, 없는 댓글·다른 공지 댓글은 NOT_FOUND")
    void otherResidentCannotDeleteAndUnknownCommentIsNotFound() {
        Island is = boardIsland();
        UUID author = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID commentId = notices.comment(is.id, noticeId, author, "댓글", key()).id();

        assertThatThrownBy(() -> notices.deleteComment(is.id, noticeId, commentId, other, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_COMMENT_FORBIDDEN);
        assertThatThrownBy(() -> notices.deleteComment(is.id, noticeId, UUID.randomUUID(), is.owner, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);

        Island otherIsland = boardIsland();
        UUID otherNoticeId = notices.create(otherIsland.id, otherIsland.owner, "다른 섬 공지", "본문", key()).id();
        assertThatThrownBy(() -> notices.deleteComment(otherIsland.id, otherNoticeId, commentId, otherIsland.owner,
                key())).extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isEqualTo(1);
    }

    @Test
    @DisplayName("댓글 삭제의 같은 키 재생은 댓글이 없어도 deleted=true")
    void deleteCommentReplayAfterDeletion() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID commentId = notices.comment(is.id, noticeId, is.owner, "댓글", key()).id();
        UUID key = key();

        assertThat(notices.deleteComment(is.id, noticeId, commentId, is.owner, key).deleted()).isTrue();
        assertThat(notices.deleteComment(is.id, noticeId, commentId, is.owner, key).deleted()).isTrue();
    }

    // ---------------------------------------------------------------- 상한 (BQ03 확정값)

    @Test
    @DisplayName("본문·댓글 상한을 넘으면 422 코드 — 쓰기 전 거절이라 행이 남지 않는다")
    void provisionalLimitsRejectBeforeWriting() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "가".repeat(20), key()).id();

        assertThatThrownBy(() -> notices.create(is.id, is.owner, "공지", "가".repeat(21), key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_BODY_TOO_LONG);
        assertThatThrownBy(() -> notices.update(is.id, noticeId, is.owner, null, "가".repeat(21), key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_BODY_TOO_LONG);
        assertThatThrownBy(() -> notices.comment(is.id, noticeId, is.owner, "가".repeat(11), key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_COMMENT_TOO_LONG);
        assertThat(notices.comment(is.id, noticeId, is.owner, "가".repeat(10), key()).text()).hasSize(10);
    }

    @Test
    @DisplayName("상한 초과여도 권한 없는 요청은 403 코드가 먼저다 — 길이는 인가 뒤에 본다 (GROMO-1949)")
    void authorizationPrecedesLengthLimits() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID visitor = user("방문자");
        UUID plain = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        String longBody = "가".repeat(21);
        String longText = "가".repeat(11);

        assertThatThrownBy(() -> notices.create(is.id, visitor, "공지", longBody, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
        assertThatThrownBy(() -> notices.update(is.id, noticeId, visitor, null, longBody, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
        assertThatThrownBy(() -> notices.comment(is.id, noticeId, visitor, longText, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.MEMBER_ONLY);
        assertThatThrownBy(() -> notices.create(is.id, plain, "공지", longBody, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        assertThatThrownBy(() -> notices.update(is.id, noticeId, plain, null, longBody, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_FORBIDDEN);
        // 댓글은 일반 주민에게도 허용된 쓰기라 인가를 통과하고 길이에서 422 다.
        assertThatThrownBy(() -> notices.comment(is.id, noticeId, plain, longText, key()))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_COMMENT_TOO_LONG);

        // 422 는 rollback 되어 receipt 가 남지 않는다 — 같은 키 재전송도 다시 422 이고 행도 없다.
        UUID sameKey = key();
        for (int i = 0; i < 2; i++) {
            assertThatThrownBy(() -> notices.create(is.id, is.owner, "공지", longBody, sameKey))
                    .extracting("errorCode").isEqualTo(GroupErrorCode.NOTICE_BODY_TOO_LONG);
        }
        assertThat(jdbc.queryForObject("select count(*) from group_announcements where group_id=?", Long.class,
                is.id)).isEqualTo(1L);
    }

    // ---------------------------------------------------------------- 커서 (B09)

    @Test
    @DisplayName("같은 createdAt 의 공지도 id DESC 로 동률을 깨 페이지 경계에서 빠지거나 겹치지 않는다")
    void equalTimestampNoticesPageByIdTiebreak() {
        Island is = boardIsland();
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            ids.add(notices.create(is.id, is.owner, "공지" + i, "본문", key()).id());
        }
        Timestamp same = Timestamp.from(Instant.now().truncatedTo(ChronoUnit.MICROS));
        jdbc.update("update group_announcements set created_at=? where group_id=?", same, is.id);

        List<UUID> seen = new ArrayList<>();
        IslandNoticeViews.Page page = notices.list(is.id, is.owner, null, null, 2);
        page.items().forEach(item -> seen.add(item.id()));
        while (page.hasMore()) {
            IslandNoticeViews.Item last = page.items().get(page.items().size() - 1);
            page = notices.list(is.id, is.owner, last.createdAt(), last.id(), 2);
            page.items().forEach(item -> seen.add(item.id()));
        }

        List<UUID> expected = ids.stream().sorted(Comparator.comparing(UUID::toString).reversed()).toList();
        assertThat(seen).containsExactlyElementsOf(expected);
    }

    @Test
    @DisplayName("같은 createdAt 의 댓글도 id ASC 로 동률을 깬다 — anchor 가 지워져도 값으로 seek 한다")
    void equalTimestampCommentsPageByIdTiebreak() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            ids.add(notices.comment(is.id, noticeId, is.owner, "댓글" + i, key()).id());
        }
        Timestamp same = Timestamp.from(Instant.now().truncatedTo(ChronoUnit.MICROS));
        jdbc.update("update group_announcement_comments set created_at=? where notice_id=?", same, noticeId);
        List<UUID> expected = ids.stream().sorted(Comparator.comparing(UUID::toString)).toList();

        IslandNoticeViews.Detail first = notices.detail(is.id, noticeId, is.owner, null, null, 2);
        assertThat(first.hasMoreComments()).isTrue();
        IslandNoticeViews.Comment anchor = first.comments().get(1);
        // anchor 행이 사라져도 경계 값으로 다음 쪽을 읽는다.
        jdbc.update("delete from group_announcement_comments where id=?", anchor.id());
        IslandNoticeViews.Detail rest = notices.detail(is.id, noticeId, is.owner, anchor.createdAt(), anchor.id(),
                10);

        assertThat(first.comments()).extracting(IslandNoticeViews.Comment::id)
                .containsExactlyElementsOf(expected.subList(0, 2));
        assertThat(rest.comments()).extracting(IslandNoticeViews.Comment::id)
                .containsExactlyElementsOf(expected.subList(2, 5));
        assertThat(rest.hasMoreComments()).isFalse();
    }

    // ---------------------------------------------------------------- legacy writer (B08)

    @Test
    @DisplayName("legacy /api/v1 공지 생성·수정·삭제도 같은 공지 version 축을 올린다")
    void legacyWritersBumpTheSameNoticeVersion() {
        Island is = boardIsland();

        legacy.createAnnouncement(is.id, is.owner, new CreateAnnouncementRequest("legacy 공지", "본문"));
        UUID noticeId = jdbc.queryForObject("select id from group_announcements where group_id=?", UUID.class,
                is.id);
        assertThat(events(noticeId)).containsExactly(1L);

        legacy.updateAnnouncement(is.id, noticeId, is.owner, new CreateAnnouncementRequest("고친 제목", "본문"));
        // 새 경로 댓글이 legacy 수정 다음 번호를 잇는다 — 같은 축이다.
        UUID commentId = notices.comment(is.id, noticeId, is.owner, "댓글", key()).id();
        IslandNoticeViews.Detail detail = notices.detail(is.id, noticeId, is.owner, null, null, 30);
        assertThat(detail.title()).isEqualTo("고친 제목");
        assertThat(detail.version()).isEqualTo(3);

        legacy.deleteAnnouncement(is.id, noticeId, is.owner);
        assertThat(events(noticeId)).containsExactly(1L, 2L, 3L, 4L);
        // 댓글도 DB ON DELETE CASCADE(V103)로 함께 지워진다 — legacy 삭제도 마찬가지다(2026-09-25 결정 GROMO-2136).
        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isZero();
    }

    @Test
    @DisplayName("공지 삭제는 댓글도 함께 지운다 — DB ON DELETE CASCADE(V103, 2026-09-25 결정 GROMO-2136)")
    void deletingNoticeCascadesItsComments() {
        Island is = boardIsland();
        UUID noticeId = notices.create(is.id, is.owner, "공지", "본문", key()).id();
        UUID commentId = notices.comment(is.id, noticeId, is.owner, "댓글", key()).id();
        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isEqualTo(1);

        assertThat(notices.delete(is.id, noticeId, is.owner, key()).deleted()).isTrue();

        assertThat(count("select count(*) from group_announcement_comments where id=?", commentId)).isZero();
    }

    // ---------------------------------------------------------------- 내부 HTTP

    @Test
    @DisplayName("내부 HTTP 표면 — 작성·목록이 allowlist 를 통과하고, Idempotency-Key 없는 작성은 거절된다")
    void httpSurfaceCreatesAndLists() throws Exception {
        Island is = boardIsland();

        mvc.perform(post("/internal/islands/" + is.id + "/notices")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", is.owner.toString())
                        .header("Idempotency-Key", key().toString())
                        .contentType("application/json")
                        .content("{\"title\":\"환영해요\",\"body\":\"같이 집중해요\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("환영해요"))
                .andExpect(jsonPath("$.body").value("같이 집중해요"));

        mvc.perform(get("/internal/islands/" + is.id + "/notices")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", is.owner.toString())
                        .param("limit", "30"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("환영해요"))
                .andExpect(jsonPath("$.items[0].commentCount").value(0))
                .andExpect(jsonPath("$.hasMore").value(false));

        mvc.perform(post("/internal/islands/" + is.id + "/notices")
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("X-User-Id", is.owner.toString())
                        .contentType("application/json")
                        .content("{\"title\":\"키 없음\",\"body\":\"본문\"}"))
                .andExpect(status().is4xxClientError());
        assertThat(count("select count(*) from group_announcements where group_id=?", is.id)).isEqualTo(1);
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, UUID owner) {
    }

    /** 게시판이 완공된 섬 + 방장. */
    private Island boardIsland() {
        Island is = island();
        Instant now = Instant.now();
        IslandFacility board = IslandFacility.started(is.id, "board", 0, 1, is.owner, now, now);
        board.complete(now);
        facilities.save(board);
        return is;
    }

    /** 시설이 하나도 없는 섬 + 방장. */
    private Island island() {
        UUID owner = user("방장");
        Group island = groups.save(Group.builder().name("게시판섬").maxMembers(10).build());
        members.save(GroupMember.builder().user(users.findById(owner).orElseThrow()).group(island)
                .role(GroupMemberRole.OWNER).build());
        return new Island(island.getId(), owner);
    }

    private UUID resident(UUID islandId, GroupAnnouncementGrant grant) {
        UUID userId = user("주민");
        members.save(GroupMember.builder().user(users.findById(userId).orElseThrow())
                .group(groups.findById(islandId).orElseThrow()).role(GroupMemberRole.MEMBER)
                .announcementPermission(grant).build());
        return userId;
    }

    private UUID user(String prefix) {
        return users.save(User.builder().nickname(prefix + "-" + UUID.randomUUID().toString().substring(0, 8))
                .build()).getId();
    }

    private static UUID key() {
        return UUID.randomUUID();
    }

    private long version(UUID noticeId) {
        Long value = jdbc.queryForObject("select last_version from aggregate_versions"
                + " where aggregate_type='NOTICE' and aggregate_id=?", Long.class, noticeId.toString());
        return value == null ? 0L : value;
    }

    /** 이 공지 축의 notice.updated 사건 version 들 — 발급 순. */
    private List<Long> events(UUID noticeId) {
        return jdbc.queryForList("select version from event_outbox where type='notice.updated'"
                + " and aggregate_type='NOTICE' and aggregate_id=? order by version", Long.class,
                noticeId.toString());
    }

    private long count(String sql, Object... args) {
        Long value = jdbc.queryForObject(sql, Long.class, args);
        return value == null ? 0L : value;
    }
}
