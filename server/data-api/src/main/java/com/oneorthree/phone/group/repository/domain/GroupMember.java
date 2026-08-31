package com.oneorthree.phone.group.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;

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

    /**
     * GROMO-676: 멤버 단위 공지 작성 권한 — 방장(OWNER)은 컬럼과 무관하게 항상 가능
     */
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

    /**
     * A-0 소프트삭제 사유 — 활성 멤버는 null, 탈퇴/강퇴 시 세팅. KICKED 는 재참여 차단 대상.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "left_reason", length = 10)
    private GroupLeaveReason leftReason;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    /** 자진 탈퇴 — 행을 보존하고 이탈 마킹(재참여 허용). (A-0) */
    public void leave() {
        this.isLeft = true;
        this.leftReason = GroupLeaveReason.LEFT;
    }

    /** 강퇴 — 이탈 마킹 + 재참여 차단 사유. (A-0/A-3) */
    public void kick() {
        this.isLeft = true;
        this.leftReason = GroupLeaveReason.KICKED;
    }

    /** 자진 탈퇴 후 재참여 — 기존 행을 되살린다(unique(user,group) 때문에 재삽입 불가). (A-0) */
    public void rejoin() {
        this.isLeft = false;
        this.leftReason = null;
        this.role = GroupMemberRole.MEMBER;
        this.status = GroupMemberStatus.INACTIVE;
        this.announcementPermission = GroupAnnouncementGrant.DISALLOW;
        this.notificationEnabled = true;
    }

    /** 강퇴 이력으로 재참여가 막힌 상태인지. (A-0 재가입 차단) */
    public boolean isKicked() {
        return this.isLeft && this.leftReason == GroupLeaveReason.KICKED;
    }

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
