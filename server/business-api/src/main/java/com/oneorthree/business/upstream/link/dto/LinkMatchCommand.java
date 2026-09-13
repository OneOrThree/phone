package com.oneorthree.business.upstream.link.dto;

import java.util.List;

/**
 * 클릭 소진(매치) 명령 — <b>쓰기이므로 원장은 Neon 하나뿐이다</b>(A22 ㊥).
 *
 * <p>매치는 읽기가 아니라 소진이다. 정지 창에도 구 DB 는 «후보 조회»만 하고, 양쪽에서 소진하면
 * 잠금이 공유되지 않아 같은 클릭이 두 기기에 배정된다.
 *
 * <p>{@code frozenCandidates} 는 §7.2 4단계의 이관 입력이다 — <b>import 계약이 준비된 뒤에만</b>
 * 채운다({@code business.compat.import-contract-ready}). 준비 전에 채워 보내면 링크 서버가 표시·체크섬·
 * 감사 레코드 없이 구 행을 받게 되고, 그건 임의 이중 소진이다.
 *
 * @param ipHash           {@code SHA-256(UTF8(ip + 기존 salt))} — salt 를 새로 만들면 매치가 전멸한다(ⓕ)
 * @param os               클릭의 os 와 일치해야 매치된다
 * @param deviceId         앱 device_id — 같은 값의 재시도는 같은 결과여야 한다(멱등)
 * @param appInstanceId    GA4 app_instance_id. 앱이 아직 못 받았으면 null
 * @param migrationId      이관 식별자. <b>import 계약 준비 전에는 null 이어야 한다</b> — 링크 서버는
 *                         이 필드가 «있으면» import 모드로 들어가 {@code openRun} 을 요구하고
 *                         ({@code link/src/lib/links.ts:104-113}) {@code IMPORT_CLOSED} 이후엔 503 을 준다.
 *                         빈 배열을 함께 보내도 마찬가지다 — 필드를 아예 생략해야 직접 매치 경로를 탄다
 * @param frozenCandidates 구 정지 스냅샷 행들({@code {source, sourceChecksum}} 래퍼, 최대 500건).
 *                         {@code migrationId} 가 null 이면 이 값도 null 이다
 */
public record LinkMatchCommand(
        String ipHash,
        String os,
        String deviceId,
        String appInstanceId,
        String migrationId,
        List<FrozenSource> frozenCandidates) {

    /**
     * 링크 서버가 받는 래퍼 — {@code migration.ts:98} 의 {@code {source, sourceChecksum}} 그대로다.
     *
     * <p>{@code source} 는 Data 가 만든 원본 JSON 을 <b>손대지 않고</b> 옮긴다. 필드를 풀어 다시
     * 조립하면 키 순서·null 표현 차이로 {@code SOURCE_CHECKSUM_MISMATCH} 가 난다.
     */
    public record FrozenSource(java.util.Map<String, Object> source, String sourceChecksum) {
    }
}
