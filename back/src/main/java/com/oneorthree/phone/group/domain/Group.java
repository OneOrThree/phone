package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
import java.util.UUID;

@Entity
@Table(name = "groups")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Group {

    // NOTE(671 스코프 밖 — 건드리지 말 것): code/code_expires_at→672,
    //   notice_permission/host_id/started_at/ended_at/bet_type→676.

    @Id
    @GeneratedUuidV7
    private UUID id;

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
    @Column(nullable = false)
    @Builder.Default
    private BetType betType = BetType.NONE;

    @Column(nullable = false)
    private int maxMembers;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupStatus status = GroupStatus.WAITING;

    private UUID hostId;

    // GROMO-671: dbml 은 version 을 누락했으나 낙관락(동시성)이 필요해 유지(UserWallet 과 동일 판단).
    @Version
    private Long version;

    @CreationTimestamp
    private Instant createdAt;

    private Instant startedAt;

    private Instant endedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    public void expireCode() {
        this.code = null;
        this.codeExpiresAt = null;
    }

    public void renewCode(String newCode) {
        this.code = newCode;
        this.codeExpiresAt = Instant.now().plus(3, ChronoUnit.HOURS);
    }

    public void transferOwner(UUID newOwnerId) {
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

    @Column(name = "is_chat_enabled", nullable = false)
    @Builder.Default
    private boolean isChatEnabled = true;

    @Column
    private Integer chatLimitPerPerson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupPermissionScope noticePermission = GroupPermissionScope.OWNER_ONLY;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private GroupPermissionScope invitePermission = GroupPermissionScope.OWNER_ONLY;

    public void updateDescription(String description) {
        this.description = description;
    }

    public void updateSettings(Boolean chatEnabled, Integer chatLimitPerPerson,
            GroupPermissionScope noticePermission, GroupPermissionScope invitePermission) {
        if (chatEnabled != null) {
            this.isChatEnabled = chatEnabled;
        }
        if (chatLimitPerPerson != null) {
            this.chatLimitPerPerson = chatLimitPerPerson;
        }
        if (noticePermission != null) {
            this.noticePermission = noticePermission;
        }
        if (invitePermission != null) {
            this.invitePermission = invitePermission;
        }
    }

    public void close() {
        this.status = GroupStatus.ENDED;
        this.endedAt = Instant.now();
    }
}
