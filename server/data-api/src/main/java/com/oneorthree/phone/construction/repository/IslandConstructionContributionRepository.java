package com.oneorthree.phone.construction.repository;

import com.oneorthree.phone.construction.repository.domain.IslandConstructionContribution;
import com.oneorthree.phone.construction.repository.domain.IslandConstructionContributionId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface IslandConstructionContributionRepository
        extends JpaRepository<IslandConstructionContribution, IslandConstructionContributionId> {

    /**
     * 한 epoch 아래의 <b>대상 주민 행 전부</b> — 「각자 몫 n빵」판정이 주민별로 대조하는 집합이다.
     * 목표를 고를 때 {@link #seedCohort} 가 그 시점의 활성 주민을 {@code amount=0} 으로 심어 두므로
     * 이 목록이 곧 「목표 선택 당시의 대상 주민」이다(기획 정본 「목표 선택 시점의 주민으로 대상을
     * 고정한다」). 탈퇴·강퇴 제외는 호출측이 현재 활성 주민과의 교집합으로 한다.
     */
    List<IslandConstructionContribution> findByIslandIdAndEpoch(UUID islandId, long epoch);

    /**
     * 목표 선택 시점의 대상 주민 고정 (GROMO-1999) — 지금 이 섬의 활성 주민 전원을 이 epoch 에
     * {@code amount=0} 행으로 심는다. 퀘스트 cohort({@code island_quest_cohort_members}) 와 같은
     * 규율이되, 건설은 이미 (섬, epoch, 주민) 키의 기여 행이 있으므로 <b>표를 새로 만들지 않고</b>
     * 그 행 자체를 대상 명단으로 쓴다 — 행이 있으면 대상, 없으면 대상 아님이다.
     *
     * <p>호출측이 섬 행과 건설 상태 행을 잠근 채 부르므로 가입·탈퇴 writer 와 직렬화된다. 목표를
     * 바꾸면 epoch 이 올라가 새 명단이 다시 심긴다(기획 정본 「변경 시점의 현재 주민으로 대상을
     * 다시 정해 신규 주민도 포함한다」).
     */
    @Modifying
    @Query(value = "INSERT INTO island_construction_contributions "
            + "(island_id, epoch, user_id, amount, updated_at) "
            + "SELECT :islandId, :epoch, gm.user_id, 0, :now FROM group_members gm "
            + "WHERE gm.group_id = :islandId AND gm.is_left = false "
            + "ON CONFLICT (island_id, epoch, user_id) DO NOTHING", nativeQuery = true)
    int seedCohort(@Param("islandId") UUID islandId, @Param("epoch") long epoch,
                   @Param("now") Instant now);

    /**
     * 대상 주민의 기여 누적 — {@link #seedCohort} 가 심어 둔 행만 갱신한다. 목표 선택 뒤에 가입한
     * 주민은 행이 없어 0 행이 되고, 그게 곧 「새로 가입한 주민은 그 퀘스트에 추가하지 않는다」다.
     * 그 주민이 낚은 물고기는 섬 잔액·원장에는 그대로 들어간다.
     *
     * <p>WHERE 의 상한 조건은 더해질 합이 {@code integer} 상한을 넘을 때 갱신을 건너뛴다 — 없으면
     * PostgreSQL 이 {@code integer out of range}(22003)로 500 을 낸다. 0 행의 두 원인(대상 아님 /
     * 상한 초과)은 호출측이 행 존재로 가른다.
     *
     * @return 반영된 행 수 — 0 이면 대상이 아니거나 누적 상한을 넘은 것이다
     */
    @Modifying
    @Query(value = "UPDATE island_construction_contributions "
            + "SET amount = amount + :amount, updated_at = :now "
            + "WHERE island_id = :islandId AND epoch = :epoch AND user_id = :userId "
            + "AND amount <= 2147483647 - :amount", nativeQuery = true)
    int accumulate(@Param("islandId") UUID islandId, @Param("epoch") long epoch,
                   @Param("userId") UUID userId, @Param("amount") int amount,
                   @Param("now") Instant now);
}
