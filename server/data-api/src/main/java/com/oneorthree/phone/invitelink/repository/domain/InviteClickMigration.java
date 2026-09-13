package com.oneorthree.phone.invitelink.repository.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * 클릭 이관 한 회차 — <b>정지 스냅샷의 경계</b> (서비스 §7.2 · A22 ㋖ · ㋮).
 *
 * <p>시각 기반 증분 커서를 쓰지 않는다(㋖): 상태 변경 시각은 커밋 순서를 보장하지 않아 늦게 커밋된
 * 전이를 영구히 건너뛴다. 그래서 정지 창에서 <b>전체를 한 번에</b> 스냅샷으로 확정하고, 이 행이
 * 그 회차의 이름표다.
 */
@Entity
@Table(name = "invite_click_migrations")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class InviteClickMigration {

    @Id
    @Column(name = "migration_id", nullable = false, length = 80)
    private String migrationId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InviteClickMigrationStatus status;

    @Column(name = "frozen_at", nullable = false)
    private Instant frozenAt;

    @Column(name = "closed_at")
    private Instant closedAt;

    /** 스냅샷에 담긴 클릭 수 — 검증이 「유한한 구 행 집합」을 닫는 기준이다(㋮). */
    @Column(name = "row_count", nullable = false)
    private int rowCount;

    /**
     * 클릭 manifest 의 체크섬 — {@code [{clickId, sourceChecksum}]} 를 <b>clickId 오름차순</b>으로
     * 이은 canonical JSON 의 SHA-256.
     *
     * <p>스냅샷을 뜬 «그 순간»의 값이라 여기 박아 둔다. 나중에 다시 계산하면 그 사이 들어온 행이
     * 섞여, 이미 그 값으로 import 를 시작한 링크 서버가 {@code MANIFEST_CHANGED} 로 막힌다.
     */
    @Column(name = "source_checksum", nullable = false, length = 64)
    private String sourceChecksum;

    /** 스냅샷에 담긴 링크 수 — 클릭이 없는 slug 도 포함한다(㊏). */
    @Column(name = "link_count", nullable = false)
    private int linkCount;

    /** 링크 manifest 의 체크섬 — {@code [{linkId, sourceChecksum}]} 를 linkId 오름차순으로. */
    @Column(name = "link_checksum", nullable = false, length = 64)
    private String linkChecksum;

    /**
     * importer 쓰기를 닫는다 — <b>되돌리지 않는다</b>. 다시 열 수 있으면 늦은 백필이 이미 소진된
     * Neon 상태를 덮는 경로가 살아난다.
     *
     * @param at 차단 시각
     * @return 이번 호출이 실제로 닫았으면 {@code true}
     */
    public boolean close(Instant at) {
        if (this.status == InviteClickMigrationStatus.IMPORT_CLOSED) {
            return false;
        }
        this.status = InviteClickMigrationStatus.IMPORT_CLOSED;
        this.closedAt = at;
        return true;
    }
}
