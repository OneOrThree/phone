package com.oneorthree.phone.notification.service;

import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * 발송 공통 규칙 필터 체인 테스트 (GROMO-528 커밋③).
 * 선례: ScreenTimeServiceTest 의 @Mock ScreenTimeNotificationPort + verify(notificationPort).
 */
@ExtendWith(MockitoExtension.class)
class PushNotificationServiceTest {

    // TODO GROMO-528 커밋③: @Mock PushNotificationPort + @InjectMocks PushNotificationService

    // TODO GROMO-528 커밋③: 케이스 목록 (스펙 테스트 절)
    //   - notificationEnabled=false → verify(port, never()).send(...)
    //   - deviceToken null → 미발송
    //   - settings null(row 부재) → 기본값으로 발송됨
    //   - Quiet hours 경계(기본 21–09): 20:59 발송 / 21:00 스킵 / 08:59 스킵 / 09:00 발송
    //   - 자정 걸침 커스텀 구간(23:00–07:00): 23:00 스킵 / 06:59 스킵 / 07:00 발송 / 22:59 발송
    //   - 걸치지 않는 커스텀 구간(13:00–15:00): 14:00 스킵 / 15:00 발송
    //   - nightModeEnabled=true + 시각 null → 기본 21–09 적용
    //   - start == end → 항상 발송 (빈 구간)
    //   - 포트가 INVALID_TOKEN 반환 → user.getDeviceToken() null 확인
    //   - 포트 예외 발생 → 예외 전파 없이 정상 리턴 (로그만)
    //   ※ Quiet hours 판정은 KST — 고정 Instant 주입으로 결정적 검증
}
