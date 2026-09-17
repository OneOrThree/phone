package com.oneorthree.phone.focus.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * v0.3 세션의 ACTIVE/REST 실제 서버 시간 구간 하나 (GROMO-1764, LLD §3·§4).
 *
 * <p>구간은 {@code [startedAt, endedAt)} 반열림이고 paused는 REST 구간이다. {@code ordinal}은
 * 세션 안에서 유일하고, 열린 구간({@code endedAt == null})은 세션당 최대 1개다(V58 부분 UNIQUE) —
 * pause/resume가 원자적으로 "하나를 닫고 다음을 연다".
 *
 * <p>이 엔티티는 순수 저장 행이다 — 여는/닫는 판단과 잠금은
 * {@link com.oneorthree.phone.focus.service.FocusSessionLifecycleService}가 진다.
 */
@Entity
@Table(name = "focus_session_intervals")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSessionInterval {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    /** 세션 안에서 1부터 증가하는 순번 — (session_id, ordinal) UNIQUE. */
    @Column(nullable = false)
    private int ordinal;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    private FocusIntervalKind kind;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    /** 진행 중(열린 구간)이면 {@code null}. */
    @Column(name = "ended_at")
    private Instant endedAt;

    /** 이 구간을 t에서 닫는다 — 호출측이 "열린 구간이 이거였다"를 이미 확인한 뒤에만 부른다. */
    public void close(Instant t) {
        this.endedAt = t;
    }

    /** @return 이 구간이 아직 열려 있는지(진행 중). */
    public boolean isOpen() {
        return endedAt == null;
    }
}
