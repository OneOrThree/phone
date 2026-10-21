package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/** 첫 소속이 없는 사용자의 미정착 무인도. 도착 전에는 소속·현재 섬을 만들지 않는다. */
@Entity
@Table(name = "onboarding_islands")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class OnboardingIsland {
    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "island_id", nullable = false, unique = true)
    private UUID islandId;
}
