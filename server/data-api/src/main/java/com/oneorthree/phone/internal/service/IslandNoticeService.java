package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.support.BannedWords;
import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupAnnouncementCommentRepository;
import com.oneorthree.phone.group.repository.GroupAnnouncementRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncement;
import com.oneorthree.phone.group.repository.domain.GroupAnnouncementComment;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.IslandNoticeEvents;
import com.oneorthree.phone.internal.dto.IslandNoticeViews;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.repository.AggregateVersionRepository;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersion;
import com.oneorthree.phone.outbox.repository.domain.AggregateVersionId;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;

/**
 * 섬 게시판 — 공지 목록·상세(댓글 페이지)·작성·수정·삭제·댓글 작성의 Data 측 구현 (GROMO-1771, island-board
 * LLD §1~§4). 저장소는 legacy 공지({@code group_announcements})를 그대로 쓰고 댓글 테이블만 새로 둔다.
 *
 * <h2>인가 — 읽기는 누구나, 쓰기는 주민만, 둘 다 게시판 완공 뒤에만 (정책 B01·B03)</h2>
 * 목록·상세 읽기는 활성 계정이면 방문자(가입 대기자 포함)도 된다(2026-09-19 결정 V-읽기, GROMO-1904) — 판정은
 * 요청자 활성 → 섬 생존 → 게시판 완공이다. 미완공 게시판은 방문자에게도 {@code BOARD_LOCKED} 다.
 * 댓글은 활성 주민, 공지 쓰기는 방장 또는 {@code announcement_permission=ALLOW} 주민이다
 * ({@link GroupMember#canWriteAnnouncement} — legacy 와 같은 술어, 수정·삭제도 작성자를 보지 않는다).
 * 쓰기 판정 순서는 요청자 활성 → 섬 생존 → 주민 → 게시판 완공 → (공지면) 작성 권한이다. 방문자(비주민)의 쓰기는
 * 시설 잠금보다 먼저 {@code MEMBER_ONLY} 로 거절된다. 게시판 게이트는 {@code construction.facility-gates.enforce}
 * 를 따른다(기본 OFF — 적립 경로 배포 전엔 어느 섬도 지을 수 없다).
 *
 * <h2>쓰기 게이트 — {@code island-board.writes-enabled} (기본 OFF)</h2>
 * 정책 BQ02(댓글 삭제·탈퇴 처리)·BQ03(본문·댓글 상한)이 정해지기 전에는 writer 출시 금지다(island-board
 * policy). 네 쓰기는 끝까지 구현하되 이 스위치가 꺼져 있으면 receipt 선점·잠금보다 먼저 503
 * {@code NOTICE_WRITE_UNAVAILABLE} 로 거절한다({@code InternalHostTransferService} 와 같은 모양). 상한 두 값도
 * BQ03 결정 전 임시값으로 설정에서 읽는다.
 *
 * <h2>잠금 순서 (LLD §3)</h2>
 * users 공유 → 섬(groups) 배타 → 공통 명령 receipt → 공지 aggregate. legacy {@code GroupAnnouncementService}
 * 도 users 공유 → 섬 배타 → aggregate 순이라 두 경로가 같은 순서로 직렬화된다. 공지 행 자체는 따로 잠그지
 * 않는다 — 모든 공지·댓글 writer 가 먼저 섬 행을 배타로 잡으므로 그 아래에서 공지 행의 경쟁자가 없다.
 * ponytail: 섬 단위 직렬화 — 한 섬의 공지 쓰기가 몰려 병목이면 공지 행 잠금으로 좁힌다.
 *
 * <h2>version (LLD §3·§4, 정책 B08)</h2>
 * 별도 컬럼 없이 {@code aggregate_versions(NOTICE, noticeId)} 다. 생성 1, 수정·댓글·삭제마다 +1 이고 같은
 * TX 에 {@code notice.updated} 가 적힌다({@link IslandNoticeEvents}). 조회는 사건을 만들지 않는다.
 */
@Service
@Transactional(readOnly = true)
public class IslandNoticeService {

    private static final int MAX_PAGE = 100;

    private final UserQueryService users;
    private final UserRepository userRepository;
    private final GroupQueryService groups;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupAnnouncementRepository notices;
    private final GroupAnnouncementCommentRepository comments;
    private final IslandFacilityQueryService facilities;
    private final IslandNoticeEvents noticeEvents;
    private final AggregateVersionRepository aggregateVersions;
    private final PublicCommandService publicCommands;
    private final BannedWords bannedWords;
    private final boolean writesEnabled;
    private final int bodyMaxLength;
    private final int commentMaxLength;

