package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.FrozenClickCandidateResponse;
import com.oneorthree.phone.internal.dto.FrozenPageResponse;
import com.oneorthree.phone.internal.dto.MigrationManifestResponse;
import com.oneorthree.phone.internal.service.InternalClickMigrationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 클릭 이관의 내부 표면 — <b>서비스 전용</b>이다 (서비스 §7.2 · A22 ㊥ · ㋮).
 *
 * <p>{@code X-User-Id} 가 없다. 일반 방문자 입력으로 받는 경로가 아니라 {@code migrationId} 로
 * 제한된 이관 경로이고, 그 사실이 허용목록에도 그대로 드러나야 한다(㉱).
 *
 * <p><b>소진하지 않는다.</b> 매치는 읽기가 아니라 쓰기이고 정지 창에도 쓰기 원장은 Neon 하나다 —
 * 양쪽에서 소진하면 잠금이 공유되지 않아 같은 클릭이 두 기기에 배정된다.
 */
@RestController
@RequestMapping("/internal/migrations/{migrationId}/invite-link-clicks")
@RequiredArgsConstructor
public class InternalMigrationController {

    private final InternalClickMigrationService internalClickMigrationService;

    /**
     * 정지 스냅샷을 확정한다 — <b>구 쓰기 정지·drain 이후에만</b> 의미가 있다.
     *
     * <p>그 전에 부르면 아직 변하는 행을 담게 되고, 시각 기반 커서로는 늦게 커밋된 전이를 영구히
     * 건너뛴다(㋖). 같은 회차로 다시 불러도 스냅샷은 다시 뜨지 않는다 — 다시 뜨면 이미 그 체크섬으로
     * 반영된 Neon 행이 전부 막힌다.
     *
     * @param migrationId 이관 회차
     * @return 담긴 행 수
     */
    @PostMapping("/freeze")
    public ResponseEntity<Map<String, Object>> freeze(@PathVariable String migrationId) {
        InternalClickMigrationService.FreezeResult result =
                internalClickMigrationService.freeze(migrationId);
        return ResponseEntity.ok(Map.of(
                "migrationId", migrationId,
                "expectedClicks", result.clicks(),
                "expectedLinks", result.links()));
    }

    /**
     * 이관 회차의 manifest — importer 가 배치마다 <b>같은 값 전체</b>를 실어 보낸다.
     *
     * <p>여기서 매번 다시 세지 않는다. 요청마다 계산하면 그 사이 들어온 행이 섞여, 이미 그 값으로
     * import 를 시작한 링크 서버가 {@code MANIFEST_CHANGED} 로 통째로 막힌다 — 스냅샷을 뜬 순간의
     * 값이 곧 계약이다.
     *
     * @param migrationId 이관 회차
     * @return 기대 건수와 두 체크섬
     */
    @GetMapping("/manifest")
    public ResponseEntity<MigrationManifestResponse> manifest(@PathVariable String migrationId) {
        return ResponseEntity.ok(internalClickMigrationService.manifest(migrationId));
    }

    /**
     * 클릭 스냅샷 벌크 export — <b>{@code clickId} 오름차순</b>.
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 clickId
     * @param limit       최대 건수
     * @return 한 페이지
     */
    @GetMapping("/clicks")
    public ResponseEntity<FrozenPageResponse> exportClicks(
            @PathVariable String migrationId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(internalClickMigrationService.exportClicks(migrationId, cursor, limit));
    }

    /**
     * 호환 매치의 후보를 돌려준다 — read-only.
     *
     * @param migrationId 이관 회차
     * @param ipHash      {@code SHA-256(UTF8(ip + 기존 salt))}(ⓕ)
     * @param os          {@code ios} · {@code android} · {@code other}
     * @return 원본 + 체크섬 쌍
     */
    @GetMapping("/candidates")
    public ResponseEntity<List<FrozenClickCandidateResponse>> exportCandidates(
            @PathVariable String migrationId,
            @RequestParam String ipHash,
            @RequestParam String os) {
        return ResponseEntity.ok(
                internalClickMigrationService.exportCandidates(migrationId, ipHash, os));
    }

    /**
     * importer 쓰기를 닫는다 — 되돌리지 않는다(§7.2 5단계).
     *
     * @param migrationId 이관 회차
     */
    @PostMapping("/close-import")
    public ResponseEntity<Void> closeImport(@PathVariable String migrationId) {
        internalClickMigrationService.closeImport(migrationId);
        return ResponseEntity.ok().build();
    }
}
