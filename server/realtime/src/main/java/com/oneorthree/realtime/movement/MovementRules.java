package com.oneorthree.realtime.movement;

/**
 * 이동 규칙 상수 묶음 — 레코드로 둬 테스트가 다른 값을 만들어 쓸 수 있게 한다(예: 한 틱에 waypoint
 * 여러 개를 지나는 경로를 만들려면 {@code tickMs} 를 크게 둔 인스턴스가 필요하다). 운영 코드는
 * {@link #DEFAULT} 하나만 쓴다.
 *
 * @param tickMs           틱 간격(ms) — 서버 이동 시뮬레이션의 심장박동(계약 §0).
 * @param speed            이동 속도(world unit/s) — 앱 {@code MS_PER_UNIT=91} 과 같은 속도(N12).
 * @param collisionRadius  충돌 반경(world unit, HLD) — 1단계 로직은 쓰지 않지만 규칙값으로 둔다.
 * @param navRevision      고정 nav 버전(N11) — intent 의 navRevision 이 다르면 거절한다.
 * @param mapKey           이 방이 쓰는 지도 식별자 — 1단계는 지도가 하나뿐이라 고정값.
 * @param maxIntentsPerSec 사용자당 intent 토큰 버킷 충전 속도(policy §3, N8).
 * @param intentBurst      토큰 버킷 최대 용량(policy §3, N8).
 * @param arriveEpsilon    부동소수 오차로 세그먼트 끝에 못 미처 멈추지 않게 하는 도착 허용치.
 */
public record MovementRules(
        long tickMs,
        double speed,
        double collisionRadius,
        int navRevision,
        String mapKey,
        int maxIntentsPerSec,
        int intentBurst,
        double arriveEpsilon) {

    /** 운영 기본값. */
    public static final MovementRules DEFAULT =
            new MovementRules(50, 1000.0 / 91.0, 0.5, 1, "home-v1", 10, 20, 1e-6);

    /** 틱당 전진 거리(world unit) = speed(unit/s) × tickMs(ms) / 1000. */
    public double stepPerTick() {
        return speed * tickMs / 1000.0;
    }

    /** 주어진 밀리초가 이 규칙의 틱 수로 몇 틱인지 — 퇴장 위치 기억 10분 창(N23) 계산용. */
    public long ticksFor(long millis) {
        return millis / tickMs;
    }
}
