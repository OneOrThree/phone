package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
     * 본인의 진행(active/paused) 세션 — user당 최대 1건(V58 부분 UNIQUE)이라 단건으로 받는다.
     *
     * @param userId      조회 주체
     * @param lifecycles  진행 중으로 볼 lifecycle 집합(보통 ACTIVE, PAUSED)
     * @return 진행 세션. 없으면 빈 값 — GET current의 data=null이 된다
     */
    Optional<FocusSessionDetail> findFirstByUserIdAndLifecycleIn(
            UUID userId, Collection<FocusSessionLifecycle> lifecycles);

    /**
     * 휴식 자리 배정용 — 같은 섬에서 현재 paused인 사용자들이 쥔 자리 번호.
     * 호출측이 {@code GroupQueryService.getGroupForUpdate}로 섬 행을 먼저 잠근 뒤 불러야
     * 동시 pause 두 건이 같은 최소 빈 번호를 고르지 않는다.
     *
     * @param islandId 자리를 배정할 섬
     * @return 사용 중인 자리 번호(중복 없음이 자연히 보장 — UNIQUE 인덱스)
     */
    @Query("SELECT d.restSeat FROM FocusSessionDetail d WHERE d.islandId = :islandId AND d.lifecycle = "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle.PAUSED")
    List<Integer> findUsedRestSeatsByIslandId(@Param("islandId") UUID islandId);
}
