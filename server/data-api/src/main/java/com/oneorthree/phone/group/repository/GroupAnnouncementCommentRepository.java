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
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM GroupAnnouncementComment c WHERE c.authorId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);

    /** {@link #countByNoticeIds} 의 한 줄. */
    interface NoticeCommentCount {
        UUID getNoticeId();

        long getCount();
    }
}
