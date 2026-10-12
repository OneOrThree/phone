package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.IslandGuestbookEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** 섬 방명록 (GROMO-2262, V108). */
public interface IslandGuestbookEntryRepository extends JpaRepository<IslandGuestbookEntry, UUID> {

    /** 최근 30개 — 목록의 전부다(그 뒤는 쓰기 때 지워진다). */
    List<IslandGuestbookEntry> findTop30ByIslandIdAndDeletedAtIsNullOrderByCreatedAtDescIdDesc(UUID islandId);

    /**
     * 그날 이미 썼는가 — 지워진 행도 센다. 유니크 키가 deleted_at 을 모르므로 섬장이 지운 날 다시 쓰게 하면
     * 제약 위반이 된다(하루 1개는 «쓴 횟수» 이지 «살아 있는 글 수» 가 아니다).
     */
    boolean existsByIslandIdAndAuthorIdAndWrittenOn(UUID islandId, UUID authorId, LocalDate writtenOn);

    Optional<IslandGuestbookEntry> findByIdAndIslandIdAndDeletedAtIsNull(UUID id, UUID islandId);

    /**
     * 탈퇴자가 쓴 방명록을 지운 글까지 원문째 지운다 (GROMO-2262 × 계정 LLD §4). 사용자 행은 소프트 삭제라 V108 의
     * {@code ON DELETE CASCADE} 가 돌지 않는다 — 안 지우면 본문과 작성자 UUID 가 남는다. 공지 댓글과 같은 선례
     * ({@code GroupAnnouncementCommentRepository#deleteAllOfUser}, 2026-09-25 결정 GROMO-2136)다: 방문자가 남긴
     * 짧은 글은 다른 사람의 판정·정산 근거가 아니라 작성자 연결만 끊을 이유가 없다.
     */
    @Modifying(flushAutomatically = true)
    @Query("DELETE FROM IslandGuestbookEntry e WHERE e.authorId = :userId")
    int deleteAllOfUser(@Param("userId") UUID userId);

    /** 31번째 이후(오래된 순)를 지운다 — 쓰기 직후 같은 TX 에서 부른다. */
    @Modifying
    @Query(value = "UPDATE island_guestbook_entries SET deleted_at = :now "
            + "WHERE island_id = :islandId AND deleted_at IS NULL AND id NOT IN ("
            + "SELECT id FROM island_guestbook_entries WHERE island_id = :islandId AND deleted_at IS NULL "
            + "ORDER BY created_at DESC, id DESC LIMIT 30)", nativeQuery = true)
    int trimBeyondLatest30(@Param("islandId") UUID islandId, @Param("now") Instant now);
}
