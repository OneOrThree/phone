package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import com.oneorthree.phone.user.domain.User;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 유저가 채택한 집중 태그 (user_focus_tags).
 *
 * <p>태그의 정체성은 {@link DefaultTag}(default_tag_id)에 있고, 이 엔티티는 "어떤 유저가 그 태그를 채택했는가"
 * 를 나타내는 유저-태그 연결이다. 커스텀 태그도 먼저 {@link DefaultTag} 에 등록한 뒤 이 행으로 채택한다.
 * 동일 태그 중복 채택은 <b>활성 행 한정</b> DB partial unique index
 * ({@code uq_user_focus_tags_user_default_active ON (user_id, default_tag_id) WHERE deleted_at IS NULL},
 * V4 마이그레이션)가 막는다 — 소프트딜리트 후 같은 태그 재채택을 허용해야 하므로 테이블 UNIQUE 가 아니며,
 * JPA 애노테이션으로는 partial index 를 표현할 수 없어 여기엔 선언하지 않는다(DB 인덱스가 소스).
 *
 * <p>{@code focus_sessions.focus_tag_id} 가 이 행을 참조하므로, 채택 태그를 제거해도 참조 무결성을 위해
 * 하드 삭제 대신 {@code deletedAt} 소프트 딜리트로 처리한다.
 */
@Entity
@Table(name = "user_focus_tags")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class UserFocusTag {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // 태그 정체성 — 마스터(default_tags) 참조. name 은 여기서 조회.
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "default_tag_id", nullable = false)
    private DefaultTag defaultTag;

    // 출처(nullable) — occupation 추천에서 채택했다면 어느 추천 행에서 왔는지. 커스텀 태그면 null.
    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "source_occupation_default_tag_id")
    private OccupationDefaultTag sourceOccupationDefaultTag;

    @CreationTimestamp
    private Instant createdAt;

    // 소프트 딜리트 — focus_sessions.focus_tag_id 가 이 행을 참조하므로 하드 삭제 대신 소프트 딜리트.
    private Instant deletedAt;

    public void softDelete() {
        this.deletedAt = Instant.now();
    }
}
