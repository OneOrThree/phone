package com.oneorthree.phone.outbox.repository;

import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

/**
 * 봉투 저장·조회. 봉투는 불변이라 갱신 메서드를 두지 않는다 — 유일한 예외는 탈퇴 파기의
 * {@link #eraseParamOfResendSafe} 다(GROMO-1946).
 */
public interface EventOutboxRepository extends JpaRepository<EventOutbox, UUID> {

    /**
     * 결정적 사건 키로 찾는다 — 재기록 판단·리컨실·수동 재전송 입구가 쓴다.
     *
     * @param eventId 결정적 사건 키
     * @return 있으면 봉투
     */
    Optional<EventOutbox> findByEventId(String eventId);

    /**
     * 탈퇴자 봉투의 {@code params} 에서 개인정보 한 필드를 JSON null 로 대체한다 (GROMO-1946 · 계정 LLD §4).
     *
     * <p>{@link EventOutboxDeliveryRepository#eraseParamOfResendSafe} <b>뒤에</b> 같은 트랜잭션에서 부른다.
     * 전달 행 중 하나라도 「시도했지만 미완료」(그대로 다시 나가야 하는 행)면 봉투도 그대로 둔다 — 봉투와 실제
     * 나간 본문이 어긋나면 리컨실·수동 재전송이 다른 것을 보게 된다. 판정은 전달 행 쪽 조건의 정확한 여집합이다.
     *
     * @param userId   봉투 주체(탈퇴자)
     * @param type     사건 종류
     * @param paramKey 대체할 {@code params} 키
     * @return 고친 봉투 수
     */
    @Modifying(flushAutomatically = true)
    @Query(value = "UPDATE event_outbox o "
            + "SET params = jsonb_set(o.params, ARRAY[CAST(:paramKey AS text)], CAST('null' AS jsonb)) "
            + "WHERE o.user_id = :userId AND o.type = :type AND jsonb_exists(o.params, :paramKey) "
            + "  AND NOT EXISTS (SELECT 1 FROM event_outbox_deliveries d "
            + "    WHERE d.outbox_id = o.id AND d.delivered_at IS NULL "
            + "      AND (d.attempt_count > 0 OR d.lease_token IS NOT NULL OR d.target = 'NOTI'))",
            nativeQuery = true)
    int eraseParamOfResendSafe(
            @Param("userId") UUID userId,
            @Param("type") String type,
            @Param("paramKey") String paramKey);
}
