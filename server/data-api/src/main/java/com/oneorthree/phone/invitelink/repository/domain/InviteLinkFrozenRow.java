package com.oneorthree.phone.invitelink.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.Map;
import java.util.UUID;

/**
 * 링크 하나의 <b>정지 스냅샷 행</b> — 클릭이 한 번도 없던 slug 까지 포함한다 (A22 ㊏ · 서비스 §7.2).
 *
 * <p><b>왜 클릭에서 역산하지 않는가.</b> 클릭 스냅샷의 링크 필드만 쓰면 「아직 아무도 누르지 않은
 * 초대」가 통째로 빠진다. 그 slug 는 이미 공유돼 있고, 전환 직후 눌리면 링크 서버에 원장이 없어
 * 실패한다 — 되돌릴 수 없는 실패다.
 *
 * <p>링크 서버의 {@code FrozenLink} 13필드를 그대로 담는다. 클릭과 같은 이유로 jsonb 다 — 그쪽
 * 정규화 규칙(세대 문자열화 · 시각 ms 절삭 · null 명시)이 <b>체크섬의 일부</b>라, 저장된 값 자체가
 * 체크섬의 입력이어야 한다.
 */
@Entity
@Table(name = "invite_link_frozen_rows")
@IdClass(InviteLinkFrozenRowId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class InviteLinkFrozenRow {

    @Id
    @Column(name = "migration_id", nullable = false, length = 80)
    private String migrationId;

    @Id
    @Column(name = "link_id", nullable = false)
    private UUID linkId;

    @Column(nullable = false, length = 12)
    private String slug;

    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    @Column(name = "inviter_id", nullable = false)
    private UUID inviterId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "frozen_source", nullable = false)
    private Map<String, Object> frozenSource;

    @Column(name = "source_checksum", nullable = false, length = 64)
    private String sourceChecksum;
}
