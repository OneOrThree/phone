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

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * 구 {@code invite_link_clicks} 의 <b>정지 스냅샷 행</b> — read-only 다 (서비스 §7.2 · A22 ㊥).
 *
 * <p><b>소진 상태 컬럼이 없다.</b> 정지 창에도 쓰기 원장은 Neon 하나이고, 양쪽에서 소진하면 잠금이
 * 공유되지 않아 같은 클릭이 두 기기에 배정된다. 구 DB 는 후보 <b>조회</b>만 한다.
 *
 * <p>{@code sourceChecksum} 은 ㋮ 4단계 검증의 기준이다 — 표시가 있는 행은 「원본 체크섬 + 불변 필드
 * 일치 + 소진 상태와 감사 레코드 일치」로 검증하므로, 이 값이 빠지면 검증을 닫을 수 없다.
 */
@Entity
@Table(name = "invite_click_frozen_rows")
@IdClass(InviteClickFrozenRowId.class)
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class InviteClickFrozenRow {

    @Id
    @Column(name = "migration_id", nullable = false, length = 80)
    private String migrationId;

    @Id
    @Column(name = "click_id", nullable = false)
    private UUID clickId;

    @Column(nullable = false, length = 12)
    private String slug;

    @Column(name = "group_id", nullable = false)
    private UUID groupId;

    /** {@code SHA-256(UTF8(ip + 기존 salt))} 그대로다 — salt 를 새로 만들면 매치가 전멸한다(ⓕ). */
    @Column(name = "ip_hash", nullable = false, length = 64)
    private String ipHash;

    @Column(nullable = false, length = 16)
    private String os;

    @Column(name = "clicked_at", nullable = false)
    private Instant clickedAt;

    @Column(nullable = false)
    private boolean matched;

    /**
     * 링크 서버 importer 가 받는 <b>정규화된 원본 그대로</b> — {@code migration.ts} 의 24필드.
     *
     * <p>컬럼으로 펴지 않는 이유는 그쪽 정규화 규칙(타임스탬프 ms 절삭 · 세대 문자열화 · null 허용)이
     * <b>체크섬의 일부</b>이기 때문이다. 저장된 이 값이 곧 체크섬의 입력이라, 조립 순서가 어긋나면
     * 이관 당일이 아니라 <b>정지 스냅샷을 만드는 순간</b> 드러난다.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "frozen_source", nullable = false)
    private Map<String, Object> frozenSource;

    @Column(name = "source_checksum", nullable = false, length = 64)
    private String sourceChecksum;
}
