package com.oneorthree.phone.internal;

import com.oneorthree.phone.internal.service.MagazineIssueNotifier;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.notification.producer.NotificationSlotGranularity;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.util.AopTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doCallRealMethod;

/** 잡지 발행 알림 — outbox(GROMO-2307): 결정적 키가 중복을 접는다. */
@SpringBootTest
class MagazineIssueNotifierOutboxIntegrationTest extends MagazineIssueNotifierTestBase {

    @MockitoSpyBean
    NotificationOutboxProducer producer;
    @Autowired
    MagazineIssueRepository issueRepository;
    @Autowired
    PlatformTransactionManager transactionManager;

    private int deliveryRows() {
        return jdbc.queryForObject("SELECT count(*) FROM event_outbox_deliveries", Integer.class);
    }

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
        doCallRealMethod().doCallRealMethod().doThrow(new IllegalStateException("수신자 실패")).doCallRealMethod()
                .when(AopTestUtils.<NotificationOutboxProducer>getUltimateTargetObject(producer)).appendAll(any());

        assertThatThrownBy(() -> notifier.notifyIfPending(DATE, NOW)).isInstanceOf(IllegalStateException.class);
        assertThat(notifiedAt()).isNull();
        assertThat(eventIds()).hasSize(2);

        notifier.notifyIfPending(DATE, NOW.plusSeconds(600));
        assertThat(eventIds()).hasSize(5).doesNotHaveDuplicates();
        assertThat(notifiedAt()).isEqualTo(NOW.plusSeconds(600));
    }

    @Test
    @DisplayName("markNotified 는 한 번만 쓴다 — 두 번째는 0 이고 값이 덮이지 않는다")
    void markNotifiedIsIdempotent() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        int first = tx.execute(status -> issueRepository.markNotified(issueId, NOW));
        assertThat(first).isEqualTo(1);
        int second = tx.execute(status -> issueRepository.markNotified(issueId, NOW.plusSeconds(60)));
        assertThat(second).isZero();
        assertThat(notifiedAt()).isEqualTo(NOW);
    }

    @Test
    @DisplayName("겹친 틱 — 둘째가 NULL 로 읽은 뒤 첫 틱이 먼저 확정해도 0 을 받고 정상 반환하며 값은 덮이지 않는다")
    void overlappingTickDoesNotOverwriteTheFirstConfirmation() {
        usersFor(2);
        Instant first = NOW.minusSeconds(30);
        // 이 틱이 notified_at 을 NULL 로 읽고 펼치는 사이 다른 틱이 먼저 확정한다.
        doAnswer(invocation -> {
            jdbc.update("UPDATE magazine_issues SET notified_at = ?", java.sql.Timestamp.from(first));
            return invocation.callRealMethod();
        }).when(AopTestUtils.<NotificationOutboxProducer>getUltimateTargetObject(producer)).appendAll(any());

        MagazineIssueNotifier.Result result = notifier.notifyIfPending(DATE, NOW);

        assertThat(result.complete()).isTrue();
        assertThat(notifiedAt()).isEqualTo(first);
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
