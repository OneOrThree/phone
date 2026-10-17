package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.port.PushNotificationPort;
import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import com.oneorthree.phone.common.port.PushSendResult;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.time.Clock;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 잡지 알림 LEGACY 끝에서 끝까지 — 실제 {@code PushNotificationService} 필터, FCM 포트만 목(GROMO-2307). */
@SpringBootTest(properties = "notification.dispatch.mode=LEGACY")
class MagazineIssueNotifierRealPushIntegrationTest extends MagazineIssueNotifierTestBase {

    @MockitoBean
    PushNotificationPort fcm;
    @MockitoBean
    Clock clock;
    @Autowired
    UserNotificationSettingsRepository settingsRepository;

    @Test
    @DisplayName("토큰 있음은 FCM 으로 나가고, 알림 끔·토큰 없음은 FCM 없이 종결 선점(sent_at 없음)으로 남는다")
    void filtersRunForRealAndOnlyTheEligibleAccountReachesFcm() {
        when(clock.instant()).thenReturn(NOW); // 07:05 KST — 조용한 시간 밖
        when(fcm.send(any(), any())).thenReturn(PushSendResult.SENT);
        User sendable = users.save(User.builder().nickname("가-" + UUID.randomUUID()).deviceToken("token-a").build());
        User off = users.save(User.builder().nickname("나-" + UUID.randomUUID()).deviceToken("token-b").build());
        users.save(User.builder().nickname("다-" + UUID.randomUUID()).build()); // 토큰 없음
        settingsRepository.save(UserNotificationSettings.builder().userId(off.getId()).notificationEnabled(false).build());

        MagazineIssueNotifier.Result result = notifier.notifyIfPending(DATE, NOW);

        assertThat(result.complete()).isTrue();
        verify(fcm, times(1)).send(eq("token-a"), any());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notification_sent_logs WHERE kind = 'MAGAZINE_PUBLISHED'"
                + " AND status = 'SENT' AND sent_at IS NOT NULL AND user_id = ?", Integer.class, sendable.getId()))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notification_sent_logs WHERE kind = 'MAGAZINE_PUBLISHED'"
                + " AND status = 'SENT' AND sent_at IS NULL", Integer.class)).isEqualTo(2);
        assertThat(notifiedAt()).isEqualTo(NOW);
    }
}
