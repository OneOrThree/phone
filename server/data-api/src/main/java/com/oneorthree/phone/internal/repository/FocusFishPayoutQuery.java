package com.oneorthree.phone.internal.repository;

import com.oneorthree.phone.focus.repository.domain.FocusRewardAccrual;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 도서관 개인 획득량의 조합 조회. 집중·공동 원장·확정 지급 사건은 internal에서만 함께 읽는다. */
public interface FocusFishPayoutQuery extends Repository<FocusRewardAccrual, UUID> {

    /**
     * 실제 지급된 일반 보상만 읽는다. 빠진 분(하루 상한)은 원장에 없으므로 시간을 보상으로 환산하지 않는다.
     * 분 단위 키의 지급 시각은 고정 정책과 ACTIVE 구간으로 복원하며, 종전 일괄 지급은 원장 시각을 쓴다.
     */
    @Query(value = """
            SELECT d.session_id AS "sessionId", p.seconds_per_fish AS "secondsPerFish",
                   CASE WHEN split_part(t.idempotency_key, ':', 3) ~ '^[0-9]+$'
                        THEN CAST(split_part(t.idempotency_key, ':', 3) AS bigint) END AS "rewardNumber",
                   t.amount AS "amount", t.created_at AS "creditedAt"
            FROM focus_session_details d
            JOIN island_wallet_transactions t
              ON split_part(t.idempotency_key, ':', 2) = CAST(d.session_id AS text)
             AND t.island_id = d.island_id
             AND t.idempotency_key LIKE 'focus:%' AND t.type = 'CONTRIBUTION'
            LEFT JOIN focus_reward_policies p ON p.revision = d.policy_revision
            WHERE d.user_id = :userId AND (
                (t.created_at >= :from AND t.created_at < :to) OR EXISTS (
                    SELECT 1 FROM focus_session_intervals i WHERE i.session_id = d.session_id
                    AND i.kind = 'ACTIVE' AND i.started_at < :to
                    AND (i.ended_at IS NULL OR i.ended_at >= :from)))
            """, nativeQuery = true)
    List<GrantedReward> findGrantedRewards(@Param("userId") UUID userId,
            @Param("from") Instant from, @Param("to") Instant to);

    /**
     * 황금 물고기 지급과 같은 트랜잭션에 보존한 불변 사건의 확정 참여자·자기 몫을 읽는다.
     * 전송 성공 여부와 무관하며 섬 전체 50마리나 현재 참여 인원으로 다시 나누지 않는다.
     * 이 조회를 사용하는 동안 focus.golden 사건은 통계 원장으로 보존해야 한다.
     * outbox 삭제·만료 정책을 도입하기 전에는 확정 지급 시각·참여자·자기 몫을 별도 원장으로 이관해야 한다.
     */
    @Query(value = """
            SELECT COALESCE(SUM(CAST(e.params ->> 'sharePerMember' AS bigint)), 0)
            FROM event_outbox e
            WHERE e.type = 'focus.golden'
              AND e.params -> 'members' @> jsonb_build_array(jsonb_build_object('userId', CAST(:userId AS text)))
              AND CAST(e.params ->> 'drawnAt' AS timestamptz) >= :from
              AND CAST(e.params ->> 'drawnAt' AS timestamptz) < :to
            """, nativeQuery = true)
    long sumGoldenFishBetween(@Param("userId") UUID userId,
            @Param("from") Instant from, @Param("to") Instant to);

    /** 지급 원장 한 건. */
    interface GrantedReward {
        UUID getSessionId();

        Integer getSecondsPerFish();

        Long getRewardNumber();

        Integer getAmount();

        Instant getCreditedAt();
    }

}
