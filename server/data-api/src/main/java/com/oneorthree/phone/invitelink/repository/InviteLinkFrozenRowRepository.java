package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteLinkFrozenRow;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkFrozenRowId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 링크 정지 스냅샷 저장소 — <b>읽기가 전부</b>다 (A22 ㊏).
 *
 * <p>정렬을 {@code link_id} 오름차순으로 고정하는 것이 계약이다. 링크 서버의 최종 검증이
 * {@code ORDER BY m.link_id} 로 모은 manifest 의 체크섬을 대조하므로, 여기서 다른 순서로 주면
 * 같은 행을 담고도 <b>체크섬이 달라</b> 검증이 닫히지 않는다.
 */
public interface InviteLinkFrozenRowRepository
        extends JpaRepository<InviteLinkFrozenRow, InviteLinkFrozenRowId> {

    /**
     * 벌크 export 한 페이지 — <b>{@code link_id} 오름차순</b>.
     *
     * <p>커서 비교도 DB 의 uuid 정렬을 그대로 쓴다. 애플리케이션에서 {@code UUID.compareTo} 로
     * 자르면 그쪽은 <b>부호 있는</b> long 비교라, 상위 비트가 선 uuid 에서 순서가 갈린다.
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 linkId. 첫 페이지는 최소값
     * @param limit       최대 건수
     * @return 그 페이지의 스냅샷 행
     */
    @Query(value = "SELECT * FROM invite_link_frozen_rows r WHERE r.migration_id = :migrationId "
            + "AND r.link_id > CAST(:cursor AS uuid) ORDER BY r.link_id ASC LIMIT :limit",
            nativeQuery = true)
    List<InviteLinkFrozenRow> findPage(
            @Param("migrationId") String migrationId,
            @Param("cursor") String cursor,
            @Param("limit") int limit);

    /**
     * manifest 계산용 — <b>{@code link_id} 오름차순</b>의 {@code (linkId, sourceChecksum)} 전부.
     *
     * @param migrationId 이관 회차
     * @return 링크 서버의 {@code verifyLinks} 가 만드는 것과 같은 순서·같은 쌍
     */
    @Query(value = "SELECT r.link_id AS id, r.source_checksum AS checksum "
            + "FROM invite_link_frozen_rows r WHERE r.migration_id = :migrationId "
            + "ORDER BY r.link_id ASC", nativeQuery = true)
    List<ManifestEntry> findManifest(@Param("migrationId") String migrationId);

    /**
     * @param migrationId 이관 회차
     * @return 그 회차의 링크 수
     */
    long countByMigrationId(String migrationId);
}
