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
     * <h2>기준 시각은 주 «종료 경계»다</h2>
     * 가입은 {@code created_at < boundary} 로 걸러 <b>경계 이후에 들어온 주민이 지난 주 분모에 섞이지 않게</b>
     * 한다 — 이 조건이 없으면 「크론이 실제로 실행된 순간의 인원」을 적게 되어, 경계 직후 가입만으로 지난 주
     * 분모가 커진다. {@code created_at} 이 null 인 legacy 행은 «경계보다 오래된 행»으로 보고 포함한다
     * (DB 가 NOT NULL 이 아니다 — 빼면 옛 주민이 통째로 사라진다).
     *
     * <p><b>이탈 방향은 이 쿼리로 닫을 수 없다.</b> {@code group_members} 에는 <b>이탈 시각이 없다</b> —
     * {@code left_at} 컬럼이 없고, {@code updated_at} 은 알림 토글 같은 아무 변경에도 갱신되므로 이탈의 증거가
     * 아니며, {@code created_at} 은 {@code rejoin()} 이 갱신하지 않아 «최초» 가입 시각이다. 그래서 「경계 시점에
     * 활성이었는가」를 사후에 판정할 근거가 DB 에 존재하지 않는다. 남는 창(경계 ~ 실제 실행)은 호출부의
     * 실행 유예 가드가 <b>시간으로</b> 좁힌다({@code IslandRankingFreezeService}) — 완전히 닫으려면
     * {@code group_members} 에 이탈 시각 컬럼이 필요하고, 그것은 소속 도메인의 별도 변경이다.
     *
     * <p>섬이 살아 있는지는 «여기서» 걸지 않는다 — 조회 경로가 어차피 {@code groups} 와 조인해 소프트 삭제·
     * 종료 섬을 거른다. 하드 삭제는 FK {@code ON DELETE CASCADE} 가 치운다.
     *
     * <p>{@code ON CONFLICT DO NOTHING} 이라 <b>재실행해도 이미 동결된 값을 덮지 않는다</b>. 이것이 멱등 가드다.
     * 늦게 돈 배치가 «틀린 값을 영구 고착»시키지 않는 것은 호출부의 유예 가드가 맡는다 — 유예를 넘기면 아예
     * 쓰지 않으므로, 고착되는 값은 언제나 유예 안에서 계산된 값이다.
     *
     * <p>트랜잭션 경계는 여기서 열지 않는다(규약 §4·§5) — 호출부인 {@code IslandRankingFreezeService} 가 소유한다.
     *
     * @param weekStart 동결할 주의 시작일(UTC 일요일)
     * @param boundary  그 주의 종료 경계(= 다음 주 시작 00:00Z). 이 시각 «이후» 가입은 세지 않는다
     * @return 새로 적힌 행 수. 재실행이면 0 이다
     */
    @Modifying
    @Query(value = "INSERT INTO island_weekly_member_counts (week_start, island_id, member_count) "
            + "SELECT :weekStart, gm.group_id, COUNT(*) "
            + "FROM group_members gm JOIN users u ON u.id = gm.user_id "
            + "WHERE gm.is_left = false AND u.is_deleted = false "
            + "AND (gm.created_at IS NULL OR gm.created_at < CAST(:boundary AS timestamptz)) "
            + "GROUP BY gm.group_id "
            + "ON CONFLICT (week_start, island_id) DO NOTHING", nativeQuery = true)
    int freeze(@Param("weekStart") LocalDate weekStart, @Param("boundary") Instant boundary);
}
