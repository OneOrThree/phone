package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.internal.dto.IslandGuestbookViews;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.dto.IslandRecordViews.FocusMember;
import com.oneorthree.phone.internal.dto.IslandRecordViews.ScreenMember;
import com.oneorthree.phone.internal.dto.MailboxViewerResponse;
import com.oneorthree.phone.internal.dto.MessageAuthorsResponse;
import com.oneorthree.phone.internal.service.InternalIslandMailboxService;
import com.oneorthree.phone.internal.service.IslandGuestbookService;
import com.oneorthree.phone.internal.service.IslandNoticeService;
import com.oneorthree.phone.internal.service.IslandRecordsService;
import com.oneorthree.phone.outbox.support.OutboxTestPostgres;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserBlockService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 섬 편지방·게시판·방명록·도서관의 차단 제외 (GROMO-2181 → GROMO-2469, character-report policy RP-차단) — 실제
 * Flyway PostgreSQL 위에서 «차단하면 빠진다 → 해제하면 돌아온다 → 어느 방향이든 숨긴다» 세 경우와, 제외가 LIMIT 전에
 * 일어나 쪽 크기·keyset 커서가 그대로라는 것을 본다. 차단·해제는 공개 {@code POST/DELETE /blocks} 가 타는
 * {@link UserBlockService} 로 건다. 2181 은 요청자가 차단한 쪽만 뺐고, 2469 가 차단당한 쪽에서도 같은 제외를 한다.
 *
 * <p>시설 게이트는 기본값(OFF)이다 — 여기서 보는 것은 인가가 아니라 제외다. 댓글 작성에만 쓰기 스위치를 켠다.
 */
