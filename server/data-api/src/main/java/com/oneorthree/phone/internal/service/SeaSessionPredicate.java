package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.focus.repository.domain.FocusSessionDetail;
import org.springframework.stereotype.Component;

/**
 * 「이 세션이 바다 집중인가」를 판정하는 <b>seam</b> (GROMO-2274, 결정 N3) — 지금은 서버에 바다 집중 세션이 없어
 * 늘 {@code false} 다.
 *
 * <p>집중 종료({@code FocusSessionLifecycleService.settle})는 이 판정이 {@code true} 면 섬 통장 적립 대신
 * 바다 누적 엔진({@code SeaFocusRewardService})으로 정산하고, 응답({@code FocusFinishView})의 {@code seaReward}
 * 를 채운다. {@code false} 면 종전 섬 세션 경로가 그대로 돈다.
 *
 * <p><b>E1-1(바다 세션)이 세션 kind 로 교체한다</b> — 바다 세션을 만드는 쪽이 {@code focus_session_details} 에
 * 종류를 남기고, 이 메서드가 그 값을 읽어 돌려주면 된다. 그 변경이 닿는 자리는 이 클래스 한 곳이 아니다
 * ({@code FocusSessionLifecycleService.settle} 은 이미 이 판정을 따르지만, 같은 세션을 «진행 중에» 섬 통장에
 * 적립하는 매분 크론·황금 물고기 추첨·최초 낚시 보상은 아직 이 판정을 모른다) — 바다 세션이 실제로 열리기 전에
 * 각 자리가 이 판정을 따르게 해야 한다.
 */
@Component
public class SeaSessionPredicate {

    /**
     * @param detail 정산하려는 세션의 상세
     * @return 바다 집중이면 {@code true}. 지금은 늘 {@code false}
     */
    public boolean isSea(FocusSessionDetail detail) {
        return false;
    }
}
