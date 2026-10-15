package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.common.port.PushSendResult;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
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

    @Mock
    private UserRepository userRepository;

    @Mock
    private EntityManager entityManager;

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

    // ── 필터 3: Quiet hours 경계 (기본 23:00–07:00, [start, end)) ───────────────
    // sendIfAllowed 를 여러 시각으로 호출하고, 발송된 횟수로 경계를 검증한다.
    // 공격형 카탈로그(GROMO-819) 수용을 위해 기본 금지 구간을 21:00–09:00 → 23:00–07:00 으로 조정(GROMO-840).

    @Test
    @DisplayName("기본 구간 - 22:59 발송 / 23:00 스킵 / 06:59 스킵 / 07:00 발송 → 2회 발송")
    void defaultQuietHoursBoundaries() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);

        send(null, LocalTime.of(22, 59)); // 발송 (시작 직전)
        send(null, LocalTime.of(23, 0));  // 스킵 (시작 포함)
        send(null, LocalTime.of(6, 59));  // 스킵 (종료 직전)
        send(null, LocalTime.of(7, 0));   // 발송 (종료 미포함)

        verify(pushNotificationPort, times(2)).send(any(), any());
    }

    @Test
    @DisplayName("기본 구간 23:00–07:00 - 카탈로그 발송 시각 07:00·21:00·22:00 모두 허용")
    void catalogSendTimesAllowedUnderNewDefault() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);

        send(null, LocalTime.of(7, 0));  // 결과·새 리그 (GROMO-839)
        send(null, LocalTime.of(21, 0)); // 오늘 미집중 (GROMO-841)
        send(null, LocalTime.of(22, 0)); // 마감 2h 전 / 스트릭 위기 (GROMO-840/841)

        verify(pushNotificationPort, times(3)).send(any(), any());
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
    @DisplayName("nightModeEnabled=true + 시각 null → 기본 23–07 적용 (23:30 스킵 / 12:00 발송)")
    void fallsBackToDefaultWhenNightModeOnButTimesNull() {
        lenient().when(pushNotificationPort.send(any(), any())).thenReturn(PushSendResult.SENT);
        UserNotificationSettings settings = UserNotificationSettings.builder()
                .userId(USER_ID).nightModeEnabled(true).build(); // start/end null

        send(settings, LocalTime.of(23, 30)); // 스킵 (기본 구간)
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
    @DisplayName("isQuietHours - 기본 구간 23:00–07:00 경계 직접 검증 (start 포함·end 미포함)")
    void isQuietHoursDefaultBoundariesDirect() {
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(23, 0)))).isTrue();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(6, 59)))).isTrue();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(7, 0)))).isFalse();
        assertThat(PushNotificationService.isQuietHours(null, kstInstant(LocalTime.of(22, 59)))).isFalse();
    }

    // ── 필터 4: 발송 결과 처리 ─────────────────────────────────────────────────

    @Test
    @DisplayName("포트 INVALID_TOKEN 반환 → device_token 조건부 UPDATE 로 정리 (더티체킹 아님)")
    void clearsTokenWhenPortReturnsInvalidToken() {
        // 더티체킹으로 지우면 User 전체 컬럼 UPDATE 가 나가, 그사이 먼저 커밋된 탈퇴의 is_deleted·파기된
        // PII 를 옛 스냅샷이 되살린다(@codex 리뷰 P1). is_deleted=false 조건이 걸린 컬럼 UPDATE 를 쓴다.
        User user = userWithToken();
        given(pushNotificationPort.send(any(), any())).willReturn(PushSendResult.INVALID_TOKEN);

        boolean sent = pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);

        assertThat(sent).isFalse();
        // 보낸 토큰과 일치할 때만 지운다 — 응답 대기 중 새 토큰이 등록됐으면 그건 살려야 한다.
        verify(userRepository).clearDeviceToken(USER_ID, "fcm-token");
        // 인메모리도 맞추되 detach 뒤에 바꾼다(관리 상태로 바꾸면 전체 컬럼 UPDATE 가 되살아난다).
        verify(entityManager).detach(user);
        assertThat(user.getDeviceToken()).isNull();
    }

    @Test
    @DisplayName("같은 배치에서 토큰이 무효화된 유저는 다음 호출에서 필터 2 로 컷 — FCM 재호출 없음")
    void doesNotResendWithTokenInvalidatedEarlierInSameBatch() {
        User user = userWithToken();
        given(pushNotificationPort.send(any(), any())).willReturn(PushSendResult.INVALID_TOKEN);

        pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);
        pushNotificationService.sendIfAllowed(user, null, MESSAGE, NOON_KST);

        // 두 번째 호출은 토큰 없음(필터 2)에서 끊긴다 — 포트 호출은 1회뿐.
        verify(pushNotificationPort, times(1)).send(any(), any());
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
