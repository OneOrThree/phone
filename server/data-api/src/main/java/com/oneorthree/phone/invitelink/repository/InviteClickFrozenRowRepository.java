package com.oneorthree.phone.invitelink.repository;

import com.oneorthree.phone.invitelink.repository.domain.InviteClickFrozenRow;
import com.oneorthree.phone.invitelink.repository.domain.InviteClickFrozenRowId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

/**
 * 정지 스냅샷 저장소 — <b>읽기가 전부</b>다 (A22 ㊥).
 *
 * <p>소진을 여기서 하지 않는다. 쓰기 원장은 Neon 하나이고, 양쪽에서 소진하면 잠금이 공유되지 않아
 * 같은 클릭이 두 기기에 배정된다.
 */
public interface InviteClickFrozenRowRepository
        extends JpaRepository<InviteClickFrozenRow, InviteClickFrozenRowId> {

    /**
     * 호환 매치의 후보 조회 — <b>(회차, ipHash, os)</b> 로 좁힌다.
     *
     * <p>3시간 창 판정과 「이미 소진됐는가」는 호출부가 아니라 <b>링크 서버</b>가 한다. 여기서 걸러
     * 주면 Neon 이 이미 소진한 행을 구 DB 기준으로 되살릴 수 있다.
     *
     * @param migrationId 이관 회차
     * @param ipHash      기존 salt 로 만든 해시
     * @param os          {@code ios} · {@code android} · {@code other}
     * @return 최근 클릭부터
     */
    @Query("SELECT r FROM InviteClickFrozenRow r WHERE r.migrationId = :migrationId "
            + "AND r.ipHash = :ipHash AND r.os = :os ORDER BY r.clickedAt DESC")
    List<InviteClickFrozenRow> findCandidates(
            @Param("migrationId") String migrationId,
            @Param("ipHash") String ipHash,
            @Param("os") String os);

    /**
     * @param migrationId 이관 회차
     * @return 그 회차에 담긴 행 수 — 검증이 집합을 닫는 기준
     */
    long countByMigrationId(String migrationId);

    /**
     * 벌크 export 한 페이지 — <b>{@code click_id} 오름차순</b>.
     *
     * <p>링크 서버의 최종 검증이 {@code ORDER BY m.click_id} 로 모은 manifest 를 대조하므로 순서가
     * 곧 계약이다. 커서 비교도 DB 의 uuid 정렬을 쓴다 — {@code UUID.compareTo} 는 <b>부호 있는</b>
     * long 비교라 상위 비트가 선 uuid 에서 순서가 갈린다.
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 clickId. 첫 페이지는 최소값
     * @param limit       최대 건수
     * @return 그 페이지의 스냅샷 행
     */
    @Query(value = "SELECT * FROM invite_click_frozen_rows r WHERE r.migration_id = :migrationId "
            + "AND r.click_id > CAST(:cursor AS uuid) ORDER BY r.click_id ASC LIMIT :limit",
            nativeQuery = true)
    List<InviteClickFrozenRow> findPage(
            @Param("migrationId") String migrationId,
            @Param("cursor") String cursor,
            @Param("limit") int limit);

    /**
     * manifest 계산용 — <b>{@code click_id} 오름차순</b>의 {@code (clickId, sourceChecksum)} 전부.
     *
     * @param migrationId 이관 회차
     * @return 링크 서버의 {@code verify} 가 만드는 것과 같은 순서·같은 쌍
     */
    @Query(value = "SELECT r.click_id AS id, r.source_checksum AS checksum "
            + "FROM invite_click_frozen_rows r WHERE r.migration_id = :migrationId "
            + "ORDER BY r.click_id ASC", nativeQuery = true)
    List<ManifestEntry> findManifest(@Param("migrationId") String migrationId);
}
