package com.oneorthree.phone.friend.domain;

import com.oneorthree.phone.user.domain.User;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
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
        name = "friendships",
        uniqueConstraints = @UniqueConstraint(columnNames = {"from_user_id", "to_user_id"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class Friendship {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "from_user_id", nullable = false)
    private User fromUser;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "to_user_id", nullable = false)
    private User toUser;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Builder.Default
    private FriendshipStatus status = FriendshipStatus.PENDING;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private Instant updatedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    // 수신자가 요청 수락 (PENDING → ACCEPTED)
    public void accept() {
        this.status = FriendshipStatus.ACCEPTED;
    }

    // 수신자가 요청 거절 (PENDING → REJECTED)
    public void reject() {
        this.status = FriendshipStatus.REJECTED;
    }

    // REJECTED 상태의 기존 요청을 재요청으로 되살림 (REJECTED → PENDING)
    public void reopen() {
        this.status = FriendshipStatus.PENDING;
    }

    // 친구 관계 소프트 삭제 (deletedAt 기록)
    public void softDelete(Instant now) {
        this.deletedAt = now;
    }

    // 소프트 삭제된 행을 재요청으로 되살림 — unique(from_user_id, to_user_id) 때문에
    // 같은 방향의 새 행을 insert 할 수 없어 기존 행을 재사용한다(GroupMember.rejoin() 과 같은 패턴).
    // 삭제 전 상태(ACCEPTED·REJECTED)와 무관하게 새 요청이므로 PENDING 으로 초기화한다. (GROMO-719)
    public void restore() {
        this.deletedAt = null;
        this.status = FriendshipStatus.PENDING;
    }
}
