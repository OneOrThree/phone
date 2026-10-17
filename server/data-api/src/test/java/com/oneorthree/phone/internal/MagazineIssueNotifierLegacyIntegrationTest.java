package com.oneorthree.phone.internal;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.notification.service.PushNotificationService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.util.List;
import java.util.UUID;


import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 잡지 발행 알림 — LEGACY 모드(GROMO-2307, dev·prod 기본): sent_log 선점이 중복을 접는다. */
@SpringBootTest(properties = "notification.dispatch.mode=LEGACY")
class MagazineIssueNotifierLegacyIntegrationTest extends MagazineIssueNotifierTestBase {

    @MockitoBean
    PushNotificationService push;

    private int sentLogs() {
        return jdbc.queryForObject(
                "SELECT count(*) FROM notification_sent_logs WHERE kind = 'MAGAZINE_PUBLISHED' AND subject_id = ?"
                        + " AND status = 'SENT'", Integer.class, issueId);
    }

    @Test
    @DisplayName("발행 틱 — 정식 계정마다 sendIfAllowed 1회(게스트·탈퇴 0)·sent_log 1행, 문구·링크·data.type")
    void sendsOncePerFormalAccount() {
        usersFor(5);
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);

        notifier.notifyIfPending(DATE, NOW);

        ArgumentCaptor<PushMessage> message = ArgumentCaptor.forClass(PushMessage.class);
        verify(push, times(5)).sendIfAllowed(any(), any(), message.capture(), any());
        assertThat(message.getAllValues()).allSatisfy(sent -> {
            assertThat(sent.title()).isEqualTo("오늘의 고양이 잡지가 왔어요");
            assertThat(sent.body()).isEqualTo("냐옹 7호가 나왔어요 — 새 섬 소식을 확인해 보세요");
            assertThat(sent.toDataPayload()).containsEntry("link", "gromo://magazine?issue=" + issueId)
                    .containsEntry("type", "MAGAZINE_PUBLISHED");
        });
        assertThat(sentLogs()).isEqualTo(5);
        assertThat(notifiedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("같은 날 두 번째 틱은 0건 — 표시를 지워 다시 펼쳐도 선점이 접는다")
    void secondTickAddsNothing() {
        usersFor(3);
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        notifier.notifyIfPending(DATE, NOW);
        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        verify(push, times(3)).sendIfAllowed(any(), any(), any(), any());
        assertThat(notifiedAt()).isEqualTo(NOW);

        jdbc.update("UPDATE magazine_issues SET notified_at = NULL");
        notifier.notifyIfPending(DATE, NOW.plusSeconds(1200));
        verify(push, times(3)).sendIfAllowed(any(), any(), any(), any());
        assertThat(sentLogs()).isEqualTo(3);
    }

    @Test
    @DisplayName("두 번째 쪽에서 예외 — notified_at 은 NULL, 다음 틱이 나머지만 보내고 중복 0")
    void failureOnSecondPageResumesWithoutDuplicates() {
        usersFor(5);
        when(push.sendIfAllowed(any(), any(), any(), any()))
                .thenReturn(true, true)
                .thenThrow(new IllegalStateException("쪽 실패"))
                .thenReturn(true);

        assertThatThrownBy(() -> notifier.notifyIfPending(DATE, NOW)).isInstanceOf(IllegalStateException.class);
        assertThat(notifiedAt()).isNull();
        assertThat(sentLogs()).isEqualTo(2); // 첫 쪽만 커밋 — 실패한 쪽의 선점은 같이 되돌아갔다

        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        // 첫 실행 3번(성공 2 + 예외 1) + 이어서 3번(첫 쪽은 선점에 막혀 건너뜀) — 계정마다 성공은 정확히 한 번
        verify(push, times(6)).sendIfAllowed(any(), any(), any(), any());
        assertThat(sentLogs()).isEqualTo(5);
        assertThat(notifiedAt()).isEqualTo(NOW.plusSeconds(600));
    }

    @Test
    @DisplayName("필터로 폐기한 계정(토큰 없음 등)은 종결 상태 선점(sent_at 없음) 1행을 남기고 다시 시도하지 않는다")
    void filteredAccountLeavesATerminalClaimAndIsNotRetried() {
        usersFor(2);
        when(push.isFilteredOut(any(), any(), any())).thenReturn(true); // 토큰 없음·알림 끔 — 영구 미발송
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(false);
        notifier.notifyIfPending(DATE, NOW);
        assertThat(notifiedAt()).isEqualTo(NOW); // 영구 미발송만 있으면 완료로 확정한다
        assertThat(jdbc.queryForObject("SELECT count(*) FROM notification_sent_logs WHERE kind = 'MAGAZINE_PUBLISHED'"
                + " AND status = 'SENT' AND sent_at IS NULL", Integer.class)).isEqualTo(2);

        jdbc.update("UPDATE magazine_issues SET notified_at = NULL");
        clearInvocations(push);
        when(push.isFilteredOut(any(), any(), any())).thenReturn(false); // 조용한 시간이 끝났다
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        verify(push, never()).sendIfAllowed(any(), any(), any(), any());
    }

    @Test
    @DisplayName("A 필터 + B 일시 실패 — 다음 틱에 B 만 다시 보내고 A 는 조용한 시간이 끝나도 안 나간다")
    void filteredAccountStaysDroppedWhileAnotherAccountIsRetried() {
        List<UUID> ids = usersFor(2);
        UUID dropped = ids.get(0);
        UUID flaky = ids.get(1);
        when(push.isFilteredOut(argThat(user -> user != null && user.getId().equals(dropped)), any(), any())).thenReturn(true);
        when(push.sendIfAllowed(argThat(user -> user != null && user.getId().equals(dropped)), any(), any(), any()))
                .thenReturn(false);
        when(push.sendIfAllowed(argThat(user -> user != null && user.getId().equals(flaky)), any(), any(), any()))
                .thenReturn(false, true);

        notifier.notifyIfPending(DATE, NOW);
        assertThat(notifiedAt()).isNull();

        when(push.isFilteredOut(any(), any(), any())).thenReturn(false); // A 의 조용한 시간이 끝났다
        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        assertThat(notifiedAt()).isEqualTo(NOW.plusSeconds(600));
        verify(push, times(2)).sendIfAllowed(argThat(user -> user != null && user.getId().equals(flaky)), any(), any(), any());
        verify(push, times(1)).sendIfAllowed(argThat(user -> user != null && user.getId().equals(dropped)), any(), any(), any());
    }

    @Test
    @DisplayName("일시적 전송 실패(적격인데 false) — notified_at 은 NULL 로 남고, 다음 틱이 그 계정만 다시 보내 성공하면 확정")
    void transientFailureIsRetriedOnTheNextTick() {
        usersFor(3);
        when(push.isFilteredOut(any(), any(), any())).thenReturn(false);
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(true, false, true);

        notifier.notifyIfPending(DATE, NOW); // 예외 없이 정상 반환

        assertThat(notifiedAt()).isNull();
        assertThat(sentLogs()).isEqualTo(2);
        when(push.sendIfAllowed(any(), any(), any(), any())).thenReturn(true);
        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        // 앞 틱에 나간 둘은 선점에 막히고 실패한 한 명만 다시 시도된다 — 3 + 1 번
        verify(push, times(4)).sendIfAllowed(any(), any(), any(), any());
        assertThat(sentLogs()).isEqualTo(3);
        assertThat(notifiedAt()).isEqualTo(NOW.plusSeconds(600));
    }

    @Test
    @DisplayName("호가 없으면(발행 스위치 꺼짐) 아무 일도 없다")
    void noIssueNoNotification() {
        usersFor(2);
        jdbc.execute("TRUNCATE magazine_issues CASCADE");
        notifier.notifyIfPending(DATE, NOW);
        verify(push, never()).sendIfAllowed(any(), any(), any(), any());
    }
}
