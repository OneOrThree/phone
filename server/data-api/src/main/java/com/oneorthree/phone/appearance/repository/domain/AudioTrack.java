package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 음원의 불변 미디어 메타데이터 (GROMO-1779, island-playback 정책 M07) — {@code kind=audio} 카탈로그
 * 자산마다 곡 길이 한 행. 같은 trackId 의 오디오·길이를 바꾸지 않으므로 갱신 경로가 없다.
 * 길이는 밀리초 정수라 NaN·무한이 들어올 자리가 없다.
 */
@Entity
@Table(name = "audio_tracks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AudioTrack {

    @Id
    @Column(name = "product_id", length = 80)
    private String productId;

    @Column(name = "duration_millis", nullable = false)
    private int durationMillis;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
