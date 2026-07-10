package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.User;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "group_members",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "group_id"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class GroupMember {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id", nullable = false)
    private Group group;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 10)
    @Builder.Default
    private GroupMemberRole role = GroupMemberRole.MEMBER;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private GroupMemberStatus status = GroupMemberStatus.INACTIVE;

    // GROMO-676: 멤버 단위 공지 작성 권한 — 방장(OWNER)은 컬럼과 무관하게 항상 가능
    @Enumerated(EnumType.STRING)
    @Column(name = "announcement_permission", nullable = false)
    @Builder.Default
    private GroupAnnouncementGrant announcementPermission = GroupAnnouncementGrant.DISALLOW;

    @Column(nullable = false)
    @Builder.Default
    private boolean notificationEnabled = true;

    @Column(name = "is_left", nullable = false)
    @Builder.Default
    private boolean isLeft = false;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    public void demoteToMember() {
        this.role = GroupMemberRole.MEMBER;
    }

    public void promoteToOwner() {
        this.role = GroupMemberRole.OWNER;
    }

    public void allowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.ALLOW;
    }

    public void disallowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.DISALLOW;
    }

    /** 공지 작성/관리 가능 여부 — 방장은 항상 가능, 멤버는 권한(ALLOW) 부여 시 가능 (GROMO-676). */
    public boolean canWriteAnnouncement() {
        return role == GroupMemberRole.OWNER || announcementPermission == GroupAnnouncementGrant.ALLOW;
    }
}
