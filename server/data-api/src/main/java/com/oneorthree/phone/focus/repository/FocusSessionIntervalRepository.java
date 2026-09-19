package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSessionInterval;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * v0.3 세션 구간 창구 (GROMO-1764). 세션 전체 구간을 한 번에 읽어(보통 세션당 몇 건뿐) 서비스가
 * 열린 구간 찾기·activeSeconds 합산·다음 ordinal 계산을 메모리에서 처리한다 — 매 판정마다
 * 별도 쿼리를 추가하지 않는다.
 */
public interface FocusSessionIntervalRepository extends JpaRepository<FocusSessionInterval, Long> {

    List<FocusSessionInterval> findBySessionIdOrderByOrdinalAsc(UUID sessionId);

    /** 여러 세션의 구간을 한 번에 — 섬 주민 스냅샷의 N+1 방지(GROMO-1765). */
    List<FocusSessionInterval> findBySessionIdInOrderByOrdinalAsc(Collection<UUID> sessionIds);

    /**
     * 레거시 완료 업로드의 중복 적립 검사(GROMO-1924, 선행 조건 #3) — {@code [start, end)} 블록이 이 사용자의
     * v0.3 세션 ACTIVE 구간과 겹치는가. 열린 구간은 끝이 없는 것으로 본다(진행 중이라 끝을 모른다).
     *
     * @param userId     업로드 주체
     * @param lifecycles 이미 적립됐거나 적립될 세션의 lifecycle(ACTIVE·PAUSED·COMPLETED). 정산 없이 끝난
     *                   세션(ABANDONED·MEMBERSHIP_LOST)은 빠진다 — 적립한 적이 없으니 이중 적립이 아니다
     * @param start      블록 시작(포함)
     * @param end        블록 끝(제외)
     * @return 한 순간이라도 겹치면 true
     */
    @Query("SELECT COUNT(i) > 0 FROM FocusSessionInterval i, FocusSessionDetail d "
            + "WHERE d.sessionId = i.sessionId AND d.userId = :userId AND d.lifecycle IN :lifecycles "
            + "AND i.kind = com.oneorthree.phone.focus.repository.domain.FocusIntervalKind.ACTIVE "
            + "AND i.startedAt < :end AND (i.endedAt IS NULL OR i.endedAt > :start)")
    boolean existsActiveOverlap(@Param("userId") UUID userId,
                                @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
                                @Param("start") Instant start, @Param("end") Instant end);

    /**
     * 탈퇴 정리 — 탈퇴자 세션의 열린 구간을 닫는다. 상세를 {@code ABANDONED}로 종결하면서 구간을
     * 열어 두면 "끝나지 않는 집중"이 그대로 남아 이후 어떤 집계도 {@code now}까지 세게 된다.
     *
     * <p>{@code ended_at}을 {@code max(now, started_at)}으로 두는 것은 서버 벽시계가 뒤로 간 경우에도
     * V58의 {@code focus_session_intervals_order_ck}를 위반하지 않기 위해서다 — 탈퇴가 시계 보정과
     * 겹쳤다고 실패하면 계정 삭제 전체가 롤백된다.
     *
     * <p>{@code user_id}를 끊기 <b>전에</b> 불러야 한다 — 대상 세션을 그 컬럼으로 찾는다.
     *
     * @param userId 탈퇴 중인 유저
     * @param now    닫을 시각
     * @return 닫힌 구간 수
     */
    @Modifying
    @Query("UPDATE FocusSessionInterval i "
            + "SET i.endedAt = CASE WHEN i.startedAt > :now THEN i.startedAt ELSE :now END "
            + "WHERE i.endedAt IS NULL AND i.sessionId IN "
            + "(SELECT d.sessionId FROM FocusSessionDetail d WHERE d.userId = :userId)")
    int closeOpenIntervalsOfUser(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * 섬 퀘스트 집중 판정(GROMO-1773) — 한 섬에 귀속된 세션의 ACTIVE 구간 중 {@code [start, end)} 창과
     * 겹치는 것. REST 구간은 처음부터 빠진다. 창 경계 자르기·합산은 호출측이 한다.
     *
     * @param islandId   세션이 시작 시 고정한 섬(다른 섬 집중은 세지 않는다)
     * @param userIds    판정 대상 주민
     * @param lifecycles 세는 세션 상태 — 정산 없이 끝난 세션(ABANDONED 등)은 호출측이 뺀다
     * @param start      창 시작(포함)
     * @param end        창 끝(제외)
     * @return 주민별 구간. 열린 구간은 {@code endedAt == null}
     */
    @Query("SELECT d.userId AS userId, i.startedAt AS startedAt, i.endedAt AS endedAt "
            + "FROM FocusSessionInterval i, FocusSessionDetail d "
            + "WHERE d.sessionId = i.sessionId AND d.islandId = :islandId AND d.userId IN :userIds "
            + "AND d.lifecycle IN :lifecycles "
            + "AND i.kind = com.oneorthree.phone.focus.repository.domain.FocusIntervalKind.ACTIVE "
            + "AND i.startedAt < :end AND (i.endedAt IS NULL OR i.endedAt > :start)")
    List<ActiveSpan> findActiveSpansOnIsland(@Param("islandId") UUID islandId,
                                             @Param("userIds") Collection<UUID> userIds,
                                             @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
                                             @Param("start") Instant start, @Param("end") Instant end);

    /** {@link #findActiveSpansOnIsland} 의 한 줄 — 누구의 어느 ACTIVE 구간인가. */
    interface ActiveSpan {
        UUID getUserId();

        Instant getStartedAt();

        Instant getEndedAt();
    }
}
