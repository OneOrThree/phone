package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSettlement;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * v0.3 세션 정산 (GROMO-1924). finish 가 세션당 한 행을 남긴다.
 *
 * <p>GROMO-1990 부터 이 행은 <b>지급의 근거가 아니라 확정 기록</b>이다 — 물고기는 매분 적립 틱이
 * 이미 넣었고({@code focus_reward_accruals}), finish 는 그 합을 옮겨 적을 뿐이다. 하루 상한 합산도
 * {@link FocusRewardAccrualRepository#sumEarnedFishOnDay} 로 옮겼다: 정산 행의 {@code completedAt} 을
 * 축으로 쓰면 진행 중 적립분이 상한에 잡히지 않는다.
 *
 * <p>GROMO-1998 부터 <b>서버가 끝낸 정산</b>(휴식 1시간 초과 자동 종료)도 이 표에 같은 모양으로 남고,
 * {@code auto_closed} 와 {@code acknowledged_at} 이 「다음 접속에 한 번 보여줄 결과」를 표현한다.
 */
public interface FocusSettlementRepository extends JpaRepository<FocusSettlement, UUID> {

    /**
     * 미확인 자동 종료 결과 (GROMO-1998) — 이 사용자의 세션 중 <b>서버가 끝냈고 아직 안 보여 준</b> 정산.
     *
     * <p>사용자당 진행 세션은 최대 1건(V58 부분 UNIQUE)이라 미확인 결과도 보통 0~1건이지만, 확인 없이
     * 다음 집중을 시작·자동 종료하면 쌓일 수 있다. 그래서 <b>가장 오래된 것부터</b> 준다 — 앱이 한 번에
     * 하나씩 보여 주고 확인하면 순서대로 비워진다.
     *
     * <p>{@code user_id} 가 끊긴 행(탈퇴 익명화)은 조건에서 자연히 빠진다.
     *
     * @param userId 조회 주체
     * @param limit  앱이 한 번에 소비할 건수
     * @return 오래된 순 미확인 자동 종료 정산
     */
    @Query("SELECT s FROM FocusSettlement s, FocusSessionDetail d "
            + "WHERE d.sessionId = s.sessionId AND d.userId = :userId "
            + "AND s.autoClosed = true AND s.acknowledgedAt IS NULL "
            + "ORDER BY s.completedAt ASC")
    List<FocusSettlement> findUnacknowledgedAutoClosed(@Param("userId") UUID userId, Limit limit);

    /**
     * 자동 종료 결과를 확인 처리한다 (GROMO-1998). {@code acknowledged_at IS NULL} 조건부 원자적
     * UPDATE 라 재접속·동시 접속·재시도에도 <b>최초 1회만</b> 세팅된다 —
     * {@code LeagueWeeklyResultRepository#acknowledge} 와 같은 관례다.
     *
     * <p>{@code auto_closed} 조건을 함께 건다: finish 로 끝난 정산은 결과를 그 자리에서 이미 돌려줬으므로
     * 확인 시각을 남길 대상이 아니다(그 행에 시각이 찍히면 「자동 종료분을 보여 줬다」는 뜻이 오염된다).
     *
     * @param sessionId 확인할 세션 — 호출측이 주인을 먼저 검증한다
     * @param now       확인 시각
     * @return 실제로 확인 처리된 행 수(0 또는 1). 0 은 이미 확인했거나 대상이 아니라는 뜻이고 오류가 아니다
     */
    // flushAutomatically 도 함께 켠다(GROMO-801 예방) — flush 없이 clear 만 하면 그 시점까지의 미flush
    // 변경이 통째로 버려진다. LeagueWeeklyResultRepository.acknowledge 와 같은 이유다.
    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE FocusSettlement s SET s.acknowledgedAt = :now "
            + "WHERE s.sessionId = :sessionId AND s.autoClosed = true AND s.acknowledgedAt IS NULL")
    int acknowledge(@Param("sessionId") UUID sessionId, @Param("now") Instant now);
}
