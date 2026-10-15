package com.oneorthree.phone.internal.dto;

/**
 * 이관 회차의 <b>manifest</b> — 링크 서버의 최종 검증이 닫히려면 이 넷이 필요하다 (A22 ㋮ · ㊏).
 *
 * <p>importer 는 배치마다 <b>같은 manifest 전체</b>를 실어 보내고, 링크 서버는 첫 배치에서 이 값으로
 * {@code migration_runs} 를 열어 둔 뒤 이후 배치가 같은 값인지 대조한다({@code MANIFEST_CHANGED}).
 * 그래서 이 값은 <b>스냅샷을 뜬 순간에 확정</b>돼야 한다 — 요청마다 다시 세면 그 사이 들어온 행이
 * 섞여, 이미 시작한 import 가 통째로 막힌다.
 *
 * @param migrationId    이관 회차
 * @param expectedClicks 스냅샷의 클릭 수
 * @param sourceChecksum {@code [{clickId, sourceChecksum}]}(clickId 오름차순)의 canonical JSON SHA-256
 * @param expectedLinks  스냅샷의 링크 수 — <b>클릭이 없는 slug 도 포함</b>한다
 * @param linkChecksum   {@code [{linkId, sourceChecksum}]}(linkId 오름차순)의 canonical JSON SHA-256
 * @param importClosed   {@code IMPORT_CLOSED} 로 넘어갔는가 — 늦은 백필을 거부하는 상태다
 */
public record MigrationManifestResponse(
        String migrationId,
        int expectedClicks,
        String sourceChecksum,
        int expectedLinks,
        String linkChecksum,
        boolean importClosed) {
}
