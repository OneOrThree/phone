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
 * <p>이 판정을 따르는 자리는 셋이다 — 위의 집중 종료, 매분 적립({@code FocusRewardAccrualService.accrue} — 스케줄러와
 * 종료 직전 확정이 모두 이 한 곳을 지난다), 황금 물고기 추첨({@code GoldenFishService.drawAndCredit} 의 참여자 확정).
 * 바다 세션은 셋 어디서도 섬 통장에 들어가지 않는다.
 *
 * <p><b>E1-1(바다 세션)이 세션 kind 로 교체한다</b> — 바다 세션을 만드는 쪽이 {@code focus_session_details} 에
 * 종류를 남기고, 이 메서드가 그 값을 읽어 돌려주면 된다. <b>E1-1 이 정할 것 하나가 남았다</b>: 최초 낚시(튜토리얼)
 * 보상({@code FocusTutorialRewardService.claim}, 섬 통장 +1)은 아직 이 판정을 모른다 — 「바다에서의 첫 낚시도 같은
 * 뜻인가」가 제품 판단이라 건드리지 않았다. 바다 세션이 실제로 열리기 전에 그 답을 정해 반영해야 한다.
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
