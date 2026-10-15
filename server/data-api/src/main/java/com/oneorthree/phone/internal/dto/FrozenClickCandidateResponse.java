package com.oneorthree.phone.internal.dto;

import java.util.Map;

/**
 * 구 {@code invite_link_clicks} 정지 스냅샷 한 건 — <b>read-only export</b> (서비스 §7.2 · A22 ㊥ · ㋮).
 *
 * <h2>왜 「원본 + 체크섬」 래퍼인가</h2>
 * 링크 서버의 importer 가 받는 것이 정확히 이 모양이기 때문이다({@code migration.ts} 의
 * {@code importClick(tx, id, frozen(entry.source), entry.sourceChecksum)}). 필드를 풀어서 주면 받는
 * 쪽이 다시 조립해야 하고, <b>조립 순서 하나가 어긋나면 체크섬이 달라져</b> 이관 당일에 전량
 * {@code SOURCE_CHECKSUM_MISMATCH} 로 막힌다.
 *
 * <h2>받는 쪽은 이 후보를 소진하지 않는다</h2>
 * 매치는 읽기가 아니라 <b>소진(쓰기)</b> 이고, 정지 창에도 쓰기 원장은 Neon 하나다(㊥) — 양쪽에서
 * 소진하면 잠금이 공유되지 않아 같은 클릭이 두 기기에 배정된다.
 *
 * @param source         정규화된 원본 24필드. 키 순서까지 체크섬의 입력이다
 * @param sourceChecksum {@code SHA-256(canonicalJson(source))} — 링크 쪽 {@code checksum()} 과 같은 규칙
 */
public record FrozenClickCandidateResponse(Map<String, Object> source, String sourceChecksum) {
}
