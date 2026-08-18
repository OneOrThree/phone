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
import java.util.UUID;

@Entity
@Table(name = "groups")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Group {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(nullable = false, length = 50)
    @Builder.Default
    private String name = "";

    @Column(length = 100)
    private String password;

    @Column(length = 200)
    private String description;

    @Column(nullable = false)
    private int maxMembers;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupStatus status = GroupStatus.WAITING;

    // 공개/비공개 구분 — true 면 이름 검색에서 제외되고 초대 링크(groupId)로만 참여한다.
    @Column(name = "is_private", nullable = false)
    @Builder.Default
    private boolean isPrivate = false;

    // GROMO-671: dbml 은 version 을 누락했으나 낙관락(동시성)이 필요해 유지(UserWallet 과 동일 판단).
    @Version
    private Long version;

    @CreationTimestamp
    private Instant createdAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

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
    private GroupPermissionScope invitePermission = GroupPermissionScope.OWNER_ONLY;

    public void updateDescription(String description) {
        this.description = description;
    }

    /** 공개/비밀 전환 (A-1) — 비밀방은 검색 제외, 초대 링크 전용. */
    public void updateIsPrivate(boolean isPrivate) {
        this.isPrivate = isPrivate;
    }

    public void updateSettings(Boolean chatEnabled, Integer chatLimitPerPerson,
            GroupPermissionScope invitePermission) {
        if (chatEnabled != null) {
            this.isChatEnabled = chatEnabled;
        }
        if (chatLimitPerPerson != null) {
            this.chatLimitPerPerson = chatLimitPerPerson;
        }
        if (invitePermission != null) {
            this.invitePermission = invitePermission;
        }
    }

    // GROMO-676: 챌린지 생명주기(started/ended_at)는 group_challenges 소유 — 그룹 종료는 status 만 전이한다.
    public void close() {
        this.status = GroupStatus.ENDED;
    }
}
