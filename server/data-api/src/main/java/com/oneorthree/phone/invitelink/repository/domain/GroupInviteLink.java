package com.oneorthree.phone.invitelink.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.UUID;

/**
 * 그룹 초대 링크 — slug 하나가 (그룹, 초대자) 한 쌍을 가리키는 원장.
 *
 * <p>groupId 를 URL 에 그대로 쓰지 않고 slug 를 두는 이유는 셋이다. ① "누가 데려왔나"(inviter)까지
 * 식별해야 하는데 유저 id 를 URL 에 노출하고 싶지 않고, ② 링크 단위 수명 관리를 그룹과 분리할 수 있고,
 * ③ 클릭·매치 기록이 매달릴 FK 앵커가 필요하다.
 *
 * <p>(그룹, 초대자)당 1행만 두고 재사용한다(멱등 발급) — 같은 사람이 같은 방을 여러 번 공유해도
 * 링크는 하나여야 어트리뷰션이 한 줄기로 모인다. 유니크 제약이 동시 발급 레이스의 최후 방어선이다.
 *
 * <p>이웃 도메인({@code group/})과 달리 연관관계 대신 raw UUID 컬럼을 쓴다. 신규 도메인이 group·user
 * 엔티티에 컴파일 의존하지 않게 해 결합을 줄이는 편이 이득이고, 참조 무결성은 DB FK 가 보장한다.
 */
@Entity
@Table(name = "group_invite_links",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_invite_links_group_inviter",
                columnNames = {"group_id", "inviter_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GroupInviteLink {

    @Id
    @GeneratedUuidV7
    private UUID id;

    /** 링크 식별자. 8자·혼동 문자 제외 알파벳({@code SlugGenerator}), 컬럼은 규칙 변경 여지로 12. */
    @Column(nullable = false, unique = true, length = 12)
    private String slug;

    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    @Column(name = "inviter_id", nullable = false)
    private UUID inviterId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    public GroupInviteLink(String slug, UUID groupId, UUID inviterId) {
        this.slug = slug;
        this.groupId = groupId;
        this.inviterId = inviterId;
    }
}
