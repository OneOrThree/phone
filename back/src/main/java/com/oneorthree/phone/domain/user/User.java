package com.oneorthree.phone.domain.user;

import com.oneorthree.phone.domain.item.CharacterEquipment;
import com.oneorthree.phone.domain.item.UserItem;
import com.oneorthree.phone.domain.league.LeagueTier;

import com.oneorthree.phone.exception.CurrencyErrorCode;
import com.oneorthree.phone.exception.CurrencyException;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

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

    private String nickname;

    @Enumerated(EnumType.STRING)
    private Gender gender;

    private LocalDate birthDate;

    private String profileImageUrl;

    private String refreshToken;

    @Version
    @Builder.Default
    private Long version = 0L;

    @Builder.Default
    private int currency = 0;

    @Enumerated(EnumType.STRING)
    private LeagueTier currentTier;

    @Column(nullable = false)
    @Builder.Default
    private int dailyScreenTimeGoalMinutes = 0;

    private String timeZone;

    private LocalTime dayStartTime;

    private LocalTime dayEndTime;

    private LocalTime reportTime;

    @CreationTimestamp
    private Instant createdAt;

    private Instant deletedAt;

    @Column(nullable = false)
    @Builder.Default
    private boolean isGuest = false;

    @Column(length = 255)
    private String deviceToken;

    @Column(nullable = false)
    @Builder.Default
    private boolean screenTimePermissionGranted = false;

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<SocialAccount> socialAccounts = new ArrayList<>();

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<UserItem> userItems = new ArrayList<>();

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CharacterEquipment> characterEquipments = new ArrayList<>();

    public void earnCurrency(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 증가는 양수 단위로만 되어야 합니다.");
        }
        this.currency += amount;
    }

    public void spendCurrency(int amount) {
        if (amount <= 0) {
            throw new IllegalArgumentException("잔액 감소는 양수 단위로만 되어야 합니다.");
        }
        if (this.currency < amount) {
            throw new CurrencyException(CurrencyErrorCode.INSUFFICIENT_CURRENCY);
        }
        this.currency -= amount;
    }
}