@SpringBootTest
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class IslandBlockFilterIntegrationTest {

    private static final int PAGE = 30;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        OutboxTestPostgres.applyProductionMigrationWiring(registry);
    }

    @Autowired
    IslandNoticeService notices;
    @Autowired
    GroupAnnouncementRepository announcements;
    @Autowired
    InternalIslandMailboxService mailbox;
    @Autowired
    IslandGuestbookService guestbook;
    @Autowired
    IslandRecordsService records;
    @Autowired
    UserBlockService blocks;
    @Autowired
    GroupRepository groups;
    @Autowired
    GroupMemberRepository members;
    @Autowired
    UserRepository users;

    // ---------------------------------------------------------------- 편지방 (GET /islands/{id}/messages)

    @Test
    @DisplayName("편지방 — 차단한 작성자는 hiddenUserIds 로 가고 이름은 싣지 않는다, 해제하면 이름으로 돌아온다")
    void mailboxAuthorsHideBlockedSenderUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);

        blocks.block(viewer, is.owner);
        MessageAuthorsResponse blocked = mailbox.authors(is.id, viewer, List.of(is.owner, other, is.owner));
        assertThat(blocked.hiddenUserIds()).containsExactly(is.owner);
        assertThat(blocked.authors()).extracting(MailboxViewerResponse::userId).containsExactly(other);

        blocks.unblock(viewer, is.owner);
        MessageAuthorsResponse unblocked = mailbox.authors(is.id, viewer, List.of(is.owner, other));
        assertThat(unblocked.hiddenUserIds()).isEmpty();
        assertThat(unblocked.authors()).extracting(MailboxViewerResponse::userId).containsExactly(is.owner, other);
    }

    @Test
    @DisplayName("편지방 — 양방향이다: 차단당한 쪽이 보는 차단한 사람의 메시지도 숨긴다, 해제하면 돌아온다")
    void mailboxHidesEitherDirection() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);

        blocks.block(viewer, is.owner);
        MessageAuthorsResponse ownerView = mailbox.authors(is.id, is.owner, List.of(viewer, other));
        assertThat(ownerView.hiddenUserIds()).containsExactly(viewer);
        assertThat(ownerView.authors()).extracting(MailboxViewerResponse::userId).containsExactly(other);
        // 제3자에게는 둘 다 보인다 — 차단은 두 사람 사이의 일이다.
        assertThat(mailbox.authors(is.id, other, List.of(viewer, is.owner)).hiddenUserIds()).isEmpty();

        blocks.unblock(viewer, is.owner);
        assertThat(mailbox.authors(is.id, is.owner, List.of(viewer)).hiddenUserIds()).isEmpty();
    }

    // ---------------------------------------------------------------- 게시판 목록 (GET /islands/{id}/notices)

    @Test
    @DisplayName("게시판 목록 — 차단한 작성자의 공지가 빠지고 commentCount 도 그 사람 댓글을 세지 않는다, 해제하면 돌아온다")
    void noticeListHidesBlockedAuthorUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID writer = resident(is.id, GroupAnnouncementGrant.ALLOW);
        UUID ownerNotice = notices.create(is.id, is.owner, "방장 공지", "본문", key()).id();
        UUID writerNotice = legacyNotice(is.id, writer, "주민 공지");
        notices.comment(is.id, writerNotice, is.owner, "방장 댓글", key());
        notices.comment(is.id, writerNotice, writer, "주민 댓글", key());

        blocks.block(viewer, is.owner);
        IslandNoticeViews.Page hidden = notices.list(is.id, viewer, null, null, PAGE);
        assertThat(hidden.items()).extracting(IslandNoticeViews.Item::id).containsExactly(writerNotice);
        assertThat(hidden.items().get(0).commentCount()).isEqualTo(1);

        blocks.unblock(viewer, is.owner);
        IslandNoticeViews.Page shown = notices.list(is.id, viewer, null, null, PAGE);
        assertThat(shown.items()).extracting(IslandNoticeViews.Item::id).containsExactly(writerNotice, ownerNotice);
        assertThat(shown.items().get(0).commentCount()).isEqualTo(2);
    }

    @Test
    @DisplayName("게시판 목록 — 제외가 LIMIT 전이라 쪽이 꽉 차고 keyset 커서가 빠짐·겹침 없이 이어진다")
    void noticeListKeepsPageSizeAndCursorAfterFiltering() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID writer = resident(is.id, GroupAnnouncementGrant.ALLOW);
        List<UUID> visible = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            notices.create(is.id, is.owner, "방장 " + i, "본문", key());
            visible.add(0, legacyNotice(is.id, writer, "주민 " + i));
            notices.create(is.id, is.owner, "방장 뒤 " + i, "본문", key());
        }
        blocks.block(viewer, is.owner);

        IslandNoticeViews.Page first = notices.list(is.id, viewer, null, null, 2);
        assertThat(first.items()).hasSize(2);
        assertThat(first.hasMore()).isTrue();
        IslandNoticeViews.Item last = first.items().get(1);
        IslandNoticeViews.Page second = notices.list(is.id, viewer, last.createdAt(), last.id(), 2);
        assertThat(second.items()).hasSize(1);
        assertThat(second.hasMore()).isFalse();

        List<UUID> seen = new ArrayList<>(first.items().stream().map(IslandNoticeViews.Item::id).toList());
        seen.addAll(second.items().stream().map(IslandNoticeViews.Item::id).toList());
        assertThat(seen).containsExactlyElementsOf(visible);
    }

    // ---------------------------------------------------------------- 게시판 상세 (GET /islands/{id}/notices/{nid})

    @Test
    @DisplayName("게시판 상세 — 차단 관계인 작성자의 공지는 어느 쪽이 열어도 NOT_FOUND, 해제하면 열린다")
    void noticeDetailOfBlockedAuthorIsNotFoundUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID ownerNotice = notices.create(is.id, is.owner, "방장 공지", "본문", key()).id();
        UUID viewerNotice = legacyNotice(is.id, viewer, "주민 공지");

        blocks.block(viewer, is.owner);
        assertThatThrownBy(() -> notices.detail(is.id, ownerNotice, viewer, null, null, PAGE))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        // 양방향 — 차단당한 방장도 차단한 주민의 공지를 열 수 없다. 작성자 본인과 제3자에게는 그대로 보인다.
        assertThatThrownBy(() -> notices.detail(is.id, viewerNotice, is.owner, null, null, PAGE))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        assertThat(notices.detail(is.id, ownerNotice, is.owner, null, null, PAGE).id()).isEqualTo(ownerNotice);
        assertThat(notices.detail(is.id, viewerNotice, other, null, null, PAGE).id()).isEqualTo(viewerNotice);
        assertThat(notices.list(is.id, is.owner, null, null, PAGE).items()).extracting(IslandNoticeViews.Item::id)
                .containsExactly(ownerNotice);

        blocks.unblock(viewer, is.owner);
        assertThat(notices.detail(is.id, ownerNotice, viewer, null, null, PAGE).title()).isEqualTo("방장 공지");
        assertThat(notices.detail(is.id, viewerNotice, is.owner, null, null, PAGE).title()).isEqualTo("주민 공지");
    }

    @Test
    @DisplayName("게시판 상세 — 차단한 사람의 댓글만 빠지고 댓글 쪽 크기·커서가 유지된다, 해제하면 돌아온다")
    void noticeDetailHidesBlockedCommentsAndKeepsPaging() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID writer = resident(is.id, GroupAnnouncementGrant.ALLOW);
        UUID noticeId = legacyNotice(is.id, writer, "주민 공지");
        List<UUID> visible = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            notices.comment(is.id, noticeId, is.owner, "방장 " + i, key());
            visible.add(notices.comment(is.id, noticeId, writer, "주민 " + i, key()).id());
        }
        UUID viewerComment = notices.comment(is.id, noticeId, viewer, "내 댓글", key()).id();
        visible.add(viewerComment);

        blocks.block(viewer, is.owner);
        IslandNoticeViews.Detail first = notices.detail(is.id, noticeId, viewer, null, null, 2);
        assertThat(first.comments()).hasSize(2);
        assertThat(first.hasMoreComments()).isTrue();
        IslandNoticeViews.Comment last = first.comments().get(1);
        IslandNoticeViews.Detail second = notices.detail(is.id, noticeId, viewer, last.createdAt(), last.id(), 2);
        assertThat(second.comments()).hasSize(2);
        assertThat(second.hasMoreComments()).isFalse();
        List<UUID> seen = new ArrayList<>(first.comments().stream().map(IslandNoticeViews.Comment::id).toList());
        seen.addAll(second.comments().stream().map(IslandNoticeViews.Comment::id).toList());
        assertThat(seen).containsExactlyElementsOf(visible);

        // 양방향 — 차단당한 방장에게도 차단한 사람의 댓글이 빠지고(6개), 작성자 본인의 댓글은 남는다.
        IslandNoticeViews.Detail ownerView = notices.detail(is.id, noticeId, is.owner, null, null, PAGE);
        assertThat(ownerView.comments()).hasSize(6);
        assertThat(ownerView.comments()).extracting(IslandNoticeViews.Comment::id).doesNotContain(viewerComment);

        blocks.unblock(viewer, is.owner);
        assertThat(notices.detail(is.id, noticeId, viewer, null, null, PAGE).comments()).hasSize(7);
        assertThat(notices.detail(is.id, noticeId, is.owner, null, null, PAGE).comments()).hasSize(7);
    }

    // ---------------------------------------------------------------- 방명록 (GET /islands/{id}/guestbook)

    @Test
    @DisplayName("방명록 — 차단 관계인 작성자의 글은 양쪽 모두에게 빠지고 제3자에게는 보인다, 해제하면 돌아온다")
    void guestbookHidesBlockedAuthorEitherDirectionUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID ownerEntry = guestbook.write(is.id, is.owner, "방장 글").id();
        UUID viewerEntry = guestbook.write(is.id, viewer, "주민 글").id();
        UUID otherEntry = guestbook.write(is.id, other, "제3자 글").id();

        blocks.block(viewer, is.owner);
        assertThat(guestbook.list(is.id, viewer, null, null, PAGE).items()).extracting(IslandGuestbookViews.Item::id)
                .containsExactly(otherEntry, viewerEntry);
        assertThat(guestbook.list(is.id, is.owner, null, null, PAGE).items()).extracting(IslandGuestbookViews.Item::id)
                .containsExactly(otherEntry, ownerEntry);
        assertThat(guestbook.list(is.id, other, null, null, PAGE).items()).extracting(IslandGuestbookViews.Item::id)
                .containsExactly(otherEntry, viewerEntry, ownerEntry);

        blocks.unblock(viewer, is.owner);
        assertThat(guestbook.list(is.id, viewer, null, null, PAGE).items()).hasSize(3);
        assertThat(guestbook.list(is.id, is.owner, null, null, PAGE).items()).hasSize(3);
    }

    @Test
    @DisplayName("방명록 — 제외가 LIMIT 전이라 쪽이 꽉 차고 keyset 커서가 빠짐·겹침 없이 이어진다")
    void guestbookKeepsPageSizeAndCursorAfterFiltering() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        // 하루 한 글이라 작성자를 여럿 둔다 — 반복마다 차단한 사람 1명·보이는 주민 1명이 번갈아 쓴다.
        List<UUID> visible = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            UUID blockedAuthor = resident(is.id, GroupAnnouncementGrant.DISALLOW);
            guestbook.write(is.id, blockedAuthor, "숨김 " + i);
            blocks.block(viewer, blockedAuthor);
            visible.add(0, guestbook.write(is.id, resident(is.id, GroupAnnouncementGrant.DISALLOW), "보임 " + i).id());
        }

        IslandGuestbookViews.Page first = guestbook.list(is.id, viewer, null, null, 2);
        assertThat(first.items()).hasSize(2);
        assertThat(first.hasMore()).isTrue();
        IslandGuestbookViews.Item last = first.items().get(1);
        IslandGuestbookViews.Page second = guestbook.list(is.id, viewer, last.createdAt(), last.id(), 2);
        assertThat(second.items()).hasSize(1);
        assertThat(second.hasMore()).isFalse();

        List<UUID> seen = new ArrayList<>(first.items().stream().map(IslandGuestbookViews.Item::id).toList());
        seen.addAll(second.items().stream().map(IslandGuestbookViews.Item::id).toList());
        assertThat(seen).containsExactlyElementsOf(visible);
    }

    // ---------------------------------------------------------------- 도서관 (GET /islands/{id}/records/…?scope=island)

    @Test
    @DisplayName("도서관 이웃 — 차단 관계인 주민은 집중·스크린타임 목록에서 양쪽 모두에게 빠진다, 해제하면 돌아온다")
    void libraryNeighborsHideBlockedResidentEitherDirectionUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID other = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        LocalDate today = LocalDate.now();

        blocks.block(viewer, is.owner);
        assertThat(records.focus(viewer, is.id, today, today, "island", null, 0).members())
                .extracting(FocusMember::userId).containsExactlyInAnyOrder(viewer, other);
        assertThat(records.focus(is.owner, is.id, today, today, "island", null, 0).members())
                .extracting(FocusMember::userId).containsExactlyInAnyOrder(is.owner, other);
        assertThat(records.screenTime(viewer, is.id, today, today, "island").members())
                .extracting(ScreenMember::userId).containsExactlyInAnyOrder(viewer, other);
        assertThat(records.screenTime(is.owner, is.id, today, today, "island").members())
                .extracting(ScreenMember::userId).containsExactlyInAnyOrder(is.owner, other);
        assertThat(records.focus(other, is.id, today, today, "island", null, 0).members())
                .extracting(FocusMember::userId).containsExactlyInAnyOrder(is.owner, viewer, other);

        blocks.unblock(viewer, is.owner);
        assertThat(records.focus(viewer, is.id, today, today, "island", null, 0).members())
                .extracting(FocusMember::userId).containsExactlyInAnyOrder(is.owner, viewer, other);
        assertThat(records.screenTime(is.owner, is.id, today, today, "island").members())
                .extracting(ScreenMember::userId).containsExactlyInAnyOrder(is.owner, viewer, other);
    }

    // ---------------------------------------------------------------- 도구

    private record Island(UUID id, UUID owner) {
    }

    private Island island() {
        UUID owner = user("방장");
        Group island = groups.save(Group.builder().name("차단섬").maxMembers(10).build());
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

    /** 새 API 는 방장 전용이라, 방장이 아닌 작성자의 공지는 legacy writer(ALLOW 주민)로 심는다. */
    private UUID legacyNotice(UUID islandId, UUID writer, String title) {
        announcements.save(GroupAnnouncement.builder().group(groups.findById(islandId).orElseThrow())
                .user(users.findById(writer).orElseThrow()).title(title).content("본문").build());
        return notices.list(islandId, writer, null, null, PAGE).items().get(0).id();
    }

    private UUID user(String prefix) {
        return users.save(User.builder().nickname(prefix + "-" + UUID.randomUUID().toString().substring(0, 8))
                .build()).getId();
    }

    private static UUID key() {
        return UUID.randomUUID();
    }
}
