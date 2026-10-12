package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 섬 소식 한 건 (GROMO-2267, V111) — 주민 전원이 같은 글을 읽는 섬 공동 피드의 한 줄이다. 수신자별 행도 읽음
 * 표시도 없다. 연관관계 대신 id 만 든다.
 *
 * <p>{@code kind} 는 enum 이 아니라 문자열이다 — DB 에 CHECK 가 없어 다음 종류가 마이그레이션 없이 들어오는데,
 * enum 이면 먼저 배포된 노드가 모르는 종류의 행을 읽다 깨진다. 읽는 쪽은 모르는 종류를 그대로 내려보낸다.
 * {@code createdAt} 은 호출자가 넘긴다 — 주입 {@code Clock} 의 시각이라 고정 시계 테스트가 값을 단정할 수 있다.
 */
@Entity
@Table(name = "island_news")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandNews {

    /** 섬장이 잡지 홍보를 신청했다. */
    public static final String KIND_PROMOTION = "PROMOTION";

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(nullable = false, length = 20)
    private String kind;

    /** 이미 완성된 한 줄 문구. */
    @Column(nullable = false, length = 200)
    private String body;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    public IslandNews(UUID islandId, String kind, String body, Instant createdAt) {
        this.islandId = islandId;
        this.kind = kind;
        this.body = body;
        this.createdAt = createdAt;
    }
}