    public IslandNoticeService(UserQueryService users, UserRepository userRepository, GroupQueryService groups,
            GroupMembershipMutationLocks membershipLocks, GroupAnnouncementRepository notices,
            GroupAnnouncementCommentRepository comments, IslandFacilityQueryService facilities,
            IslandNoticeEvents noticeEvents, AggregateVersionRepository aggregateVersions,
            PublicCommandService publicCommands, BannedWords bannedWords,
            @Value("${island-board.writes-enabled:false}") boolean writesEnabled,
            @Value("${island-board.notice-body-max-length:5000}") int bodyMaxLength,
            @Value("${island-board.comment-max-length:500}") int commentMaxLength) {
        this.users = users;
        this.userRepository = userRepository;
        this.groups = groups;
        this.membershipLocks = membershipLocks;
        this.notices = notices;
        this.comments = comments;
        this.facilities = facilities;
        this.noticeEvents = noticeEvents;
        this.aggregateVersions = aggregateVersions;
        this.publicCommands = publicCommands;
        this.bannedWords = bannedWords;
        this.writesEnabled = writesEnabled;
        this.bodyMaxLength = bodyMaxLength;
        this.commentMaxLength = commentMaxLength;
    }

    // ---------------------------------------------------------------- 조회

    /**
     * 목록 한 페이지 — {@code (createdAt DESC, id DESC)}. anchor 는 이전 페이지 마지막 행의 두 값이고 둘 다
     * 있거나 둘 다 없어야 한다. {@code commentCount} 는 같은 스냅샷에서 한 번에 센다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public IslandNoticeViews.Page list(UUID islandId, UUID userId, Instant afterCreatedAt, UUID afterId,
            int limit) {
        requireReader(islandId, userId);
        requirePageSize(limit);
        PageRequest page = PageRequest.of(0, limit + 1);
        List<GroupAnnouncement> rows = anchor(afterCreatedAt, afterId)
                ? notices.findNoticePageAfter(islandId, afterCreatedAt, afterId, page)
                : notices.findNoticeFirstPage(islandId, page);
        boolean hasMore = rows.size() > limit;
        List<GroupAnnouncement> shown = hasMore ? rows.subList(0, limit) : rows;
        Map<UUID, Long> counts = shown.isEmpty() ? Map.of()
                : comments.countByNoticeIds(shown.stream().map(GroupAnnouncement::getId).toList()).stream()
                        .collect(Collectors.toMap(
                                GroupAnnouncementCommentRepository.NoticeCommentCount::getNoticeId,
                                GroupAnnouncementCommentRepository.NoticeCommentCount::getCount));
        List<IslandNoticeViews.Item> items = shown.stream()
                .map(n -> new IslandNoticeViews.Item(n.getId(), n.getTitle(), counts.getOrDefault(n.getId(), 0L),
                        n.getCreatedAt()))
                .toList();
        return new IslandNoticeViews.Page(items, hasMore);
    }

    /**
     * 상세 — 본문·댓글 한 페이지({@code createdAt ASC, id ASC})·version 을 한 REPEATABLE_READ 스냅샷에서
     * 읽는다(LLD §4). 다른 섬의 공지 id 는 {@code NOT_FOUND} 다 — 섬 경로로 다시 좁혀 찾는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public IslandNoticeViews.Detail detail(UUID islandId, UUID noticeId, UUID userId, Instant afterCreatedAt,
            UUID afterId, int limit) {
        requireReader(islandId, userId);
        requirePageSize(limit);
        GroupAnnouncement notice = requireNotice(islandId, noticeId);
        PageRequest page = PageRequest.of(0, limit + 1);
        List<GroupAnnouncementComment> rows = anchor(afterCreatedAt, afterId)
                ? comments.findPageAfter(noticeId, afterCreatedAt, afterId, page)
                : comments.findFirstPage(noticeId, page);
        boolean hasMore = rows.size() > limit;
        List<GroupAnnouncementComment> shown = hasMore ? rows.subList(0, limit) : rows;
        Map<UUID, User> authors = userRepository.findAllById(shown.stream()
                        .map(GroupAnnouncementComment::getAuthorId).filter(Objects::nonNull).distinct().toList())
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        List<IslandNoticeViews.Comment> views = new ArrayList<>(shown.size());
        for (GroupAnnouncementComment comment : shown) {
            User author = comment.getAuthorId() == null ? null : authors.get(comment.getAuthorId());
            boolean visible = author != null && !author.isDeleted();
            views.add(new IslandNoticeViews.Comment(comment.getId(), visible ? author.getId() : null,
                    visible ? author.getNickname() : null, comment.getText(), comment.getCreatedAt()));
        }
        return new IslandNoticeViews.Detail(notice.getId(), notice.getTitle(), notice.getContent(),
                noticeVersion(noticeId), views, hasMore);
    }

    // ---------------------------------------------------------------- 쓰기 4종

    /** 공지 작성 — 새 noticeId 는 최초 성공 명령에서 한 번 발급되고 같은 키 재생은 그 결과를 돌려준다. */
    @Transactional
    public IslandNoticeViews.Notice create(UUID islandId, UUID userId, String title, String body, UUID key) {
        requireWritesEnabled();
        Map<String, Object> semantic = new LinkedHashMap<>();
        semantic.put("title", title);
        semantic.put("body", body);
        return run(userId, islandId, new PublicCommandRequest(userId, "POST:/islands/" + islandId + "/notices",
                key, InternalJson.tree(semantic)), true, () -> {
                    requireBodyLength(body);
                    bannedWords.requireClean(title, body);
                    User author = users.getCallerForShare(userId);
                    GroupAnnouncement notice = GroupAnnouncement.builder()
                            .group(groups.getGroup(islandId)).user(author).title(title).content(body).build();
                    notices.save(notice);
                    EventEnvelope event = noticeEvents.changed(islandId, notice.getId(), userId);
                    return new PublicCommandResult(201,
                            InternalJson.tree(new IslandNoticeViews.Notice(notice.getId(), title, body)),
                            InternalJson.tree(List.of(event)));
                }, IslandNoticeViews.Notice.class);
    }

