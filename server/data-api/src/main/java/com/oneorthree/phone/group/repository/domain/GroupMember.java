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

/**
 * 그룹 멤버십 한 건 — 유저×그룹 unique 라 <b>한 유저는 같은 그룹에 행이 하나뿐</b>이다.
 *
 * <p>이탈은 삭제가 아니라 마킹이다(A-0 소프트삭제): {@code isLeft} 가 이탈 여부, {@code leftReason} 이
 * 사유를 든다. 행이 남아 있기 때문에 <b>"멤버인가"를 행 존재로 판단하면 안 된다</b> — 탈퇴자까지 현원에
 * 섞이고 정원 축소가 유령 자리에 막힌다(GROMO-1220). 활성 조회는 {@code isLeft = false} 를 함께 건다.
 *
 * <p>재참여도 행 재삽입이 아니라 {@link #rejoin()} 으로 기존 행을 되살린다 — unique 제약 때문에 새로 넣을
 * 수 없다.
 */
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

    /**
     * 강퇴 이력으로 재참여가 막힌 상태인지. (A-0 재가입 차단)
     *
     * @return 이탈 마킹 <b>과</b> 사유 KICKED 가 함께일 때만 true — 강퇴 후 방장이 다시 넣어
     *     {@code isLeft} 가 풀린 행은 false 다(차단은 지금 나가 있는 사람에게만 건다)
     */
    public boolean isKicked() {
        return this.isLeft && this.leftReason == GroupLeaveReason.KICKED;
    }

    /** 방장 → 일반 멤버 강등. 방장 위임은 이 호출과 {@link #promoteToOwner()} 를 같은 트랜잭션에서 짝지어야 한다. */
    public void demoteToMember() {
        this.role = GroupMemberRole.MEMBER;
    }

    /**
     * 일반 멤버 → 방장 승격. 기존 방장을 강등하는 일은 하지 않으므로, 짝을 빠뜨리면 방장이 둘이 된다.
     */
    public void promoteToOwner() {
        this.role = GroupMemberRole.OWNER;
    }

    /** 이 멤버에게 공지 작성 권한 부여 (GROMO-676). 방장에게는 의미가 없다 — 역할만으로 이미 가능하다. */
    public void allowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.ALLOW;
    }

    /**
     * 공지 작성 권한 회수 — 멤버 단위 컬럼만 되돌린다. 대상이 방장이면 {@link #canWriteAnnouncement()} 는
     * 여전히 true 다(역할이 컬럼을 덮는다).
     */
    public void disallowAnnouncement() {
        this.announcementPermission = GroupAnnouncementGrant.DISALLOW;
    }

    /**
     * 공지 작성/관리 가능 여부 — 방장은 항상 가능, 멤버는 권한(ALLOW) 부여 시 가능 (GROMO-676).
     *
     * @return 작성·수정·삭제를 한 번에 가르는 단일 판정. <b>이탈 여부는 보지 않으므로</b> 호출측이
     *     활성 멤버십을 먼저 확인한 뒤에 물어야 한다
     */
    public boolean canWriteAnnouncement() {
        return role == GroupMemberRole.OWNER || announcementPermission == GroupAnnouncementGrant.ALLOW;
    }
}
