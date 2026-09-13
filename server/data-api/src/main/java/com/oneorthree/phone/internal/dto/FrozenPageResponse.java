package com.oneorthree.phone.internal.dto;

import java.util.List;

/**
 * 정지 스냅샷 벌크 export 한 페이지 (A22 ㋮ · ㊏).
 *
 * <p>커서는 <b>DB 의 uuid 오름차순</b>이다. 링크 서버의 최종 검증이 같은 순서로 모은 manifest 의
 * 체크섬을 대조하므로, 순서가 곧 계약이다 — 애플리케이션에서 {@code UUID.compareTo} 로 자르면
 * 그쪽은 부호 있는 long 비교라 상위 비트가 선 uuid 에서 DB 와 갈린다.
 *
 * @param items      이 페이지의 {@code {source, sourceChecksum}} 쌍들
 * @param nextCursor 다음 페이지 커서. {@code null} 이면 끝이다
 */
public record FrozenPageResponse(List<FrozenClickCandidateResponse> items, String nextCursor) {
}