    /**
     * 공지 수정 — 생략(null)은 유지다(B06). 같은 값으로 고쳐도 명령 1회에 version 이 1 오른다(LLD §3-3).
     * 지문은 실제로 보낸 필드만 담는다 — 생략과 값 있음이 같은 명령으로 섞이지 않는다.
     */
    @Transactional
    public IslandNoticeViews.Notice update(UUID islandId, UUID noticeId, UUID userId, String title, String body,
            UUID key) {
        requireWritesEnabled();
        Map<String, Object> semantic = new LinkedHashMap<>();
        if (title != null) {
            semantic.put("title", title);
        }
        if (body != null) {
            semantic.put("body", body);
        }
        return run(userId, islandId, new PublicCommandRequest(userId,
                "PATCH:/islands/" + islandId + "/notices/" + noticeId, key, InternalJson.tree(semantic)), true,
                () -> {
                    if (body != null) {
                        requireBodyLength(body);
                    }
                    bannedWords.requireClean(title, body);
                    GroupAnnouncement notice = requireNotice(islandId, noticeId);
                    notice.updateContent(title, body);
                    EventEnvelope event = noticeEvents.changed(islandId, noticeId, userId);
                    return new PublicCommandResult(200, InternalJson.tree(new IslandNoticeViews.Notice(
                            noticeId, notice.getTitle(), notice.getContent())), InternalJson.tree(List.of(event)));
                }, IslandNoticeViews.Notice.class);
    }

    /**
     * 공지 삭제 — 200 {@code deleted=true}. 같은 키 재생은 공지가 이미 없어도 원 결과다: 대상 부재 검사는
     * 명령 안에서만 하므로 완료 재생 뒤다(LLD §3). 새 키로 없는 공지를 지우면 404 다. 댓글 행은 DB 가
     * {@code notice_id} 만 비우고 남긴다(BQ02 미결 — 파기 범위 결정 전 지우지 않는다).
     */
    @Transactional
    public IslandNoticeViews.Deleted delete(UUID islandId, UUID noticeId, UUID userId, UUID key) {
        requireWritesEnabled();
        return run(userId, islandId, new PublicCommandRequest(userId,
                "DELETE:/islands/" + islandId + "/notices/" + noticeId, key, InternalJson.tree(Map.of())), true,
                () -> {
                    notices.delete(requireNotice(islandId, noticeId));
                    EventEnvelope event = noticeEvents.changed(islandId, noticeId, userId);
                    return new PublicCommandResult(200, InternalJson.tree(new IslandNoticeViews.Deleted(true)),
                            InternalJson.tree(List.of(event)));
                }, IslandNoticeViews.Deleted.class);
    }

