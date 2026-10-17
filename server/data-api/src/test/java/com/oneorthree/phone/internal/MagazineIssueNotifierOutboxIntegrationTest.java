package com.oneorthree.phone.internal;

import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationFanOutUnit;
import com.oneorthree.phone.notification.producer.NotificationSlotGranularity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doCallRealMethod;
import static org.mockito.Mockito.doThrow;

/** 잡지 발행 알림 — OUTBOX 모드(GROMO-2307): 결정적 키가 중복을 접는다. */
@SpringBootTest(properties = "notification.dispatch.mode=OUTBOX")
class MagazineIssueNotifierOutboxIntegrationTest extends MagazineIssueNotifierTestBase {

    @MockitoSpyBean
    NotificationDispatcher dispatcher;

    private List<String> eventIds() {
        return jdbc.queryForList("SELECT event_id FROM event_outbox WHERE event_id LIKE 'noti:MAGAZINE_PUBLISHED:%'",
                String.class);
    }

    @Test
    @DisplayName("발행 틱 — 정식 계정마다 키 noti:MAGAZINE_PUBLISHED:<userId>:<issueId>:<KST 날짜> 한 행(게스트·탈퇴 0), notified_at 표시")
    void spreadsOneEventPerFormalAccount() {
        List<UUID> formal = usersFor(5);

        notifier.notifyIfPending(DATE, NOW);

        String day = NotificationSlotGranularity.DAY.bucketOf(PUBLISHED_AT);
        assertThat(eventIds()).containsExactlyInAnyOrderElementsOf(
                formal.stream().map(id -> "noti:MAGAZINE_PUBLISHED:" + id + ":" + issueId + ":" + day).toList());
        assertThat(notifiedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("같은 날 두 번째 틱은 0건이고 notified_at 은 그대로다 — 표시를 지워 다시 펼쳐도 키가 접는다")
    void secondTickAddsNothing() {
        usersFor(3);
        notifier.notifyIfPending(DATE, NOW);
        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        assertThat(eventIds()).hasSize(3);
        assertThat(notifiedAt()).isEqualTo(NOW);

        jdbc.update("UPDATE magazine_issues SET notified_at = NULL");
        notifier.notifyIfPending(DATE, NOW.plusSeconds(1200));
        assertThat(eventIds()).hasSize(3);
    }

    @Test
    @DisplayName("두 번째 쪽에서 예외 — notified_at 은 NULL, 다음 틱이 나머지만 적고 중복 0")
    void failureOnSecondPageResumesWithoutDuplicates() {
        usersFor(5);
        doCallRealMethod().doThrow(new IllegalStateException("쪽 실패")).doCallRealMethod()
                .when(dispatcher).writeFanOut(any(), eq(NotificationFanOutUnit.RECIPIENT));

        assertThatThrownBy(() -> notifier.notifyIfPending(DATE, NOW)).isInstanceOf(IllegalStateException.class);
        assertThat(notifiedAt()).isNull();
        assertThat(eventIds()).hasSize(2);

        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        assertThat(eventIds()).hasSize(5).doesNotHaveDuplicates();
        assertThat(notifiedAt()).isEqualTo(NOW.plusSeconds(600));
    }

    @Test
    @DisplayName("호가 없으면(발행 스위치 꺼짐) 아무 일도 없다")
    void noIssueNoNotification() {
        usersFor(2);
        jdbc.execute("TRUNCATE magazine_issues CASCADE");
        notifier.notifyIfPending(DATE, NOW);
        assertThat(eventIds()).isEmpty();
    }
}
