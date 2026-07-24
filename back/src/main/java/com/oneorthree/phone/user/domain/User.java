package com.oneorthree.phone.user.domain;

import com.oneorthree.phone.item.domain.CharacterEquipment;
import com.oneorthree.phone.item.domain.UserItem;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
// nickname 유니크 — 닉네임 중복 방지 (GROMO-584). nullable(게스트·온보딩 전)이나 Postgres 는 NULL 을
// 서로 다른 값으로 취급해 다중 NULL 을 허용하므로 전체 유니크로 충분(부분 인덱스 불필요).
@Table(name = "users",
        uniqueConstraints = @UniqueConstraint(name = "uq_users_nickname", columnNames = "nickname"))
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class User {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(nullable = false)
    @Builder.Default
    private boolean isGuest = false;

    private String nickname;

    @Column(name = "country_code")
    private String countryCode;

    @Enumerated(EnumType.STRING)
    private Occupation occupation;

    @Column(name = "tier_level", nullable = false, columnDefinition = "integer not null default 1")
    @Builder.Default
    private int tierLevel = 1;

    // 개인 통계 공개 범위 — migration v22 로 컬럼 추가 (NOT NULL DEFAULT 'FRIENDS')
    // columnDefinition 으로 DB default 지정 → ddl-auto=update 환경에서 v22 선적용 없이 배포 시 기존 row ALTER 실패 방지
    @Enumerated(EnumType.STRING)
    @Column(name = "stat_visibility", nullable = false, columnDefinition = "varchar(20) not null default 'FRIENDS'")
    @Builder.Default
    private StatVisibility statVisibility = StatVisibility.FRIENDS;

    // FCM registration token — 최대 길이가 문서로 보장되지 않아 512 로 여유 확보 (GROMO-528, migration v23 선적용)
    @Column(length = 512)
    private String deviceToken;

    private String refreshTokenHash;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    // 회원탈퇴 삭제 대기 플래그 — 동의 보관기간 경과 후 배치 하드 삭제(retention→purge). GROMO-671
    @Column(name = "is_deleted", nullable = false)
    @Builder.Default
    private boolean isDeleted = false;

    // 마지막 활동 시각 — 미접속 복귀 푸시(GROMO-578)의 D+3/7/14 판정 기준. JwtFilter 가 하루 1회 스로틀 갱신.
    // columnDefinition 으로 DB default now() 지정 → stat_visibility(v22) 선례와 동일하게 ddl-auto=update(prod)
    // 환경에서 migration v25 선적용 없이 배포돼도 기존 row ALTER 실패 방지. 신규 유저는 @Builder.Default 로 채움
    // (AuthService 미수정 — 585 충돌 회피).
    @Column(name = "last_active_at", nullable = false,
            columnDefinition = "timestamptz not null default now()")
    @Builder.Default
    private Instant lastActiveAt = Instant.now();

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<SocialAccount> socialAccounts = new ArrayList<>();

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<UserItem> userItems = new ArrayList<>();

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CharacterEquipment> characterEquipments = new ArrayList<>();
}
