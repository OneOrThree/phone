package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

/**
 * 섬 공용 음악(방송기) 재생 상태 — 섬당 한 행의 전체 상태 (GROMO-1779, island-playback LLD §3·§4).
 *
 * <p>{@code positionSeconds} 는 {@code effectiveAt} 시점의 위치다. 재생 중이면 서버 경과를 더하고 곡
 * 길이로 반복한다 — 곡 끝마다 행을 갱신하지 않는다(정책 M05). 행은 최초 PATCH 가 만들며 그 전의
 * 초기 상태는 서비스가 행 없이 표현한다(정책 M08).
 */
@Entity
@Table(name = "island_playbacks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandPlayback {

    @Id
    @Column(name = "island_id")
    private UUID islandId;

    /** 선택 곡 — 초기 미선택이면 null. */
    @Column(name = "track_id", length = 80)
    private String trackId;

    @Column(nullable = false)
    private boolean playing;

    /** effectiveAt 시점의 위치(초, 정수 내림). 곡이 있으면 곡 길이 미만이다. */
    @Column(name = "position_seconds", nullable = false)
    private long positionSeconds;

    @Column(name = "effective_at", nullable = false)
    private Instant effectiveAt;

    /** 마지막 실제 변경을 한 검증 사용자 — 초기 행은 null(정책 M09). */
    @Column(name = "changed_by")
    private UUID changedBy;

    @Column(nullable = false)
    private long version;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 서버 시각 {@code t} 의 위치(초, 정수 내림) — LLD §3 의 {@code (p + max(0, t-a)) mod d}.
     * 밀리초로 계산해 소수초 곡 길이를 잃지 않는다. 정지 중이면 시간이 지나도 p 그대로다.
     *
     * @param durationMillis 선택 곡의 불변 길이 — 곡이 없으면 쓰이지 않는다
     */
    public long positionAt(Instant t, int durationMillis) {
        if (trackId == null || !playing) {
            return positionSeconds;
        }
        long elapsed = Math.max(0L, Duration.between(effectiveAt, t).toMillis());
        return Math.floorMod(positionSeconds * 1000L + elapsed, (long) durationMillis) / 1000L;
    }

    /** 실제 변경 한 번 — 전체 상태를 바꾸고 version 을 정확히 1 올린다. 무변경 판정은 호출측이 한다. */
    public void change(String trackId, boolean playing, long positionSeconds, Instant anchor, UUID actor) {
        this.trackId = trackId;
        this.playing = playing;
        this.positionSeconds = positionSeconds;
        this.effectiveAt = anchor;
        this.changedBy = actor;
        this.version += 1;
        this.updatedAt = anchor;
    }
}
