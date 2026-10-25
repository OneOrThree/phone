package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandGuestbookEntry;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 섬 방명록 (GROMO-2262, V113). */
public interface IslandGuestbookEntryRepository extends JpaRepository<IslandGuestbookEntry, UUID> {

    /**
     * 요청자({@code :viewerId})와 작성자 사이에 어느 방향이든 차단이 있으면 글을 빼는 조건 (GROMO-2469) — 공지·댓글과
     * 같은 규칙이고 LIMIT 전에 걸어 쪽 크기·keyset 경계가 그대로다. 원문은 지우지 않아 해제하면 다시 보인다.
     */
    String NOT_BLOCKED_AUTHOR = " AND NOT EXISTS (SELECT 1 FROM UserBlock b"
            + " WHERE (b.blocker.id = :viewerId AND b.blocked.id = e.authorId)"
            + " OR (b.blocked.id = :viewerId AND b.blocker.id = e.authorId))";

    /** 삭제되지 않은 글의 첫 페이지 — 요청자와 차단 관계인 작성자의 글은 뺀다. */
    @Query("SELECT e FROM IslandGuestbookEntry e WHERE e.islandId = :islandId AND e.deletedAt IS NULL"
            + NOT_BLOCKED_AUTHOR + " ORDER BY e.createdAt DESC, e.id DESC")
    List<IslandGuestbookEntry> findFirstPage(@Param("islandId") UUID islandId, @Param("viewerId") UUID viewerId,
            Pageable page);

    /** 마지막 행의 값으로 이어 읽는다 — 경계 글이 삭제되어도 다음 페이지를 읽을 수 있다. 차단 제외는 첫 페이지와 같다. */
    @Query("SELECT e FROM IslandGuestbookEntry e WHERE e.islandId = :islandId AND e.deletedAt IS NULL"
            + " AND (e.createdAt < :createdAt OR (e.createdAt = :createdAt AND e.id < :id))" + NOT_BLOCKED_AUTHOR
            + " ORDER BY e.createdAt DESC, e.id DESC")
    List<IslandGuestbookEntry> findPageAfter(@Param("islandId") UUID islandId, @Param("viewerId") UUID viewerId,
            @Param("createdAt") Instant createdAt, @Param("id") UUID id, Pageable page);

    /**
     * 그날 이미 썼는가 — 지워진 행도 센다. 유니크 키가 deleted_at 을 모르므로 섬장이 지운 날 다시 쓰게 하면
     * 제약 위반이 된다(하루 1개는 «쓴 횟수» 이지 «살아 있는 글 수» 가 아니다).
     */
    boolean existsByIslandIdAndAuthorIdAndWrittenOn(UUID islandId, UUID authorId, LocalDate writtenOn);

    Optional<IslandGuestbookEntry> findByIdAndIslandIdAndDeletedAtIsNull(UUID id, UUID islandId);

    /**
     * 탈퇴자가 쓴 방명록을 지운 글까지 원문째 지운다 (GROMO-2262 × 계정 LLD §4). 사용자 행은 소프트 삭제라 V113 의
     * {@code ON DELETE CASCADE} 가 돌지 않는다 — 안 지우면 본문과 작성자 UUID 가 남는다. 공지 댓글과 같은 선례
     * ({@code GroupAnnouncementCommentRepository#deleteAllOfUser}, 2026-09-25 결정 GROMO-2136)다: 방문자가 남긴
     * 짧은 글은 다른 사람의 판정·정산 근거가 아니라 작성자 연결만 끊을 이유가 없다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM IslandGuestbookEntry e WHERE e.authorId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);

}
