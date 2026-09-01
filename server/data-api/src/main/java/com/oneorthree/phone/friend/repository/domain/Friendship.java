package com.oneorthree.phone.friend.repository.domain;

import com.oneorthree.phone.user.repository.domain.User;

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

/**
 * 두 유저 사이의 친구 관계 한 줄. (from_user_id, to_user_id) 가 유니크라 같은 방향의 행은 하나뿐이고,
 * 그래서 거절·삭제 뒤의 재요청은 새 행을 넣는 대신 이 행의 상태를 되돌려 재사용한다
 * ({@link #reopen()} · {@link #restore()}).
 *
 * <p>관계 자체는 대칭이지만 저장은 요청 방향 그대로다 — "내 친구"를 찾으려면 from·to 양쪽을 봐야 한다.
 * 상태 전이는 전부 이 클래스의 메서드로만 하고, 필드를 직접 바꾸는 통로는 두지 않았다.
 */
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

    /**
     * 수신자가 요청 수락 (PENDING → ACCEPTED)
     */
    public void accept() {
        this.status = FriendshipStatus.ACCEPTED;
    }

    /**
     * 수신자가 요청 거절 (PENDING → REJECTED)
     */
    public void reject() {
        this.status = FriendshipStatus.REJECTED;
    }

    /**
     * REJECTED 상태의 기존 요청을 재요청으로 되살림 (REJECTED → PENDING).
     * ⚠ createdAt 은 여기서 갱신하지 않는다(못 한다) — @CreationTimestamp 는 insert 생성 프로퍼티라
     * Hibernate 6 가 UPDATE SQL 에서 컬럼을 제외하므로, 수동 대입은 더티체킹에 잡혀도 조용히 버려진다.
     * 재요청 시점은 이 UPDATE 가 갱신하는 updatedAt(@UpdateTimestamp)이 담당한다 — PENDING 행의
     * 마지막 변경 시각 = 요청 사이클 시작 시각. 응답 매핑은 getRequests 참고 (GROMO-719).
     */
    public void reopen() {
        this.status = FriendshipStatus.PENDING;
    }

    /**
     * 친구 관계 소프트 삭제 (deletedAt 기록)
     *
     * @param now 삭제 시각. 호출측이 넘겨 한 번의 탈퇴 정리에서 모든 행이 같은 시각을 갖게 한다
     *            ({@code Instant.now()} 를 안에서 부르면 행마다 미세하게 갈린다)
     */
    public void softDelete(Instant now) {
        this.deletedAt = now;
    }

    /**
     * 소프트 삭제된 행을 재요청으로 되살림 — unique(from_user_id, to_user_id) 때문에
     * 같은 방향의 새 행을 insert 할 수 없어 기존 행을 재사용한다(GroupMember.rejoin() 과 같은 패턴).
     * 삭제 전 상태(ACCEPTED·REJECTED)와 무관하게 새 요청이므로 PENDING 으로 초기화한다. (GROMO-719)
     * ⚠ createdAt 은 원래 관계의 시각 그대로 남는다 — 갱신 불가 사유와 대안(updatedAt)은 reopen() 주석 참고.
     */
    public void restore() {
        this.deletedAt = null;
        this.status = FriendshipStatus.PENDING;
    }
}
