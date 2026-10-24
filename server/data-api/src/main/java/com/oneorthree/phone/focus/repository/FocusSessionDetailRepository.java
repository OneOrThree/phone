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
 * 집중 세션 상세의 저장·조회 지점.
 *
 * <p>휴식·재개·종료는 {@link #findBySessionIdForUpdate}로 행을 잠근 뒤 lifecycle과 version을
 * 검사해 동시에 같은 상태를 전이하지 않도록 한다.
 */
public interface FocusSessionDetailRepository extends JpaRepository<FocusSessionDetail, UUID> {

    /** 클라이언트 타이머가 아닌 서버의 실제 바다 도착 확정만 첫 무인도 정착을 허용한다. */
    @Query("SELECT count(d) > 0 FROM FocusSessionDetail d WHERE d.userId = :userId AND d.islandId = :islandId "
            + "AND d.kind = com.oneorthree.phone.focus.repository.domain.FocusSessionKind.SEA "
            + "AND d.lifecycle = com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.COMPLETED "
            + "AND d.arrived = true")
    boolean hasCompletedSeaArrival(@Param("userId") UUID userId, @Param("islandId") UUID islandId);


    /**
     * {@link #findOverlapping} 의 바깥 시간 경계 — 진행 중이거나, 창 시작 뒤에 끝났다. 별칭 {@code d}·파라미터
     * {@code :from} 을 쓴다.
     */
    String OPEN_OR_ENDED_AFTER_FROM = "AND (d.lifecycle IN ("
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.ACTIVE, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED) "
            + "OR d.lastTransitionAt > :from) ";

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.sessionId = :sessionId")
    Optional<FocusSessionDetail> findBySessionIdForUpdate(@Param("sessionId") UUID sessionId);

    /**
     * 잠금 전 주인·섬 확인 — 엔티티를 올리지 않는 프로젝션이다({@link FocusSessionOwnership} 참조).
     *
     * @param sessionId 전이 대상 세션
     * @return 주인·섬. 세션이 없으면 빈 값
     */
    @Query("SELECT new com.oneorthree.phone.focus.repository.FocusSessionOwnership(d.userId, d.islandId, d.kind) "
            + "FROM FocusSessionDetail d WHERE d.sessionId = :sessionId")
    Optional<FocusSessionOwnership> findOwnershipBySessionId(@Param("sessionId") UUID sessionId);

    /**
     * 프레즌스 재구축용(GROMO-2003) — 이 세션들의 절대 상태와 전이 번호를 한 번에 읽는다.
     *
     * <p>모수가 「진행 중 마커」라 동시 집중 인원 규모다. 상세가 없는 이전 기록은 결과에 빠지고,
     * 부르는 쪽이 그것을 「active·전이 번호 0」으로 본다({@link FocusSessionControlState}).
     *
     * @param sessionIds 진행 중 마커의 id 들
     * @return 상세가 있는 세션만
     */
    @Query("SELECT new com.oneorthree.phone.focus.repository.FocusSessionControlState("
            + "d.sessionId, d.lifecycle, d.version) "
            + "FROM FocusSessionDetail d WHERE d.sessionId IN :sessionIds")
    List<FocusSessionControlState> findControlStatesBySessionIdIn(
            @Param("sessionIds") Collection<UUID> sessionIds);

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
            + "AND d.lifecycle IN :lifecycles "
            // 바다 세션의 island_id 는 «목적지» 라 소속과 무관하다(GROMO-2299) — 목적지 섬에서 강퇴돼도 항해는 계속된다.
            + "AND d.kind = com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND")
    Optional<FocusSessionDetail> findProgressingByUserIdAndIslandIdForUpdate(
            @Param("userId") UUID userId, @Param("islandId") UUID islandId,
            @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 자진 탈퇴 가드용 — 그 섬에 걸린 진행 세션이 있는가.
     *
     * @return 있으면 true
     */
    @Query("SELECT COUNT(d) > 0 FROM FocusSessionDetail d WHERE d.userId = :userId AND d.islandId = :islandId "
            + "AND d.lifecycle IN :lifecycles AND d.kind = "
            // 바다 세션의 island_id 는 «목적지» 라 소속 탈퇴를 막을 이유가 아니다(강퇴 경로와 같은 기준, GROMO-2299).
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND")
    boolean existsByUserIdAndIslandIdAndLifecycleIn(@Param("userId") UUID userId, @Param("islandId") UUID islandId,
                                                    @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 섬 주민 스냅샷용(GROMO-1765) — 그 섬에 귀속된 진행 세션 중 지정한 사용자들의 것.
     *
     * @param islandId   세션이 귀속된 섬(시작 시 고정)
     * @param lifecycles focus 목록은 ACTIVE·PAUSED, rest 목록은 PAUSED
     * @param userIds    현재 활성 주민 — 섬을 떠난 사용자의 진행 세션은 여기서 걸러진다
     * @return 해당 상세(사용자당 최대 1건 — V58 부분 UNIQUE)
     */
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.lifecycle IN :lifecycles "
            + "AND d.userId IN :userIds "
            // 목적지가 이 섬인 바다 세션은 섬 주민에게 보이면 안 된다(10/16 관전자 규칙, GROMO-2299).
            + "AND d.kind = com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND")
    List<FocusSessionDetail> findByIslandIdAndLifecycleInAndUserIdIn(
            @Param("islandId") UUID islandId, @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
            @Param("userIds") Collection<UUID> userIds);

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
     * 휴식 자동 종료 후보 (GROMO-1998) — {@code PAUSED} 로 들어간 지 {@code before} 보다 오래된 세션 id.
     *
     * <p>{@code lastTransitionAt} 이 곧 {@code restStartedAt} 이다: PAUSED 행에 그 값을 쓰는 전이는
     * {@code applyPause} 하나뿐이고, 다른 전이는 전부 PAUSED 를 벗어난다. REST 구간을 조인해 읽을 이유가
     * 없다.
     *
     * <p>적립 틱과 같이 <b>엔티티를 올리지 않는다</b> — 종결은 세션마다 자기 트랜잭션에서 잠금 순서를
     * 처음부터 다시 잡으므로 스캔이 낡은 인스턴스를 들고 있으면 안 된다. 여기서 고른 뒤 잠그기까지
     * resume 이 이길 수 있어 <b>잠근 뒤 다시 판정</b>한다.
     *
     * @param before 이 시각 이전에 휴식을 시작한 세션만(= now − 자동 종료 유예)
     * @return 세션 id(순서 무관)
     */
    @Query("SELECT d.sessionId FROM FocusSessionDetail d WHERE d.lifecycle = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED "
            + "AND d.lastTransitionAt <= :before")
    List<UUID> findSessionIdsRestingSince(@Param("before") Instant before);

    /**
     * 황금 물고기 추첨 틱용(GROMO-1956) — 지금 ACTIVE 세션이 {@code minimum} 명 이상인 섬.
     *
     * <p>「같은 섬에서 ACTIVE(집중 중, 휴식 제외)인 주민이 2명 이상일 때만 추첨한다」(기획 정본)의 그
     * 선별이다. 섬 전수를 훑지 않으려고 세션 쪽에서 집계한다 — 진행 세션은 사용자당 최대 1건(V58 부분
     * UNIQUE)이라 세션 수가 곧 주민 수다.
     *
     * @param lifecycle {@link FocusSessionLifecycle#ACTIVE} — 휴식(PAUSED)은 인원에 넣지 않는다
     * @param minimum   추첨 최소 인원(2)
     * @return 섬 id(순서 무관)
     */
    @Query("SELECT d.islandId FROM FocusSessionDetail d WHERE d.lifecycle = :lifecycle "
            + "AND d.islandId IS NOT NULL AND d.userId IS NOT NULL AND d.kind = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND "
            + "GROUP BY d.islandId HAVING COUNT(d) >= :minimum")
    List<UUID> findIslandIdsWithAtLeast(@Param("lifecycle") FocusSessionLifecycle lifecycle,
                                        @Param("minimum") long minimum);

    /**
     * 황금 물고기 추첨 틱용(GROMO-1956) — 그 섬에서 지금 그 lifecycle 인 세션 id.
     *
     * <p>{@link #findSessionIdsByLifecycle} 과 같은 이유로 엔티티를 올리지 않는다: 당첨되면 호출측이
     * 세션마다 행을 다시 배타 잠그고 상태를 재확인하므로, 스캔이 낡은 인스턴스를 들고 있으면 안 된다.
     *
     * @return 세션 id(순서 무관 — 호출측이 잠금 순서를 정한다)
     */
    @Query("SELECT d.sessionId FROM FocusSessionDetail d WHERE d.islandId = :islandId "
            + "AND d.lifecycle = :lifecycle AND d.userId IS NOT NULL AND d.kind = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND")
    List<UUID> findSessionIdsByIslandIdAndLifecycle(@Param("islandId") UUID islandId,
                                                    @Param("lifecycle") FocusSessionLifecycle lifecycle);

    /**
     * 휴식 자리 배정용 — 같은 섬에서 현재 paused인 사용자들이 쥔 자리 번호.
     * 호출측이 섬 행을 배타로 먼저 잠근 뒤 불러야
     * 동시 pause 두 건이 같은 최소 빈 번호를 고르지 않는다.
     *
     * @param islandId 자리를 배정할 섬
     * @return 사용 중인 자리 번호(중복 없음이 자연히 보장 — UNIQUE 인덱스)
     */
    @Query("SELECT d.restSeat FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.lifecycle = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED AND d.kind = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND")
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
     * 탈퇴 정리 2/2 — 기본 {@code focus_sessions}와 <b>같은 방식</b>으로 행은 남기고 개인정보만
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
     * <p><b>시간 경계가 바깥 스캔을 자른다</b>(GROMO-2344) — 상세에는 구간 시각이 없어, 종전에는 주민의 «전생애»
     * 세션마다 구간을 탐침했다. 진행 중이 아닌 세션의 {@code lastTransitionAt} 은 종결 시각이고 그 세션의 어떤 구간
     * {@code endedAt} 보다도 작지 않다(완료가 같은 anchor 로 열린 구간을 닫고, anchor 는 직전 전이보다 앞서지 않는다). 그래서 «구간이 창과
     * 겹친다»면 «{@code lastTransitionAt > from}» 이고, 이 술어가 V130 {@code (user_id, island_id, last_transition_at)} 인덱스로
     * 범위를 좁힌다. 진행 중 세션(사용자당 1건)은 마지막 전이가 창보다 오래됐어도 열린 구간이 겹칠 수 있어 따로 둔다.
     * 정확한 겹침 판정은 여전히 {@code EXISTS} 다.
     *
     * @param lifecycles 집계에 넣는 lifecycle(ACTIVE·PAUSED·COMPLETED). 정산 없이 끝난 세션은 빠진다
     */
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.userId IN :userIds AND d.lifecycle IN :lifecycles "
            + OPEN_OR_ENDED_AFTER_FROM
            + "AND EXISTS (SELECT 1 FROM FocusSessionInterval i WHERE i.sessionId = d.sessionId "
            + "AND i.kind = com.oneorthree.phone.focus.repository.domain.FocusIntervalKind.ACTIVE "
            + "AND i.startedAt < :to AND (i.endedAt IS NULL OR i.endedAt > :from))")
    List<FocusSessionDetail> findOverlapping(@Param("userIds") Collection<UUID> userIds,
                                             @Param("lifecycles") Collection<FocusSessionLifecycle> lifecycles,
                                             @Param("from") Instant from, @Param("to") Instant to);

    /**
     * 회관 기록 scope=island — {@link #findOverlapping} 에 시작 때 고정한 섬({@code islandId}) 조건을 더한다.
     * 다른 섬에서 한 집중은 이 섬 기여가 아니다(2026-09-19 결정 RC-D01). 시간 경계도 같다.
     */
    @Query("SELECT d FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.userId IN :userIds "
            + "AND d.lifecycle IN :lifecycles AND d.kind = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionKind.ISLAND "
            + OPEN_OR_ENDED_AFTER_FROM
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
            + "WHERE d.lifecycle = 'COMPLETED' AND d.kind = 'ISLAND' AND i.kind = 'ACTIVE' AND i.ended_at IS NOT NULL "
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
