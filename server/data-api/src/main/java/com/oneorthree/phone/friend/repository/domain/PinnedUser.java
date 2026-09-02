package com.oneorthree.phone.friend.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.repository.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

import java.time.Instant;
import java.util.UUID;

/**
 * 유저가 다른 유저를 화면에 고정해 둔 핀 한 줄. 친구 관계와 독립이라 친구가 아닌 상대도 핀할 수 있고,
 * (user_id, pinned_user_id) 유니크가 중복 핀을 DB 차원에서 막아 설정을 멱등으로 만든다.
 *
 * <p>소프트딜리트 컬럼이 없다 — 핀은 이력 가치가 없는 표시용 관계라 해제하면 행을 지운다.
 */
@Entity
@Table(
        name = "pinned_users",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "pinned_user_id"})
)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class PinnedUser {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "pinned_user_id", nullable = false)
    private User pinnedUser;

    @CreationTimestamp
    @Column(name = "created_at")
    private Instant createdAt;
}
