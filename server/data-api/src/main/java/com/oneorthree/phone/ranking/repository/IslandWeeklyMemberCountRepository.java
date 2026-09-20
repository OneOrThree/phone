package com.oneorthree.phone.ranking.repository;

import com.oneorthree.phone.ranking.repository.domain.IslandWeeklyMemberCount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

/** 주간 섬 랭킹의 동결된 분모 (GROMO-1997, V85). */
public interface IslandWeeklyMemberCountRepository
        extends JpaRepository<IslandWeeklyMemberCount, IslandWeeklyMemberCount.Key> {

    /**
     * 그 주의 동결된 분모 전부. 행이 없는 섬은 «그 주에 분모가 없다»는 뜻이고, 호출측은 그 섬을 랭킹에서
     * 빼야 한다 — 지금 인원으로 채우면 동결이 막으려던 강퇴 조작이 그대로 돌아온다.
     */
    List<IslandWeeklyMemberCount> findByWeekStart(LocalDate weekStart);

    /**
     * 끝난 주의 분모를 한 문장으로 동결한다 (GROMO-1997).
     *
     * <p>모수는 {@code GroupMemberRepository.countByGroupIdIn} 과 <b>같다</b> — 활성 멤버십
     * ({@code is_left = false}) + 미탈퇴 계정({@code is_deleted = false}). 주민 목록·정원 판정과 같은 기준이라
     * 「목록 N명 · 분모 N+1명」이 생기지 않는다. 멤버가 0인 섬은 {@code GROUP BY} 에서 행 자체가 나오지
     * 않으므로 자연히 빠진다(CHECK {@code member_count > 0} 과 짝이다).
     *
     * <p>섬이 살아 있는지는 «여기서» 걸지 않는다 — 조회 경로가 어차피 {@code groups} 와 조인해 소프트 삭제·
     * 종료 섬을 거른다. 하드 삭제는 FK {@code ON DELETE CASCADE} 가 치운다.
     *
     * <p>{@code ON CONFLICT DO NOTHING} 이라 <b>재실행해도 이미 동결된 값을 덮지 않는다</b>. 이것이 멱등 가드다 —
     * 배치가 두 번 돌거나 늦게 돌아도 그 주의 분모는 «처음 적힌 값» 그대로다. 덮어쓰기로 만들면 하루 늦게 돈
     * 배치가 하루치 이탈을 반영해 버려 동결의 의미가 사라진다.
     *
     * <p>트랜잭션 경계는 여기서 열지 않는다(규약 §4·§5) — 호출부인 {@code IslandRankingFreezeService} 가 소유한다.
     *
     * @param weekStart 동결할 주의 시작일(UTC 일요일)
     * @return 새로 적힌 행 수. 재실행이면 0 이다
     */
    @Modifying
    @Query(value = "INSERT INTO island_weekly_member_counts (week_start, island_id, member_count) "
            + "SELECT :weekStart, gm.group_id, COUNT(*) "
            + "FROM group_members gm JOIN users u ON u.id = gm.user_id "
            + "WHERE gm.is_left = false AND u.is_deleted = false "
            + "GROUP BY gm.group_id "
            + "ON CONFLICT (week_start, island_id) DO NOTHING", nativeQuery = true)
    int freeze(@Param("weekStart") LocalDate weekStart);
}
