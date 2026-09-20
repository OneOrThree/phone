package com.oneorthree.phone.focus.repository;

import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

/** 집중 보상 적립 원장 (V82, GROMO-1990) — 매분 틱이 쓰고, 하루 상한·세션 합계·누적 획득이 읽는다. */
public interface FocusRewardAccrualRepository extends JpaRepository<FocusRewardAccrual, UUID> {

    /**
     * 이 세션의 그날 행 — 없으면 틱이 새로 만든다.
     *
     * <p>잠금을 걸지 않는 이유: 호출측(적립 틱)이 세션 상세를 배타 잠근 뒤에만 부르고, 이 행을 쓰는
     * 것은 그 세션의 틱뿐이다. 같은 키의 동시 기입은 유니크 제약이 최후 방어선으로 막는다.
     */
    Optional<FocusRewardAccrual> findBySessionIdAndAccruedOn(UUID sessionId, LocalDate accruedOn);

    /**
     * 하루 상한 판정 — 이 사용자가 이 섬에서 {@code accruedOn}(UTC 날짜)에 이미 적립한 물고기 합.
     *
     * @return 합(없으면 0)
     */
    @Query("SELECT COALESCE(SUM(a.earnedFish), 0) FROM FocusRewardAccrual a, "
            + "com.oneorthree.phone.focus.repository.domain.FocusSessionDetail d "
            + "WHERE d.sessionId = a.sessionId AND d.userId = :userId AND d.islandId = :islandId "
            + "AND a.accruedOn = :accruedOn")
    long sumEarnedFishOnDay(@Param("userId") UUID userId, @Param("islandId") UUID islandId,
                            @Param("accruedOn") LocalDate accruedOn);

    /**
     * 이 세션이 지금까지 적립한 총 마리 수 — finish 가 정산 행에 옮겨 적는 값이다(추가 지급은 없다).
     *
     * @return 합(한 번도 적립하지 못했으면 0)
     */
    @Query("SELECT COALESCE(SUM(a.earnedFish), 0) FROM FocusRewardAccrual a WHERE a.sessionId = :sessionId")
    long sumEarnedFishOfSession(@Param("sessionId") UUID sessionId);
}
