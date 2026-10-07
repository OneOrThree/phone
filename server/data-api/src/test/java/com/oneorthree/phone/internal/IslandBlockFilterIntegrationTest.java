package com.oneorthree.phone.internal;

import com.oneorthree.phone.group.dto.CreateAnnouncementRequest;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementGrant;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.service.GroupAnnouncementService;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.internal.dto.MailboxViewerResponse;
import com.oneorthree.phone.internal.dto.MessageAuthorsResponse;
import com.oneorthree.phone.internal.service.InternalIslandMailboxService;
import com.oneorthree.phone.internal.service.IslandNoticeService;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 섬 편지방·게시판의 차단 제외 (GROMO-2181, character-report policy RP-차단) — 실제 Flyway PostgreSQL 위에서
 * «차단하면 빠진다 → 해제하면 돌아온다 → 방향은 한쪽뿐이다» 세 경우와, 제외가 LIMIT 전에 일어나 쪽 크기·keyset
 * 커서가 그대로라는 것을 본다. 차단·해제는 공개 {@code POST/DELETE /blocks} 가 타는 {@link UserBlockService} 로 건다.
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
        registry.add("island-board.writes-enabled", () -> true);
    }

    @Autowired
    IslandNoticeService notices;
    @Autowired
    GroupAnnouncementService legacy;
    @Autowired
    InternalIslandMailboxService mailbox;
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
    @DisplayName("편지방 — 한 방향이다: 차단당한 쪽이 보는 차단한 사람의 메시지는 숨기지 않는다")
    void mailboxHideIsOneDirectional() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);

        blocks.block(viewer, is.owner);
        MessageAuthorsResponse ownerView = mailbox.authors(is.id, is.owner, List.of(viewer));
        assertThat(ownerView.hiddenUserIds()).isEmpty();
        assertThat(ownerView.authors()).extracting(MailboxViewerResponse::userId).containsExactly(viewer);
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
    @DisplayName("게시판 상세 — 차단한 작성자의 공지는 id 로 열어도 NOT_FOUND, 해제하면 열린다")
    void noticeDetailOfBlockedAuthorIsNotFoundUntilUnblocked() {
        Island is = island();
        UUID viewer = resident(is.id, GroupAnnouncementGrant.DISALLOW);
        UUID ownerNotice = notices.create(is.id, is.owner, "방장 공지", "본문", key()).id();

        blocks.block(viewer, is.owner);
        assertThatThrownBy(() -> notices.detail(is.id, ownerNotice, viewer, null, null, PAGE))
                .extracting("errorCode").isEqualTo(GroupErrorCode.NOT_FOUND);
        // 한 방향 — 차단당한 방장 자신과 다른 주민에게는 그대로 보인다.
        assertThat(notices.detail(is.id, ownerNotice, is.owner, null, null, PAGE).id()).isEqualTo(ownerNotice);

        blocks.unblock(viewer, is.owner);
        assertThat(notices.detail(is.id, ownerNotice, viewer, null, null, PAGE).title()).isEqualTo("방장 공지");
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

        // 한 방향 — 차단당한 방장은 차단한 사람의 댓글을 그대로 본다.
        assertThat(notices.detail(is.id, noticeId, is.owner, null, null, PAGE).comments())
                .extracting(IslandNoticeViews.Comment::id).contains(viewerComment);

        blocks.unblock(viewer, is.owner);
        assertThat(notices.detail(is.id, noticeId, viewer, null, null, PAGE).comments()).hasSize(7);
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
        legacy.createAnnouncement(islandId, writer, new CreateAnnouncementRequest(title, "본문"));
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