    /** 댓글 작성 — 작성자는 검증된 요청자뿐이다. 댓글도 공지 version 을 올린다(B08). */
    @Transactional
    public IslandNoticeViews.CommentCreated comment(UUID islandId, UUID noticeId, UUID userId, String text,
            UUID key) {
        requireWritesEnabled();
        return run(userId, islandId, new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/notices/" + noticeId + "/comments", key,
                InternalJson.tree(Map.of("text", text))), false,
                () -> {
                    if (text.length() > commentMaxLength) {
                        throw new GroupException(GroupErrorCode.NOTICE_COMMENT_TOO_LONG);
                    }
                    bannedWords.requireClean(text);
                    requireNotice(islandId, noticeId);
                    GroupAnnouncementComment comment = new GroupAnnouncementComment(noticeId, userId, text);
                    comments.save(comment);
                    EventEnvelope event = noticeEvents.changed(islandId, noticeId, userId);
                    String name = users.getCallerForShare(userId).getNickname();
                    return new PublicCommandResult(201, InternalJson.tree(
                            new IslandNoticeViews.CommentCreated(comment.getId(), name, text)),
                            InternalJson.tree(List.of(event)));
                }, IslandNoticeViews.CommentCreated.class);
    }

    /**
     * 쓰기 공통 골격 — users 공유 → 섬 배타를 잡고 {@link PublicCommandService#run} 에 들어간다. 재생 권한은
     * 활성 인가와 같다: 원 결과 재생도 «지금» 주민·완공·작성 권한이 있어야 한다(B10). 공통 층이 활성 인가를
     * 재생 경로에서도 다시 부르므로 재생 검사가 따로 할 일은 없다.
     *
     * <p>본문·댓글 길이 상한(422)은 각 {@code body} 첫 줄에서 판정한다 — 인가(403)가 먼저다(api-platform LLD
     * §1 4단계, GROMO-1949). 422 는 TX 전체를 rollback 해 receipt 가 남지 않으므로 같은 키 재전송도 다시 422 다.
     */
    private <T> T run(UUID userId, UUID islandId, PublicCommandRequest command, boolean noticeWriter,
            Supplier<PublicCommandResult> body, Class<T> type) {
        User caller = users.getCallerForShare(userId);
        membershipLocks.lockGroup(islandId);
        Runnable authorize = () -> {
            GroupMember member = requireResident(islandId, caller);
            if (noticeWriter && !member.canWriteAnnouncement()) {
                throw new GroupException(GroupErrorCode.NOTICE_FORBIDDEN);
            }
        };
        return InternalJson.decode(publicCommands.run(command, authorize, stored -> { }, body).value().data(),
                type);
    }

    // ---------------------------------------------------------------- 판정

    /**
     * 읽기 인가 — 무락 일관 읽기. 요청자 활성 → 섬 생존 → 게시판 완공이고 주민 여부는 보지 않는다(방문자 읽기,
     * 2026-09-19 결정 V-읽기). 탈퇴·없는 계정은 {@code USER_NOT_FOUND}(요청자 세션 코드).
     */
    private void requireReader(UUID islandId, UUID userId) {
        users.getCaller(userId);
        requireBoard(requireAliveIsland(islandId));
    }

    /** 섬 생존 → 활성 주민 → 게시판 완공. 쓰기 전용 — 방문자는 시설 잠금보다 먼저 {@code MEMBER_ONLY} 다. */
    private GroupMember requireResident(UUID islandId, User user) {
        Group island = requireAliveIsland(islandId);
        GroupMember member = groups.getMembership(user, island);
        requireBoard(island);
        return member;
    }

    private Group requireAliveIsland(UUID islandId) {
        Group island = groups.getGroup(islandId);
        if (island.getDeletedAt() != null || island.getStatus() == GroupStatus.ENDED) {
            throw new GroupException(GroupErrorCode.GROUP_NOT_FOUND);
        }
        return island;
    }

    private void requireBoard(Group island) {
        if (!facilities.hasBoard(island.getId())) {
            throw new GroupException(GroupErrorCode.BOARD_LOCKED);
        }
    }

    private GroupAnnouncement requireNotice(UUID islandId, UUID noticeId) {
        return notices.findByIdAndGroupId(noticeId, islandId)
                .orElseThrow(() -> new GroupException(GroupErrorCode.NOT_FOUND));
    }

    private void requireWritesEnabled() {
        if (!writesEnabled) {
            throw new GroupException(GroupErrorCode.NOTICE_WRITE_UNAVAILABLE);
        }
    }

    private void requireBodyLength(String body) {
        if (body.length() > bodyMaxLength) {
            throw new GroupException(GroupErrorCode.NOTICE_BODY_TOO_LONG);
        }
    }

    /** 페이지 크기는 Business 가 정한다(기본 30) — 여기서는 상한만 지킨다. */
    private static void requirePageSize(int limit) {
        if (limit < 1 || limit > MAX_PAGE) {
            throw new IllegalArgumentException("페이지 크기는 1~" + MAX_PAGE + " 이어야 합니다.");
        }
    }

    /** anchor 두 값은 한 쌍이다 — 한쪽만 온 요청은 경계를 만들 수 없다. */
    private static boolean anchor(Instant createdAt, UUID id) {
        if ((createdAt == null) != (id == null)) {
            throw new IllegalArgumentException("커서 anchor 는 시각과 id 가 함께 와야 합니다.");
        }
        return createdAt != null;
    }

    /** 공지 aggregate 의 마지막 발급값 — 행이 없으면 0(V66 이 기존 공지를 1 로 백필한다). */
    private long noticeVersion(UUID noticeId) {
        return aggregateVersions.findById(new AggregateVersionId(IslandNoticeEvents.AGGREGATE_TYPE,
                        noticeId.toString()))
                .map(AggregateVersion::getLastVersion)
                .orElse(0L);
    }
}
