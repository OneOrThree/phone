package com.oneorthree.phone.domain.group;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

@Entity
@Table(name = "groups")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Group {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 50)
    @Builder.Default
    private String name = "";

    @Column(unique = true, length = 8)
    private String code;

    @Column(name = "code_expires_at")
    private Instant codeExpiresAt;

    @Column(length = 100)
    private String password;

    @Column(length = 200)
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "mission_category", nullable = false)
    private MissionCategory missionCategory;

    @Enumerated(EnumType.STRING)
    @Column(name = "mission_type", nullable = false)
    private MissionType missionType;

    private Instant windowStart;

    private Instant windowEnd;

    private Integer durationMinutes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private BetType betType = BetType.NONE;

    @Column(nullable = false)
    private int maxMembers;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupStatus status = GroupStatus.WAITING;

    private Long hostId;

    @Version
    private Long version;

    @CreationTimestamp
    private Instant createdAt;

    private Instant startedAt;

    private Instant endedAt;

    public void expireCode() {
        this.code = null;
        this.codeExpiresAt = null;
    }

    public void renewCode(String newCode) {
        this.code = newCode;
        this.codeExpiresAt = Instant.now().plus(3, ChronoUnit.HOURS);
    }

    public void transferOwner(Long newOwnerId) {
        hostId = newOwnerId;
    }

    public void updateName(String newName) {
        this.name = newName;
    }

    public void updateMaxMembers(int newMaxMembers) {
        this.maxMembers = newMaxMembers;
    }

    public void updatePassword(String newPassword) {
        this.password = newPassword;
    }

    public void removePassword() {
        this.password = null;
    }

    // TODO GROMO-377: 설정 컬럼 필드 추가
    //  - boolean chatEnabled (@Column NOT NULL, @Builder.Default true)
    //  - Integer chatLimitPerPerson (@Column nullable, null=무제한)
    //  - GroupPermissionScope noticePermission (@Enumerated STRING, @Column NOT NULL, default OWNER_ONLY)
    //  - GroupPermissionScope invitePermission (@Enumerated STRING, @Column NOT NULL, default OWNER_ONLY)
    //  도메인 메서드:
    //  - updateDescription(String description)
    //  - updateSettings(Boolean chatEnabled, Integer chatLimitPerPerson,
    //    GroupPermissionScope noticePermission, GroupPermissionScope invitePermission)
    //    (null인 파라미터는 기존값 유지)

    // TODO GROMO-284: close() 메서드 추가
    //  - this.status = GroupStatus.CLOSED; this.endedAt = Instant.now();
    //  - 마지막 멤버 탈퇴 시 호출
}
