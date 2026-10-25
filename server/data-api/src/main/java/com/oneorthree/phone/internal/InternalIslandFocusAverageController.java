package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.dto.IslandFocusAverageSnapshotView;
import com.oneorthree.phone.internal.service.IslandFocusAverageSnapshotService;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/**
 * 섬별 7일 평균 스냅샷의 운영자 수동 실행 (GROMO-2280) — 배포 직후나 07시 크론을 놓친 날 그날 행을 손으로 만든다.
 *
 * <p>caller 는 {@code ops} 하나다({@code SVC_TOKEN_OPS_TO_DATA}, 선택 caller — 토큰이 비면 경로만 있고 아무도 못 부른다).
 * 사용자 축이 아니라 {@code X-User-Id} 를 받지 않는다. 절차는 {@code docs/prd/fishcat/island-rankings/ops-runbook.md} §4.
 */
@RestController
@RequiredArgsConstructor
public class InternalIslandFocusAverageController {

    private final IslandFocusAverageSnapshotService snapshots;

    /**
     * {@code date} 의 스냅샷을 적는다 — 멱등이라 두 번 불러도 행이 늘지 않는다.
     *
     * <p>지난 날짜도 받는다. 다만 분모·모집단은 «지금» 기준이라 그날 07시 크론이 적었을 값과 다를 수 있다
     * ({@link IslandFocusAverageSnapshotService#snapshot}).
     *
     * @param date 적을 날짜(KST). 생략하면 가장 최근에 지난 07:00 KST 의 날짜다. 그보다 뒤면 400 — 덜 닫힌 창의 값이
     *             PK 에 박혀 그날 크론도 그날 잡지도 다시 적지 못한다
     */
    @PostMapping("/internal/admin/island-focus-averages/snapshots")
    public IslandFocusAverageSnapshotView snapshot(@RequestParam(required = false)
                                                   @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        LocalDate lastClosed = snapshots.lastClosedDate();
        LocalDate target = date != null ? date : lastClosed;
        if (target.isAfter(lastClosed)) {
            throw new IllegalArgumentException(
                    "07:00 KST 가 지나지 않은 날짜는 적지 않는다 date=" + target + " lastClosed=" + lastClosed);
        }
        return new IslandFocusAverageSnapshotView(target, snapshots.snapshot(target));
    }
}
