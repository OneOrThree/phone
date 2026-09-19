package com.oneorthree.phone.quest.repository;

import com.oneorthree.phone.quest.repository.domain.IslandQuestOccurrence;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 회차와 그 판정 대상(cohort) 창구 (GROMO-1773).
 *
 * <p>cohort 는 (회차, 주민) 두 열뿐인 불변 스냅샷이라 엔티티를 두지 않고 네이티브 쿼리 두 개로 다룬다 —
 * 여는 순간 한 번 쓰고 이후엔 읽기만 한다.
 */
public interface IslandQuestOccurrenceRepository extends JpaRepository<IslandQuestOccurrence, UUID> {

    boolean existsByQuestIdAndOccurrenceDate(UUID questId, LocalDate occurrenceDate);

    /** 섬의 날짜 구간 회차 — 현재 목록(어제·오늘)을 고른다. 판정은 호출측이 claimDeadline 으로 한다. */
    List<IslandQuestOccurrence> findByIslandIdAndOccurrenceDateBetweenOrderByOccurrenceDateAscCreatedAtAsc(
            UUID islandId, LocalDate from, LocalDate to);

    /** 정산 전용 배타 잠금 — 섬 잠금 뒤, 지갑 잠금 앞(LLD §5). 반드시 트랜잭션 안에서. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT o FROM IslandQuestOccurrence o WHERE o.id = :id")
    Optional<IslandQuestOccurrence> findByIdForUpdate(@Param("id") UUID id);

    /**
     * 회차 시작 cohort 고정(결정 Q-3) — 지금 이 섬의 활성 멤버 전원을 복사한다. 호출측이 섬 행을 잠근
     * 채 부르므로 가입·탈퇴 writer 와 직렬화된다. 이후 가입자는 여기에 없어 판정에서 빠진다.
     */
    @Modifying
    @Query(value = "INSERT INTO island_quest_cohort_members (occurrence_id, user_id) "
            + "SELECT :occurrenceId, gm.user_id FROM group_members gm "
            + "WHERE gm.group_id = :islandId AND gm.is_left = false", nativeQuery = true)
    int snapshotCohort(@Param("occurrenceId") UUID occurrenceId, @Param("islandId") UUID islandId);

    /** 고정된 cohort — 탈퇴·강퇴·계정 비활성 제외는 호출측이 현재 활성 멤버와 교집합으로 한다. */
    @Query(value = "SELECT user_id FROM island_quest_cohort_members WHERE occurrence_id = :occurrenceId",
            nativeQuery = true)
    List<UUID> findCohort(@Param("occurrenceId") UUID occurrenceId);
}
