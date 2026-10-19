package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * 이 사람이 이 섬에 «가 본 적» 이 있는가 (GROMO-2260, V112).
 *
 * <p>쓰기는 {@code IslandArrivalRepository.recordArrival} 의 네이티브 upsert 하나다 — 이 매핑은 스키마
 * 선언과 읽기용이다(Flyway 없이 엔티티로 스키마를 만드는 CI 프로필에도 테이블이 있어야 한다).
 * {@code lastArrivedAt} 은 «최근 머문» 축이다 — 나가기·강퇴 뒤 다음 위치를 이 값으로 고른다.
 */
@Entity
@Table(name = "island_arrivals")
@IdClass(IslandArrival.Key.class)
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IslandArrival {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Id
    @Column(name = "island_id", nullable = false)
    private UUID islandId;

    @Column(name = "first_arrived_at", nullable = false)
    private Instant firstArrivedAt;

    @Column(name = "last_arrived_at", nullable = false)
    private Instant lastArrivedAt;

    /**
     * 주민으로서 마지막 도착 시각 (GROMO-2302, V127) — null 이면 주민 도착 없음(방문자 도착만). 현 멤버십 시작보다
     * 이르면 다음 주민 도착이 «현 가입 이후 첫 도착» 이다({@code IslandMembershipService.arrive}).
     */
    @Column(name = "member_arrived_at")
    private Instant memberArrivedAt;

    /** 복합 PK — (userId, islandId). */
    @Getter
    @NoArgsConstructor
    @AllArgsConstructor
    @EqualsAndHashCode
    public static class Key implements Serializable {

        private UUID userId;
        private UUID islandId;
    }
}
