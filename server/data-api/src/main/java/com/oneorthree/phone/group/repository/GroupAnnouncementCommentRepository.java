package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupAnnouncementComment;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 공지 댓글 조회 (GROMO-1771). 정렬 키는 불변인 {@code (createdAt ASC, id ASC)} 다 — 같은 시각의 댓글도
 * id 가 동률을 깨므로 페이지 경계에서 빠지거나 겹치지 않는다(LLD §4). anchor 행이 지워져도 값으로 seek 한다.
 */
public interface GroupAnnouncementCommentRepository extends JpaRepository<GroupAnnouncementComment, UUID> {

    @Query("SELECT c FROM GroupAnnouncementComment c WHERE c.noticeId = :noticeId"
            + " ORDER BY c.createdAt ASC, c.id ASC")
    List<GroupAnnouncementComment> findFirstPage(@Param("noticeId") UUID noticeId, Pageable page);

    @Query("SELECT c FROM GroupAnnouncementComment c WHERE c.noticeId = :noticeId"
            + " AND (c.createdAt > :createdAt OR (c.createdAt = :createdAt AND c.id > :id))"
            + " ORDER BY c.createdAt ASC, c.id ASC")
    List<GroupAnnouncementComment> findPageAfter(@Param("noticeId") UUID noticeId,
            @Param("createdAt") Instant createdAt, @Param("id") UUID id, Pageable page);

    /** 목록의 {@code commentCount} — 한 페이지의 공지들을 한 번에 센다. 댓글이 없는 공지는 결과에 없다. */
    @Query("SELECT c.noticeId AS noticeId, COUNT(c) AS count FROM GroupAnnouncementComment c"
            + " WHERE c.noticeId IN :noticeIds GROUP BY c.noticeId")
    List<NoticeCommentCount> countByNoticeIds(@Param("noticeIds") Collection<UUID> noticeIds);

    /**
     * 탈퇴자가 쓴 댓글을 원문째 지운다 (GROMO-1771 × GROMO-1801 계정 LLD §4, 2026-09-25 결정 GROMO-2136 — BQ02
     * 확정). 공지({@code group_announcements.user_id})는 여전히 작성자 연결만 끊고 행·내용을 보존하지만, 댓글은
     * detach 가 아니라 delete 다 — 사용자 행은 소프트 삭제라 V66 의 {@code ON DELETE SET NULL} 이 발동하지 않는다.
     *
     * <p>호출측({@code GroupMemberService.eraseWithdrawnUserRecords})은 이 벌크 삭제 <b>전에</b>
     * {@link #findDistinctNoticesCommentedByUser} 로 영향받는 (섬, 공지) 쌍을 먼저 읽어 둔다 — 지운 뒤에는
     * 어떤 공지의 댓글이 사라졌는지 더 이상 알 수 없기 때문이다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM GroupAnnouncementComment c WHERE c.authorId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);

    /**
     * 탈퇴 처리 전 판정 — 이 작성자가 댓글을 남긴 공지들의 (섬, 공지) 쌍 (GROMO-2137 코드리뷰 대응). 댓글은
     * {@code notice_id} 만 들고 연관관계가 없어(클래스 Javadoc 참조) 원문 테이블에 직접 조인한다.
     *
     * <p>{@link #deleteAllOfUser} 가 댓글을 원문째 지우면 다른 주민의 목록·상세({@code commentCount})가 그
     * 변화를 모르게 된다 — 호출측은 삭제 <b>전</b>에 이 조회로 대상 공지를 모아 두고, 삭제 <b>후</b> 같은
     * 트랜잭션에서 공지마다 {@code IslandNoticeEvents#changed} 를 한 번씩 불러 {@code notice.updated} 를 낸다.
     * 이미 공지가 지워진 고아 댓글(현재는 V103 CASCADE 로 생기지 않는다)은 조인에 걸리지 않아 함께 빠진다.
     *
     * @param userId 댓글 작성자
     * @return 그 작성자가 댓글을 남긴 공지 하나당 한 행. 댓글이 없으면 빈 목록
     */
    @Query(value = "SELECT DISTINCT n.group_id AS \"islandId\", c.notice_id AS \"noticeId\" "
            + "FROM group_announcement_comments c JOIN group_announcements n ON n.id = c.notice_id "
            + "WHERE c.author_id = :userId", nativeQuery = true)
    List<CommentedNotice> findDistinctNoticesCommentedByUser(@Param("userId") UUID userId);

    /** {@link #countByNoticeIds} 의 한 줄. */
    interface NoticeCommentCount {
        UUID getNoticeId();

        long getCount();
    }

    /** {@link #findDistinctNoticesCommentedByUser} 의 한 줄 — 댓글을 남긴 공지와 그 공지가 속한 섬. */
    interface CommentedNotice {
        UUID getIslandId();

        UUID getNoticeId();
    }
}
