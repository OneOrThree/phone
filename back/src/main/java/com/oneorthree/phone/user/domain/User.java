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
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "users")
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

    @Enumerated(EnumType.STRING)
    private Gender gender;

    private LocalDate birthDate;

    @Column(name = "country_code")
    private String countryCode;

    @Enumerated(EnumType.STRING)
    private Occupation occupation;

    @Column(name = "current_tier")
    private Integer currentTier;

    // 개인 통계 공개 범위 — migration v22 로 컬럼 추가 (NOT NULL DEFAULT 'FRIENDS')
    // columnDefinition 으로 DB default 지정 → ddl-auto=update 환경에서 v22 선적용 없이 배포 시 기존 row ALTER 실패 방지
    @Enumerated(EnumType.STRING)
    @Column(name = "stat_visibility", nullable = false, columnDefinition = "varchar(20) not null default 'FRIENDS'")
    @Builder.Default
    private StatVisibility statVisibility = StatVisibility.FRIENDS;

    @Column(name = "report_time")
    private LocalTime reportTime;

    // FCM registration token — 최대 길이가 문서로 보장되지 않아 512 로 여유 확보 (GROMO-528, migration v23 선적용)
    @Column(length = 512)
    private String deviceToken;

    private String refreshToken;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    private Instant deletedAt;

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
