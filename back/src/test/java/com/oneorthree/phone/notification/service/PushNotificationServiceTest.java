package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * 발송 공통 규칙 필터 체인 테스트 (GROMO-528 커밋③).
 * 선례: ScreenTimeServiceTest 의 @Mock ScreenTimeNotificationPort + verify(notificationPort).
 * Quiet hours 판정은 KST — 고정 Instant 주입으로 결정적 검증.
 */
@ExtendWith(MockitoExtension.class)
class PushNotificationServiceTest {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final PushMessage MESSAGE =
            new PushMessage("제목", "본문", "gromo://league", true);

    @Mock
    private PushNotificationPort pushNotificationPort;

    @InjectMocks
    private PushNotificationService pushNotificationService;

    // 발송이 허용되는(quiet hours 밖) 안전한 낮 시각 — 필터 1·2·4 테스트용.
    private static final Instant NOON_KST = kstInstant(LocalTime.of(12, 0));

    private static Instant kstInstant(LocalTime time) {
        return LocalDate.of(2026, 7, 6).atTime(time).atZone(KST).toInstant();
    }

    private static User userWithToken() {
        return User.builder().id(USER_ID).deviceToken("fcm-token").build();
    }

    // ── 필터 1·2: 알림 꺼짐 / 토큰 없음 ────────────────────────────────────────

    @Test
    @DisplayName("notificationEnabled=false → 미발송")
    void doesNotSendWhenNotificationDisabled() {
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID).notificationEnabled(false).build();

        pushNotificationService.sendIfAllowed(userWithToken(), settings, MESSAGE, NOON_KST);

        verify(pushNotificationPort, never()).send(any(), any());
    }

    @Test
    @DisplayName("deviceToken null → 미발송")
    void doesNotSendWhenDeviceTokenNull() {
        User user = User.builder().id(USER_ID).build(); // deviceToken null

        pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);

        verify(pushNotificationPort, never()).send(any(), any());
    }

    @Test
    @DisplayName("settings null(row 부재) → 기본값(알림 on)으로 발송됨")
    void sendsWithDefaultsWhenSettingsNull() {
        given(pushNotificationPort.send(any(), any())).willReturn(PushSendResult.SENT);

        pushNotificationService.sendIfAllowed(userWithToken(), null, MESSAGE, NOON_KST);

        verify(pushNotificationPort).send(eq("fcm-token"), eq(MESSAGE));
    }

    // ── 필터 3: Quiet hours 경계 (기본 21:00–09:00, [start, end)) ───────────────
    // sendIfAllowed 를 여러 시각으로 호출하고, 발송된 횟수로 경계를 검증한다.

    @Test
    @DisplayName("기본 구간 - 20:59 발송 / 21:00 스킵 / 08:59 스킵 / 09:00 발송 → 2회 발송")
    void defaultQuietHoursBoundaries() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);

        send(null, LocalTime.of(20, 59)); // 발송 (시작 직전)
        send(null, LocalTime.of(21, 0));  // 스킵 (시작 포함)
        send(null, LocalTime.of(8, 59));  // 스킵 (종료 직전)
        send(null, LocalTime.of(9, 0));   // 발송 (종료 미포함)

        verify(pushNotificationPort, times(2)).send(any(), any());
    }

    @Test
    @DisplayName("자정 걸침 커스텀 23:00–07:00 - 23:00·06:59 스킵 / 07:00·22:59 발송 → 2회 발송")
    void customOvernightQuietHoursBoundaries() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);
        UserNotificationSettings settings = nightSettings(LocalTime.of(23, 0), LocalTime.of(7, 0));

        send(settings, LocalTime.of(23, 0));  // 스킵
        send(settings, LocalTime.of(6, 59));  // 스킵
        send(settings, LocalTime.of(7, 0));   // 발송
        send(settings, LocalTime.of(22, 59)); // 발송

        verify(pushNotificationPort, times(2)).send(any(), any());
    }

    @Test
    @DisplayName("자정 안 걸침 커스텀 13:00–15:00 - 14:00 스킵 / 15:00 발송 → 1회 발송")
    void customDaytimeQuietHoursBoundaries() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);
        UserNotificationSettings settings = nightSettings(LocalTime.of(13, 0), LocalTime.of(15, 0));

        send(settings, LocalTime.of(14, 0)); // 스킵
        send(settings, LocalTime.of(15, 0)); // 발송

        verify(pushNotificationPort, times(1)).send(any(), any());
    }

    @Test
    @DisplayName("nightModeEnabled=true + 시각 null → 기본 21–09 적용 (21:30 스킵 / 12:00 발송)")
    void fallsBackToDefaultWhenNightModeOnButTimesNull() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID).nightModeEnabled(true).build(); // start/end null

        send(settings, LocalTime.of(21, 30)); // 스킵 (기본 구간)
        send(settings, LocalTime.of(12, 0));  // 발송

        verify(pushNotificationPort, times(1)).send(any(), any());
    }

    @Test
    @DisplayName("start == end → 빈 구간, 항상 발송 → 2회 발송")
    void alwaysSendsWhenStartEqualsEnd() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);
        UserNotificationSettings settings = nightSettings(LocalTime.of(22, 0), LocalTime.of(22, 0));

        send(settings, LocalTime.of(22, 0)); // 발송 (구간이 비어있음)
        send(settings, LocalTime.of(3, 0));  // 발송

        verify(pushNotificationPort, times(2)).send(any(), any());
    }

    // ── static isQuietHours 직접 경계 검증 (판정 로직 단위) ──────────────────────

    @Test
    @DisplayName("isQuietHours - 기본 구간 경계 직접 검증 (start 포함·end 미포함)")
    void isQuietHoursDefaultBoundariesDirect() {
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(21, 0)))).isTrue();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(8, 59)))).isTrue();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(9, 0)))).isFalse();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(20, 59)))).isFalse();
    }

    // ── 필터 4: 발송 결과 처리 ─────────────────────────────────────────────────

    @Test
    @DisplayName("포트 INVALID_TOKEN 반환 → user.deviceToken null 정리")
    void clearsTokenWhenPortReturnsInvalidToken() {
        User user = userWithToken();
        given(pushNotificationPort.send(any(), any())).willReturn(PushSendResult.INVALID_TOKEN);

        pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);

        assertThat(user.getDeviceToken()).isNull();
    }

    @Test
    @DisplayName("포트 예외 발생 → 전파 없이 정상 리턴 (로그만), 토큰 유지")
    void swallowsPortException() {
        User user = userWithToken();
        given(pushNotificationPort.send(any(), any()))
                .willThrow(new RuntimeException("FCM 통신 실패"));

        // 예외가 전파되지 않아야 함
        pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);

        verify(pushNotificationPort, times(1)).send(any(), any());
        assertThat(user.getDeviceToken()).isEqualTo("fcm-token"); // 정리 안 됨
    }

    // ── helpers ────────────────────────────────────────────────────────────

    private void send(UserNotificationSettings settings, LocalTime kstTime) {
        pushNotificationService.sendIfAllowed(userWithToken(), settings, MESSAGE, kstInstant(kstTime));
    }

    private static UserNotificationSettings nightSettings(LocalTime start, LocalTime end) {
        return UserNotificationSettings.builder()
                .userId(USER_ID)
                .nightModeEnabled(true)
                .nightStartTime(start)
                .nightEndTime(end)
                .build();
    }
}
