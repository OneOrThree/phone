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
 * <p>cohort 는 (회차, 주민) 두 열뿐인 불변 스냅샷이라 네이티브 쿼리로 다룬다(엔티티
 * {@code IslandQuestCohortMember} 는 스키마 선언용) —
 * 여는 순간 한 번 쓰고 이후엔 읽기만 한다. 유일한 예외는 계정 탈퇴 파기다(GROMO-1950).
 */
public interface IslandQuestOccurrenceRepository extends JpaRepository<IslandQuestOccurrence, UUID> {

    boolean existsByQuestIdAndOccurrenceDate(UUID questId, LocalDate occurrenceDate);

    /** 섬의 날짜 구간 회차 — 현재 목록(어제·오늘)을 고른다. 판정은 호출측이 claimDeadline 으로 한다. */
    List<IslandQuestOccurrence> findByIslandIdAndOccurrenceDateBetweenOrderByOccurrenceDateAscCreatedAtAsc(
            UUID islandId, LocalDate from, LocalDate to);

    /**
     * 전원 달성 보너스가 아직 적립되지 않은 «최근» 회차 (GROMO-1991) — 매분 finalizer 가 훑는다.
     *
     * <p>수령 마감은 type 마다 다르므로(focus 다음 날 12:00Z · screen 다음 날 24:00Z) 여기서는 날짜로만
     * 넉넉히 거르고, 마감·전원 달성 판정은 호출측이 회차를 잠근 뒤에 한다.
     *
     * <p><b>인덱스</b>: 섬·퀘스트 조건이 없어 {@code (island_id, …)}·{@code (quest_id, …)} 선두 인덱스를
     * 쓰지 못한다 — 아래 WHERE 와 글자 그대로 같은 부분 인덱스
     * {@code idx_island_quest_occurrences_bonus_pending (occurrence_date) WHERE bonus_settled_at IS NULL}
     * (V83)이 받는다. 적립된 회차는 인덱스에서 빠지므로 매분 훑는 비용이 누적 회차 수가 아니라
     * 미정산 회차 수에 비례한다. <b>WHERE 를 고치면 그 인덱스 조건도 같이 고쳐야 한다.</b>
     */
    @Query("SELECT o.id FROM IslandQuestOccurrence o "
            + "WHERE o.bonusSettledAt IS NULL AND o.occurrenceDate >= :from ORDER BY o.occurrenceDate ASC")
    List<UUID> findIdsPendingBonusSince(@Param("from") LocalDate from);

    /**
     * 회차의 섬 — 잠금 순서(섬 → 회차)를 지키려면 섬 id 를 <b>회차를 잠그기 전에</b> 알아야 한다.
     * 엔티티가 아니라 스칼라로 읽는 것이 핵심이다: {@code findById} 로 먼저 읽으면 그 인스턴스가 영속성
     * 컨텍스트에 남아 뒤따르는 {@link #findByIdForUpdate} 가 <b>잠금 전 스냅샷</b>을 돌려준다.
     */
    @Query("SELECT o.islandId FROM IslandQuestOccurrence o WHERE o.id = :id")
    Optional<UUID> findIslandIdById(@Param("id") UUID id);

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

    /**
     * 계정 탈퇴 파기 (GROMO-1950, 계정 LLD §4) — 탈퇴자의 cohort 행을 전 회차에서 지운다. 판정은 이미
     * 「cohort ∩ 현재 활성 주민 ∩ 활성 계정」이라 탈퇴자가 빠진 결과와 같다. 탈퇴 TX 가 섬 행을 먼저
     * 잠그므로 회차 개설의 cohort 고정과 직렬화된다.
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "DELETE FROM island_quest_cohort_members WHERE user_id = :userId", nativeQuery = true)
    int deleteCohortOfUser(@Param("userId") UUID userId);
}
