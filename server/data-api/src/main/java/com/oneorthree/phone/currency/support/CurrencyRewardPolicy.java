package com.oneorthree.phone.currency.support;

/**
 * 재화 지급 금액 공식(동결) — 순수 정적 계산.
 *
 * <p>모든 서버 권위(server-authoritative) 지급의 금액을 이 클래스에서만 계산한다. 사유별 매직넘버
 * (코인 환산율·구간 경계·티어 보너스)를 한곳에 모아, 실제 지급 호출부(FocusService·ScreenTimeService·
 * LeagueBatchService)는 사유와 입력만 넘기고 금액 산정은 이 공식에 위임한다.
 *
 * <p>상태가 없으므로 {@code static} 메서드만 노출하고 인스턴스화를 막는다.
 */
public final class CurrencyRewardPolicy {

    private CurrencyRewardPolicy() {
    }

    /**
     * 집중 목표 달성 보상 — 목표 1시간당 +10, 8시간(+80)부터 동결.
     *
     * <p>티어 = clamp(floor(goalMinutes / 60), 1, 8), 지급 = 티어 × 10.
     * 부분 시간 목표는 <b>내림(floor)</b>으로 보수적으로 처리한다(명세가 정시간만 예시라 내림을 택함):
     * 90분→floor 1→+10, 120분→+20, 480분(8h)→+80, 600분→캡 +80, 30분→floor 0→clamp 1→+10.
     *
     * @param goalMinutes 하루 집중 목표 분(0 이하는 0)
     * @return 지급 코인
     */
    public static int focusGoalReward(int goalMinutes) {
        if (goalMinutes <= 0) {
            return 0;
        }
        // floor(분/60) = 목표 시간 수, 1~8시간으로 클램프해 +10/시간 (8시간부터 +80 동결)
        int tier = Math.min(8, Math.max(1, goalMinutes / 60));
        return tier * 10;
    }

    /**
     * 스크린타임 목표 달성 보상 — 사용 상한(limit)이 낮을수록 +10씩 커진다(1h 이하 +80 ~ 7h 초과 +10).
     *
     * <p>구간(각 구간의 상한 분은 해당 구간에 포함): ≤60→+80, ≤120→+70, ≤180→+60, ≤240→+50,
     * ≤300→+40, ≤360→+30, ≤420→+20, &gt;420→+10.
     *
     * @param limitMinutes 스크린타임 사용 상한(분)
     * @return 지급 코인
     */
    public static int screenTimeGoalReward(int limitMinutes) {
        // 상한이 빡셀수록(낮을수록) 보상 큼 — 낮은 경계부터 순차 판정(경계 분은 아래 구간에 귀속)
        if (limitMinutes <= 60) {
            return 80;
        }
        if (limitMinutes <= 120) {
            return 70;
        }
        if (limitMinutes <= 180) {
            return 60;
        }
        if (limitMinutes <= 240) {
            return 50;
        }
        if (limitMinutes <= 300) {
            return 40;
        }
        if (limitMinutes <= 360) {
            return 30;
        }
        if (limitMinutes <= 420) {
            return 20;
        }
        return 10;
    }

    /**
     * 리그 승급 보너스 — 승급한 티어 레벨별 고정 지급.
     *
     * <p>tier 2(예열)→+50, 3(초집중)→+100, 4(갓생러)→+200, 5(정복자)→+500, 그 외(1 포함)→0.
     *
     * @param tierLevel 승급 후 티어 레벨(1~5)
     * @return 지급 코인
     */
    public static int leaguePromotionReward(int tierLevel) {
        // 상위 티어일수록 승급 보너스 가중 — 첫 티어(1)와 범위 밖은 보너스 없음
        return switch (tierLevel) {
            case 2 -> 50;
            case 3 -> 100;
            case 4 -> 200;
            case 5 -> 500;
            default -> 0;
        };
    }
}
