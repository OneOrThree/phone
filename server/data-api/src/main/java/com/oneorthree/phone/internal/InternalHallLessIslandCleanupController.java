package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.HallLessIslandCleanupView;
import com.oneorthree.phone.internal.service.HallLessIslandCleanupService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 마을회관 없는 섬 일회성 정리 (GROMO-2763) — 운영자 명령.
 *
 * <p>caller 는 {@code ops} 하나다({@code SVC_TOKEN_OPS_TO_DATA}, 선택 caller — 토큰이 비면 경로만 있고 아무도 못 부른다).
 * 사용자 축이 아니라 {@code X-User-Id} 를 받지 않는다. 절차는 {@code docs/prd/fishcat/island-membership/hall-less-island-cleanup.md}.
 */
@RestController
@RequiredArgsConstructor
public class InternalHallLessIslandCleanupController {

    private final HallLessIslandCleanupService cleanup;

    /**
     * @param dryRun 생략하면 {@code true} — 세기만 한다. 정리는 {@code dryRun=false} 를 적었을 때만 한다
     */
    @PostMapping("/internal/admin/hall-less-islands/cleanup")
    public HallLessIslandCleanupView cleanup(@RequestParam(defaultValue = "true") boolean dryRun) {
        return dryRun ? cleanup.dryRun() : cleanup.execute();
    }
}
