package com.oneorthree.phone.outbox.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 순서용 {@code version} 발급구 — 한 aggregate 의 마지막 발급값 한 행 (㊸, V51).
 *
 * <p><b>시퀀스를 쓰지 않는다.</b> 시퀀스는 번호 할당 순서만 보장하고 커밋 순서를 보장하지 않아,
 * 같은 유저의 T1 이 10 을 받고 멈춘 사이 T2 가 11 을 커밋·발행한 뒤 T1 이 마지막에 커밋하면 DB 의
 * 최종 상태는 T1 인데 소비자는 최대값 11 때문에 이벤트 10 을 폐기한다. 이 행을 <b>잠근 채</b>
 * 번호를 올리면 같은 aggregate 의 두 트랜잭션이 겹치지 않아 번호 순서가 곧 커밋 순서가 된다.
 *
 * <p>{@code users} 에는 {@code @Version} 도 없어 기존 낙관락이 이 경합을 막지 못한다 — 그래서 이
 * 테이블이 별도로 필요하다.
 */
@Entity
@Table(name = "aggregate_versions")
@IdClass(AggregateVersionId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class AggregateVersion {

    @Id
    @Column(name = "aggregate_type", nullable = false, length = 60)
    private String aggregateType;

    @Id
    @Column(name = "aggregate_id", nullable = false, length = 200)
    private String aggregateId;

    /** 마지막으로 <b>발급한</b> 값. 다음 발급은 이 값 + 1 이다. */
    @Column(name = "last_version", nullable = false)
    private long lastVersion;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 다음 번호를 발급한다 — <b>이 행을 배타 잠금으로 읽은 트랜잭션 안에서만</b> 부를 것.
     *
     * <p>잠금 없이 부르면 두 트랜잭션이 같은 {@code lastVersion} 을 읽어 같은 번호를 발급하고,
     * {@code uq_event_outbox_aggregate_version} 이 둘 중 하나를 죽인다 — 순서 계약이 깨지는 대신
     * 명령이 실패하는 쪽이라 조용한 회귀는 아니지만, 애초에 잠금이 계약이다.
     *
     * @param now 발급 시각
     * @return 새로 발급된 번호
     */
    public long allocateNext(Instant now) {
        lastVersion += 1;
        updatedAt = now;
        return lastVersion;
    }
}
