package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.user.domain.User;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "focus_sessions")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusSession {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "focus_tag_id")
    private FocusTag focusTag;

    private String subject;

    @Column(nullable = false)
    private Instant startedAt;

    // 라이브 세션(GROMO-610): 진행 중이면 null, 종료 시 채워짐.
    // 과거 nullable=false 였으나 '시작만 저장' 경로를 위해 NOT NULL 제거 — friend isFocusing 판정(endedAt IS NULL) 전제.
    private Instant endedAt;

    @Builder.Default
    private int distractionCount = 0;

    @Builder.Default
    private int totalDistractionSeconds = 0;

    // 소프트 딜리트 컬럼(삭제 시각) — 스키마 정합용(GROMO-561). 세팅/필터 배선은 후속 티켓.
    private Instant deletedAt;

    /** 진행 중 세션에 종료 시각·방해 지표를 채워 완료 처리(더티 체킹). */
    public void end(Instant endedAt, int distractionCount, int totalDistractionSeconds) {
        this.endedAt = endedAt;
        this.distractionCount = distractionCount;
        this.totalDistractionSeconds = totalDistractionSeconds;
    }

    /** 시작 시 미지정한 태그를 종료 시점에 보정. */
    public void applyTag(FocusTag focusTag) {
        this.focusTag = focusTag;
    }

    /** 종료 여부(endedAt 존재). */
    public boolean isEnded() {
        return endedAt != null;
    }
}
