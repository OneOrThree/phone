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

    /** 31번째 이후(오래된 순)를 지운다 — 쓰기 직후 같은 TX 에서 부른다. */
    @Modifying
    @Query(value = "UPDATE island_guestbook_entries SET deleted_at = :now "
            + "WHERE island_id = :islandId AND deleted_at IS NULL AND id NOT IN ("
            + "SELECT id FROM island_guestbook_entries WHERE island_id = :islandId AND deleted_at IS NULL "
            + "ORDER BY created_at DESC, id DESC LIMIT 30)", nativeQuery = true)
    int trimBeyondLatest30(@Param("islandId") UUID islandId, @Param("now") Instant now);
}
