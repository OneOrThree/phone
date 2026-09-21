package com.oneorthree.phone.ranking.repository;

import com.oneorthree.phone.ranking.repository.domain.IslandWeeklyMemberCount;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;

/** 주간 섬 랭킹의 동결된 분모 (GROMO-1997, V85). */
public interface IslandWeeklyMemberCountRepository
        extends JpaRepository<IslandWeeklyMemberCount, IslandWeeklyMemberCount.Key> {

    /**
     * 「{@code :boundary} 시점에 이 섬의 주민이었는가」 — <b>과거 시점 소속 판정의 단일 정본</b>
     * (GROMO-2050). 별칭은 {@code gm} 이고 {@code :boundary} 는 {@code timestamptz} 로 캐스팅해 쓴다.
     *
     * <p>주 경계를 다루는 다른 배치(회관 기록 등)도 같은 판정이 필요하면 <b>이 문자열을 쓴다</b> —
     * 같은 술어를 두 벌 적는 순간 한쪽만 고쳐져 두 화면의 주민 수가 갈린다. 재구현이 필요하면
     * 먼저 여기로 온다. 계층상 {@code ranking} 은 {@code group}(5)보다 아래(4)라 이 판정을 소속
     * 도메인에 둘 수 없다 — 대신 {@code ranking} 위의 모든 도메인이 이 상수를 가져다 쓸 수 있다.
     *
     * <h2>두 방향이 모두 닫혀 있다</h2>
     * <ul>
     *   <li><b>가입 방향</b> — 시작 시각은 {@code COALESCE(rejoined_at, created_at)} 이다. {@code created_at}
     *       은 {@code rejoin()} 이 갱신하지 않는 «행이 생긴 시각»이라 그것만 보면 <b>경계 뒤에 돌아온
     *       주민이 지난 주 주민으로 잡힌다</b>. NULL(legacy 행)은 «경계보다 오래된 행»으로 보고 포함한다 —
     *       DB 가 NOT NULL 이 아니라, 빼면 옛 주민이 통째로 사라진다.</li>
     *   <li><b>이탈 방향</b> — 지금 나가 있어도 <b>경계 «뒤»에</b> 나갔으면 그 주의 주민이다. 이 조건이
     *       없으면 주 경계 직후 강퇴만으로 지난 주 분모가 줄어 평균이 오른다(RK-D12 가 닫으려던 구멍).
     *       {@code left_at} 이 NULL 인 이탈 행은 V94 이전에 나간 행이라 근거가 없다 — 어느 경계에서도
     *       주민이 아닌 쪽으로 판정한다(종전 {@code is_left = false} 동작과 같다).</li>
     * </ul>
     *
     * <p><b>탈퇴 계정을 따로 거르지 않는다.</b> 계정 탈퇴는 같은 트랜잭션에서 그 사람의 «모든» 활성
     * 멤버십에 {@code leave()} 를 밟고({@code GroupMemberService.detachWithdrawnUser}), 그 이전 데이터는
     * V30 이 일괄 이탈 처리했다 — 「탈퇴 계정 = 이탈한 멤버십」이라 {@code users} 조인은 같은 것을 두
     * 번 묻는다. 오히려 조인을 남기면 <b>경계 뒤의 계정 탈퇴가 지난 주 분모를 줄인다</b> — 강퇴 대신
     * 탈퇴를 누르는 같은 조작이 열린 채로 남는다. 모수는 여전히 «동결 시점»에
     * {@code GroupMemberRepository.countByGroupIdIn} 과 같다(RK-D01).
     *
     * <p>ponytail: 멤버십 행이 (user, group) 당 하나라 <b>세대는 한 벌만</b> 표현된다 — 경계 뒤에 나갔다가
     * 또 돌아오면 그 한 벌이 덮여 경계 시점 소속을 잃는다. 동결은 경계 직후에 한 번 돌고
     * {@code ON CONFLICT DO NOTHING} 이라 실제 창은 「경계 ~ 배치 실행」뿐이다. 이걸 닫으려면 멤버십
     * 이력 표가 필요한데, 그 비용은 이 창의 크기에 비해 크다.
     */
    String ACTIVE_AT_BOUNDARY_SQL =
            "(COALESCE(gm.rejoined_at, gm.created_at) IS NULL "
            + "OR COALESCE(gm.rejoined_at, gm.created_at) < CAST(:boundary AS timestamptz)) "
            + "AND (gm.is_left = false "
            + "OR (gm.left_at IS NOT NULL AND gm.left_at >= CAST(:boundary AS timestamptz)))";

    /**
     * 그 주의 동결된 분모 전부. 행이 없는 섬은 «그 주에 분모가 없다»는 뜻이고, 호출측은 그 섬을 랭킹에서
     * 빼야 한다 — 지금 인원으로 채우면 동결이 막으려던 강퇴 조작이 그대로 돌아온다.
     */
    List<IslandWeeklyMemberCount> findByWeekStart(LocalDate weekStart);

    /**
     * 끝난 주의 분모를 한 문장으로 동결한다 (GROMO-1997).
     *
     * <h2>기준 시각은 «크론이 돈 순간»이 아니라 주 «종료 경계»다</h2>
     * 세는 것은 {@link #ACTIVE_AT_BOUNDARY_SQL} 이 판정하는 「그 경계에 주민이었던 사람」이다 — 가입·이탈
     * <b>양방향</b>이 그 한 술어에 들어 있다(GROMO-2050). 그래서 배치가 언제 돌든 값이 같고, 경계 직후의
     * 가입·탈퇴·강퇴 어느 쪽으로도 지난 주 분모가 움직이지 않는다.
     *
     * <p>모수는 «동결 시점»에 {@code GroupMemberRepository.countByGroupIdIn} 과 <b>같다</b>(RK-D01) —
     * 주민 목록·정원 판정과 같은 기준이라 「목록 N명 · 분모 N+1명」이 생기지 않는다. 멤버가 0인 섬은
     * {@code GROUP BY} 에서 행 자체가 나오지 않으므로 자연히 빠진다(CHECK {@code member_count > 0} 과 짝이다).
     *
     * <p>섬이 살아 있는지는 «여기서» 걸지 않는다 — 조회 경로가 어차피 {@code groups} 와 조인해 소프트 삭제·
     * 종료 섬을 거른다. 하드 삭제는 FK {@code ON DELETE CASCADE} 가 치운다.
     *
     * <p>{@code ON CONFLICT DO NOTHING} 이라 <b>재실행해도 이미 동결된 값을 덮지 않는다</b>. 이것이 멱등 가드다.
     *
     * <p>트랜잭션 경계는 여기서 열지 않는다(규약 §4·§5) — 호출부인 {@code IslandRankingFreezeService} 가 소유한다.
     *
     * @param weekStart 동결할 주의 시작일(UTC 일요일)
     * @param boundary  그 주의 종료 경계(= 다음 주 시작 00:00Z). 이 시각에 주민이었던 사람만 센다
     * @return 새로 적힌 행 수. 재실행이면 0 이다
     */
    @Modifying
    @Query(value = "INSERT INTO island_weekly_member_counts (week_start, island_id, member_count) "
            + "SELECT :weekStart, gm.group_id, COUNT(*) "
            + "FROM group_members gm "
            + "WHERE " + ACTIVE_AT_BOUNDARY_SQL + " "
            + "GROUP BY gm.group_id "
            + "ON CONFLICT (week_start, island_id) DO NOTHING", nativeQuery = true)
    int freeze(@Param("weekStart") LocalDate weekStart, @Param("boundary") Instant boundary);
}
