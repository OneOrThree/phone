package com.oneorthree.phone.focus.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 집중 보상 <b>분당 적립 크론</b>의 활성화 스위치 (GROMO-1990) — {@link FocusSessionStartGate} 와 같은 결의
 * 배포 설정이다({@code focus.reward.accrual-enabled}, 기본 {@code false}, dev·prod 는
 * {@code FOCUS_REWARD_ACCRUAL_ENABLED}). LLD §5.2 의 단계 활성화 표에 이 flag 가 한 줄로 들어간다.
 *
 * <h2>왜 크론만 게이트인가 — 혼합 버전 배포의 이중 지급</h2>
 * 롤링 배포로 옛 이미지와 새 이미지가 함께 도는 창에서는 <b>지급 주체가 둘</b>이 된다:
 * <ul>
 *   <li>새 이미지의 크론이 분마다 {@code focus:<세션>:<분>} 으로 넣고</li>
 *   <li>옛 이미지의 {@code finish} 는 적립 원장을 모른 채 세션 전체를 {@code focus:<세션>} 으로 다시 넣는다</li>
 * </ul>
 * 두 키는 접두사가 달라 {@code uq_island_wallet_tx_idem} 에도 걸리지 않는다 — 같은 시간이 두 번 지급된다.
 * 그래서 <b>크론은 기본으로 꺼져 있고</b>, 배포가 한 버전으로 수렴한 뒤에 켠다. 크론이 꺼져 있는 동안에도
 * 새 이미지의 {@code finish} 는 그 자리에서 적립을 한 번 돌려 정확한 양을 지급하므로(종료 직전에 찬 분이
 * 새지 않는다), 켜기 전이라고 사용자가 손해를 보지 않는다 — 세션당 지급은 어느 이미지에서든 한 번뿐이다.
 *
 * <h2>롤백 차단 조건</h2>
 * <b>이 스위치를 켠 뒤에는 옛 이미지로 되돌리지 않는다.</b> 켜진 동안 크론이 이미 분 단위로 지급한 세션을
 * 옛 이미지의 {@code finish} 가 세션 전체로 다시 지급하기 때문이다(키가 달라 막히지 않는다). 되돌려야 하면
 * <b>스위치를 먼저 끄고</b>, 그때 진행 중이던 세션이 전부 끝난 뒤에 이미지를 내린다 — LLD §5.2 의
 * 「비호환 구 이미지로 복귀 금지」와 같은 규율이고, 여기서는 «flag 를 먼저 닫는다»가 그 앞에 붙는다.
 */
@Component
public class FocusRewardAccrualGate {

    private final boolean enabled;

    public FocusRewardAccrualGate(@Value("${focus.reward.accrual-enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    /**
     * @return 분당 적립 크론이 돌아도 되는가 — 배포 설정 그대로다. 꺼져 있으면 적립은 {@code finish} 가
     *         한 번에 확정한다
     */
    public boolean isOpen() {
        return enabled;
    }
}
