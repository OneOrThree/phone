package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 사용자가 고른 <b>메인 섬</b> 한 건 (GROMO-1971, V81) — users 1:1.
 *
 * <p><b>«지금 접속한 섬»과 다른 축이다.</b> {@code user_island_contexts.current_island_id} 는 이동할 때마다
 * 바뀌는 위치이고, 메인 섬은 친구 목록에까지 나가는 「내 대표 섬」이다. 둘을 한 컬럼으로 합치면 구경하러
 * 잠깐 옮긴 것만으로 대표 섬이 바뀐다.
 *
 * <p><b>행이 없는 것이 정상 상태다.</b> 없으면 «가장 먼저 가입한 활성 섬»으로 도출한다
 * ({@code MainIslandService}) — 그래서 신규·기존 주민 모두 첫 가입 섬이 자동으로 메인 섬이고, 가입 경로마다
 * 훅을 달 필요도 마이그레이션 백필도 없다. 행은 <b>사용자가 직접 고르거나</b>({@code PATCH /me})
 * <b>메인 섬을 잃어 옮겨질 때</b>만 생긴다.
 *
 * <p><b>왜 {@code users} 컬럼이 아닌가.</b> {@code User} 에는 {@code @Version} 도 {@code @DynamicUpdate} 도
 * 없어 필드 하나만 고쳐도 전 컬럼 UPDATE 가 나간다. 이탈·강퇴·계정탈퇴가 같은 트랜잭션에서 메인 섬을
 * 옮기는데, 그 갱신이 users 행의 더티 체킹에 실리면 같은 TX 의 PII 파기와 순서를 다툰다. 자기 행을 주면
 * 그 다툼 자체가 없다.
 */
@Entity
@Table(name = "user_main_islands")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserMainIsland {

    /** 주인 — {@code users.id} 를 그대로 PK 로 쓴다(1:1). */
    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    /** 대표 섬. 이 행이 있는 동안 주인은 그 섬의 <b>활성 주민</b>이다 — 이탈·강퇴·탈퇴가 같은 TX 에서 옮기거나 지운다. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "island_id", nullable = false)
    private Group island;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    public UserMainIsland(UUID userId, Group island) {
        this.userId = userId;
        this.island = island;
    }

    /**
     * 대표 섬을 바꾼다 — 행 하나에 컬럼 하나뿐이라 더티 갱신이 덮어쓸 다른 축이 없다.
     *
     * @param newIsland 새 대표 섬. 호출부가 활성 주민임을 확인한 섬이어야 한다
     */
    public void moveTo(Group newIsland) {
        this.island = newIsland;
    }
}
