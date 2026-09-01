package com.oneorthree.phone.common.port;

import java.util.UUID;

/**
 * 스크린타임 목표 결과 알림 포트 — {@code common/port} 에 두어 <b>도메인 간 순환 의존을 끊는다</b>.
 * 스크린타임 도메인이 알림 도메인을 직접 참조하면 두 패키지가 서로를 부르게 되므로,
 * 호출측은 이 인터페이스만 알고 실제 구현은 밖에서 꽂는다.
 *
 * <p>현재 유일한 구현은 {@link NoOpScreenTimeNotification} 이라 실제 발송은 일어나지 않는다.
 */
public interface ScreenTimeNotificationPort {
    /**
     * @param userId 알림을 받을 유저
     * @param goalAchieved true = 목표 달성, false = 미달. 문구가 갈리는 유일한 축이다
     */
    void notify(UUID userId, boolean goalAchieved);
}
