package com.oneorthree.phone.outbox.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 봉투 하나의 <b>한 대상</b>에 대한 전달 상태 (A21, V51).
 *
 * <p>relay 는 「전달 표시가 비어 있는 대상만」 재시도한다. 그래서 Kafka 는 갔는데 링크 HTTP 가
 * 실패한 사건이 Kafka 로 다시 가지 않는다.
 *
 * <p><b>순서 축 세 컬럼({@code aggregateType}·{@code aggregateId}·{@code aggregateVersion})은
 * 봉투에서 복제한 값이다.</b> 정규화를 깨는 대신 「같은 축의 선행 미전달이 있는가」 검사가 이 테이블
 * 안의 부분 인덱스 하나로 끝난다. 봉투가 불변이라 복제본이 낡을 수 없다.
 *
 * <p><b>{@code leaseToken} 이 펜싱 토큰이다.</b> 리스가 만료돼 다른 워커가 재클레임하면 토큰이
 * 바뀌고, 옛 워커가 뒤늦게 완료를 보고해도 조건이 안 맞아 0행이 갱신된다 — 낡은 완료 표시가
 * 「아직 안 간 전달」을 삼키지 못한다.
 */
@Entity
@Table(name = "event_outbox_deliveries")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class EventOutboxDelivery {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "outbox_id", nullable = false)
    private UUID outboxId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private OutboxTarget target;

    @Column(name = "aggregate_type", nullable = false, length = 60)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, length = 200)
    private String aggregateId;

    @Column(name = "aggregate_version", nullable = false)
    private long aggregateVersion;

    /**
     * 이 대상에 실제로 보낼 본문. Kafka 는 정본 봉투 그대로, HTTP 대상은 그 명령의 본문이다 —
     * 링크 폐기의 {@code linkVersion}·{@code membershipEpoch} 처럼 대상에만 필요한 값이 여기 든다(ⓑ″).
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private Map<String, Object> payload;

    /**
     * HTTP 대상의 <b>논리 엔드포인트 키</b> — 설정된 허용목록에서 URL·method·caller 토큰을 찾는 열쇠다.
     *
     * <p><b>여기에 URL 을 담지 않는다.</b> payload 나 이 값이 목적지를 직접 지정할 수 있으면 그 자체가
     * SSRF 구조가 된다. Kafka 대상은 {@code null}.
     */
    @Column(name = "endpoint_key", length = 80)
    private String endpointKey;

    /** 전달 완료 표시. {@code null} = 아직 안 갔다. */
    @Column(name = "delivered_at")
    private Instant deliveredAt;

    /** 선점 시점에 증가한다 — 죽은 워커의 시도도 세어야 「몇 번째부터 이상한가」가 보인다. */
    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "last_attempt_at")
    private Instant lastAttemptAt;

    @Column(name = "last_error", columnDefinition = "text")
    private String lastError;

    /** 다음 시도 시각. 백오프는 이 값을 밀어 둔다. */
    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "lease_owner", length = 80)
    private String leaseOwner;

    /** 펜싱 토큰 — 완료·실패 표시가 이 값과 일치할 때만 반영된다. */
    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /**
     * {@code payload} 의 방어 복사본.
     *
     * @return 순서를 보존한 복사본
     */
    public Map<String, Object> getPayload() {
        return payload == null ? Map.of() : new LinkedHashMap<>(payload);
    }
}
