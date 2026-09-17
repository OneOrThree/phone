package com.oneorthree.phone.focus.support;

/**
 * 집중 세션 보상 지급 게이트 (GROMO-1764) — FR-D01~06(산식·fish 신설 여부·건설 기여 분배 등)이
 * 전부 미결이라 항상 닫혀 있다.
 *
 * <p>{@code policy.md}: "실제 돈을 움직이는 기능을 '일단 0원 지급'으로 성공 처리하면 원래 받아야
 * 할 보상을 영구 잃을 수 있으므로, 정책이 없을 때 성공 정산 receipt를 만들지 않는다." 그래서
 * {@code finish}는 이 게이트가 닫혀 있으면 세션을 완료 처리하지 않고 실패로 응답한다 — earnedFish를
 * 0으로 채워 "성공"을 위장하지 않는다.
 *
 * <p>지금 시스템에 {@code fish} 통화 자체가 없다(CurrencyTransactionType에 없음). 이 게이트가 열려도
 * 산식·통화 신설 여부가 정해지기 전에는 {@code CurrencyLedgerService.credit}를 부르는 코드를
 * 만들지 않는다 — 값을 지어내지 않는다.
 *
 * <p>순수 상수 판정이라 {@code support/}다(주입 없음, 단위 테스트에 스프링 컨텍스트가 필요 없다).
 * FR-D01~06이 확정되면 이 상수를 여는 것이 활성화 스위치가 된다.
 */
public final class FocusRewardPolicyGate {

    private FocusRewardPolicyGate() {
    }

    /**
     * @return 보상 지급 경로가 열려 있는가. FR-D01~06 결정 전까지 항상 {@code false}다.
     */
    public static boolean isOpen() {
        return false;
    }
}
