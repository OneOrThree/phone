package com.oneorthree.phone.appearance.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.util.UUID;

/**
 * 개인 외양 — 유저당 한 행의 <b>전체 상태</b> (GROMO-1783, island-appearance LLD §1.2·§2).
 *
 * <p>{@code version} 은 이 행을 배타 잠금한 writer 만 올린다 — 잠금이 쓰기를 직렬화하므로
 * version 순서가 곧 커밋 순서다. 변경이 없는 명령은 version 을 올리지 않는다.
 */
@Entity
@Table(name = "personal_appearances")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PersonalAppearance {

    public static final String HULL_RAFT = "raft";
    public static final String POSITION_FRONT = "front";
    public static final String POSITION_BACK = "back";

    @Id
    @Column(name = "user_id")
    private UUID userId;

    /** 적용 중인 clothes 상품 — 미착용은 null. */
    @Column(length = 80)
    private String clothes;

    /** 적용 중인 decor 상품 — 미착용은 null. */
    @Column(length = 80)
    private String decor;

    /** 배 종류 폐지로 {@link #HULL_RAFT} 하나다 — 상품이 아니라 예약 표현. */
    @Column(nullable = false, length = 20)
    private String hull = HULL_RAFT;

    @Column(nullable = false, length = 10)
    private String position = POSITION_FRONT;

    @Column(nullable = false)
    private long version = 0L;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    private PersonalAppearance(UUID userId, Instant now) {
        this.userId = userId;
        this.updatedAt = now;
    }

    public static PersonalAppearance empty(UUID userId, Instant now) {
        return new PersonalAppearance(userId, now);
    }

    /**
     * 병합된 전체 상태를 반영한다 — 호출부는 이미 kind·소유·허용값 검증을 끝냈다.
     * 실제 변경이 있을 때만 version 을 올린다.
     *
     * @return version 이 올랐으면 {@code true}
     */
    public boolean apply(String clothes, String decor, String hull, String position, Instant now) {
        if (java.util.Objects.equals(this.clothes, clothes) && java.util.Objects.equals(this.decor, decor)
                && this.hull.equals(hull) && this.position.equals(position)) {
            return false;
        }
        this.clothes = clothes;
        this.decor = decor;
        this.hull = hull;
        this.position = position;
        this.version += 1;
        this.updatedAt = now;
        return true;
    }
}
