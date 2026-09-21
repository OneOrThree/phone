package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * v0.3 집중 세션 상세 창구 (GROMO-1764). pause/resume/finish는 전부
 * {@link #findBySessionIdForUpdate}로 행을 배타 잠근 뒤 lifecycle·version을 검사한다 —
 * "조회-판정-수정" 창을 없애 동시 요청의 이중 전이를 막는다(레거시
 * {@code FocusSessionRepository}의 조건부 UPDATE 관례와 같은 목적, 여기서는 상세 컬럼이
 * 여럿이라 벌크 UPDATE 대신 행 잠금 + 엔티티 전이 메서드를 쓴다).
 */
public interface FocusSessionDetailRepository extends JpaRepository<FocusSessionDetail, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.sessionId = :sessionId")
    Optional<FocusSessionDetail> findBySessionIdForUpdate(@Param("sessionId") UUID sessionId);

    /**
     * 잠금 전 주인·섬 확인 — 엔티티를 올리지 않는 프로젝션이다({@link FocusSessionOwnership} 참조).
     *
     * @param sessionId 전이 대상 세션
     * @return 주인·섬. 세션이 없으면 빈 값
     */
    @Query("SELECT new com.oneorthree.phone.focus.repository.FocusSessionOwnership(d.userId, d.islandId) "
            + "FROM FocusSessionDetail d WHERE d.sessionId = :sessionId")
    Optional<FocusSessionOwnership> findOwnershipBySessionId(@Param("sessionId") UUID sessionId);

    /**
     * 본인의 진행(active/paused) 세션 — user당 최대 1건(V58 부분 UNIQUE)이라 단건으로 받는다.
     *
     * @param userId      조회 주체
     * @param lifecycles  진행 중으로 볼 lifecycle 집합(보통 ACTIVE, PAUSED)
     * @return 진행 세션. 없으면 빈 값 — GET current의 data=null이 된다
     */
    Optional<FocusSessionDetail> findFirstByUserIdAndLifecycleIn(
            UUID userId, Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 소속 상실 종결용(FR-D03) — 그 섬에 걸린 진행 세션을 배타로 잠근다. 사용자당 진행은 최대 1건이다.
     *
     * @param userId     소속을 잃는 사용자
     * @param islandId   잃는 섬
     * @param lifecycles 진행 중으로 볼 lifecycle(ACTIVE, PAUSED)
     * @return 잠긴 진행 세션. 그 섬의 진행 세션이 없으면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.userId = :userId AND d.islandId = :islandId "
            + "AND d.lifecycle IN :lifecycles")
    Optional<FocusSessionDetail> findProgressingByUserIdAndIslandIdForUpdate(
            @Param("userId") UUID userId, @Param("islandId") UUID islandId,
            @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 자진 탈퇴 가드용 — 그 섬에 걸린 진행 세션이 있는가.
     *
     * @return 있으면 true
     */
    boolean existsByUserIdAndIslandIdAndLifecycleIn(
            UUID userId, UUID islandId, Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 섬 주민 스냅샷용(GROMO-1765) — 그 섬에 귀속된 진행 세션 중 지정한 사용자들의 것.
     *
     * @param islandId   세션이 귀속된 섬(시작 시 고정)
     * @param lifecycles focus 목록은 ACTIVE·PAUSED, rest 목록은 PAUSED
     * @param userIds    현재 활성 주민 — 섬을 떠난 사용자의 진행 세션은 여기서 걸러진다
     * @return 해당 상세(사용자당 최대 1건 — V58 부분 UNIQUE)
     */
    List<FocusSessionDetail> findByIslandIdAndLifecycleInAndUserIdIn(
            UUID islandId, Collection<FocusSessionLifecycle> lifecycles, Collection<UUID> userIds);

    /**
     * 보상 적립 틱용(GROMO-1990) — 지금 그 lifecycle 인 세션 id 목록. 엔티티를 올리지 않는다: 틱은
     * 세션마다 자기 트랜잭션에서 행을 다시 배타 잠그므로, 스캔이 들고 있는 낡은 인스턴스가 있으면 안 된다.
     *
     * @param lifecycle 보통 {@link FocusSessionLifecycle#ACTIVE} — 휴식(PAUSED)은 적립하지 않는다
     * @return 세션 id(시작 순서 무관)
     */
    @Query("SELECT d.sessionId FROM FocusSessionDetail d WHERE d.lifecycle = :lifecycle")
    List<UUID> findSessionIdsByLifecycle(@Param("lifecycle") FocusSessionLifecycle lifecycle);

    /**
     * 휴식 자리 배정용 — 같은 섬에서 현재 paused인 사용자들이 쥔 자리 번호.
     * 호출측이 섬 행을 배타로 먼저 잠근 뒤 불러야
     * 동시 pause 두 건이 같은 최소 빈 번호를 고르지 않는다.
     *
     * @param islandId 자리를 배정할 섬
     * @return 사용 중인 자리 번호(중복 없음이 자연히 보장 — UNIQUE 인덱스)
     */
    @Query("SELECT d.restSeat FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.lifecycle = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED")
    List<Integer> findUsedRestSeatsByIslandId(@Param("islandId") UUID islandId);

    /**
     * 탈퇴 정리 1/2 — 탈퇴자의 진행(active/paused) 상세를 {@code ABANDONED}로 종결하고 휴식 자리를
     * 반납한다. 종결하지 않으면 사용자당 진행 1건 부분 UNIQUE를 영영 점유한 유령 행이 남는다.
     *
     * @param userId 탈퇴 중인 유저
     * @param now    종결 시각
     * @return 종결된 행 수(보통 0 — 시작 게이트가 닫혀 있는 동안은 행 자체가 생기지 않는다)
     */
    @Modifying
    @Query("UPDATE FocusSessionDetail d SET "
            + "d.lifecycle = com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.ABANDONED, "
            + "d.restSeat = null, d.version = d.version + 1, d.lastTransitionAt = :now "
            + "WHERE d.userId = :userId AND d.lifecycle IN ("
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.ACTIVE, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED)")
    int abandonProgressingOfUser(@Param("userId") UUID userId, @Param("now") Instant now);

    /**
     * 탈퇴 정리 2/2 — 레거시 {@code focus_sessions}와 <b>같은 방식</b>으로 행은 남기고 개인정보만
     * 끊는다({@code FocusSessionRepository#nullifyUser}). 상세 행은 섬 건설 기여·정산 원장의 근거라
     * 지우면 남은 사람들의 이력이 함께 무너진다.
     *
     * <p>자유 입력 {@code subject}도 파기한다 — {@code UserService.erasePersonalData}가 닉네임 같은
     * 자유 입력을 null로 지우는 것과 같은 결이고, 이 컬럼은 진행 세션의 NOT NULL 불변식이라 같은
     * 「값 없음」을 빈 문자열로 표현한다.
     *
     * <p>반드시 {@link #abandonProgressingOfUser}보다 <b>뒤</b>다 — 여기서 {@code user_id}가 끊기면
     * 그 뒤의 어떤 조건도 이 사용자의 행을 찾지 못한다.
     *
     * @param userId 탈퇴 중인 유저
     * @return 익명화된 행 수
     */
    @Modifying
    @Query("UPDATE FocusSessionDetail d SET d.userId = null, d.subject = '' WHERE d.userId = :userId")
    int anonymizeWithdrawnUser(@Param("userId") UUID userId);

    /**
     * 회관 기록 scope=me (GROMO-1769, LLD §3) — 이 사용자들의 세션 중 ACTIVE 구간이 {@code [from, to)} 와 겹치는 것.
     * 섬을 가리지 않는다(개인 전체 — 2026-09-19 결정 RC-D01).
     *
     * @param lifecycles 집계에 넣는 lifecycle(ACTIVE·PAUSED·COMPLETED). 정산 없이 끝난 세션은 빠진다
     */
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.userId IN :userIds AND d.lifecycle IN :lifecycles "
            + "AND EXISTS (SELECT 1 FROM FocusSessionInterval i WHERE i.sessionId = d.sessionId "
            + "AND i.kind = com.oneorthree.phone.focus.repository.domain.FocusIntervalKind.ACTIVE "
            + "AND i.startedAt < :to AND (i.endedAt IS NULL OR i.endedAt > :from))")
    List<FocusSessionDetail> findOverlapping(@Param("userIds") Collection<UUID> userIds,
                                             @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
                                             @Param("from") Instant from, @Param("to") Instant to);

    /**
     * 회관 기록 scope=island — {@link #findOverlapping} 에 시작 때 고정한 섬({@code islandId}) 조건을 더한다.
     * 다른 섬에서 한 집중은 이 섬 기여가 아니다(2026-09-19 결정 RC-D01).
     */
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.userId IN :userIds "
            + "AND d.lifecycle IN :lifecycles "
            + "AND EXISTS (SELECT 1 FROM FocusSessionInterval i WHERE i.sessionId = d.sessionId "
            + "AND i.kind = com.oneorthree.phone.focus.repository.domain.FocusIntervalKind.ACTIVE "
            + "AND i.startedAt < :to AND (i.endedAt IS NULL OR i.endedAt > :from))")
    List<FocusSessionDetail> findOverlappingOnIsland(@Param("islandId") UUID islandId,
                                                     @Param("userIds") Collection<UUID> userIds,
                                                     @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
                                                     @Param("from") Instant from, @Param("to") Instant to);

    /**
     * 주간 섬 랭킹의 <b>분자</b> (GROMO-1997) — 창 {@code [windowStart, windowEnd)} 안의 순수 집중 초를
     * <b>섬마다</b> 합친다. 회관 기록이 한 섬을 엔티티로 올려 Java 에서 더하는 것과 달리, 여기는 «모든 섬»을
     * 가로지르는 집계라 세션을 메모리로 올리지 않고 DB 가 한 번에 접는다.
     *
     * <p>세 가지가 정책이다:
     * <ul>
     *   <li>{@code lifecycle = 'COMPLETED'} — <b>끝난 집중만</b> 반영한다(2026-09-21 결정). 진행 중 세션은
     *       정렬·표시 어디에도 넣지 않는다.</li>
     *   <li>{@code kind = 'ACTIVE'} — 휴식은 집중 점수에 더하지 않는다(RK-P04). 그래서 {@code now - startedAt}
     *       식을 쓰지 않는다 — 그 식은 휴식을 가산한다.</li>
     *   <li>{@code island_id} 는 <b>세션이 시작할 때 고정한 섬</b>이다(2026-09-19 결정 RC-D01). 다른 섬에서
     *       집중한 시간은 이 섬 분자가 아니다(기획 정본 「다른 섬에서 집중한 시간은 제외한다」).</li>
     * </ul>
     *
     * <p>정밀도는 {@link com.oneorthree.phone.focus.support.FocusIntervalMath} 와 <b>같은 규율</b>이다 — 구간마다
     * 초로 내리지 않고 창과의 교집합을 그대로 합친 뒤 <b>마지막에 한 번만</b> 내린다. 구간마다 잘랐다면
     * 휴식이 잦은 세션에서 초가 조금씩 사라진다.
     *
     * <p><b>내림 뒤 0초인 섬은 행을 내보내지 않는다</b>({@code HAVING}). 구간이 겹치기만 하면 되는 조건이라
     * 1초 미만으로 끝난 세션도 잡히는데, 그 섬을 내보내면 «0초만 집중한 섬»이 평균 0으로 순위에 들어가
     * 최하위를 차지한다 — 정책은 집중이 0인 섬을 참가로 보지 않는다(RK-D09). 모집단을 여기서 한 번만
     * 정해야 {@code items} 와 {@code myRank} 가 갈리지 않는다.
     *
     * @param windowStart 창 하한(포함)
     * @param windowEnd   창 상한(제외)
     * @return 그 창에 <b>1초 이상</b> 집중이 있었던 섬만 1행씩. 나머지는 행이 없으므로 호출측이 0으로 채운다
     */
    @Query(value = "SELECT d.island_id AS \"islandId\", CAST(FLOOR(SUM(EXTRACT(EPOCH FROM ("
            + "LEAST(i.ended_at, CAST(:windowEnd AS timestamptz)) "
            + "- GREATEST(i.started_at, CAST(:windowStart AS timestamptz)))))) AS bigint) AS \"seconds\" "
            + "FROM focus_session_details d JOIN focus_session_intervals i ON i.session_id = d.session_id "
            + "WHERE d.lifecycle = 'COMPLETED' AND i.kind = 'ACTIVE' AND i.ended_at IS NOT NULL "
            + "AND i.started_at < CAST(:windowEnd AS timestamptz) "
            + "AND i.ended_at > CAST(:windowStart AS timestamptz) "
            + "GROUP BY d.island_id "
            + "HAVING FLOOR(SUM(EXTRACT(EPOCH FROM ("
            + "LEAST(i.ended_at, CAST(:windowEnd AS timestamptz)) "
            + "- GREATEST(i.started_at, CAST(:windowStart AS timestamptz)))))) > 0", nativeQuery = true)
    List<IslandFocusSeconds> sumIslandActiveSeconds(@Param("windowStart") Instant windowStart,
                                                    @Param("windowEnd") Instant windowEnd);

    /** {@link #sumIslandActiveSeconds} 결과 한 행 — 섬과 그 섬의 창 안 순수 집중 초. */
    interface IslandFocusSeconds {

        /** @return 세션이 시작할 때 고정했던 섬 id */
        UUID getIslandId();

        /** @return 창과의 교집합 순수 ACTIVE 초 합(floor). 행이 있으면 0 보다 크다 */
        long getSeconds();
    }
}
