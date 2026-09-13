package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.FrozenPageResponse;
import com.oneorthree.phone.internal.service.InternalClickMigrationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 링크 원장의 정지 스냅샷 export — <b>서비스 전용</b> (A22 ㊏ · 서비스 §7.2).
 *
 * <h2>클릭 경로와 나눈 이유</h2>
 * 담는 집합이 다르다. 클릭 스냅샷은 «눌린 것»이고 이쪽은 <b>링크 원장 전부</b>다 — 클릭이 한 번도
 * 없던 slug 가 여기에만 있다. 그 slug 도 이미 공유돼 있어서, 원장을 안 옮기면 전환 직후 눌렸을 때
 * 링크 서버에 대상이 없어 실패한다(되돌릴 수 없는 실패다).
 *
 * <p>경로를 클릭 아래에 끼워 넣지 않은 것도 같은 이유다 — {@code …/invite-link-clicks/links} 는
 * 「클릭의 하위 자원」으로 읽히는데, 실제로는 클릭과 독립된 집합이다.
 */
@RestController
@RequestMapping("/internal/migrations/{migrationId}/invite-links")
@RequiredArgsConstructor
public class InternalMigrationLinkController {

    private final InternalClickMigrationService internalClickMigrationService;

    /**
     * 링크 스냅샷 벌크 export — <b>{@code linkId} 오름차순</b>.
     *
     * <p>순서가 곧 계약이다. 링크 서버의 최종 검증이 같은 순서로 모은 manifest 의 체크섬을 대조하므로,
     * 다른 순서로 주면 같은 행을 담고도 검증이 닫히지 않는다.
     *
     * @param migrationId 이관 회차
     * @param cursor      직전 페이지의 마지막 linkId
     * @param limit       최대 건수
     * @return 한 페이지
     */
    @GetMapping
    public ResponseEntity<FrozenPageResponse> exportLinks(
            @PathVariable String migrationId,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return ResponseEntity.ok(internalClickMigrationService.exportLinks(migrationId, cursor, limit));
    }
}
