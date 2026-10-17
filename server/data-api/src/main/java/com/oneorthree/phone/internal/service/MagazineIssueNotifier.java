package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationFanOutUnit;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.notification.repository.domain.NotificationSendStatus;
import com.oneorthree.phone.notification.repository.domain.NotificationSentLog;
import com.oneorthree.phone.notification.service.PushNotificationService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 잡지 발행 뒤 앱 알림 (GROMO-2307) — 「오늘의 고양이 잡지가 왔어요」를 정식 계정 전원에게 한 번씩 펼친다.
 *
 * <h2>왜 발행과 한 트랜잭션이 아닌가</h2>
 * 발행은 «그날 첫 호출만 호를 돌려준다»(멱등)라 호가 커밋된 뒤 펼치다 죽으면 다음 틱이 그 호를 다시 알릴 방법이
 * 없다. 그래서 호 행의 {@code notified_at}(V126)이 NULL 인 동안 <b>틱마다</b> 이어서 펼치고, 끝까지 가면
 * 표시한다. 발행이 empty 여도 스케줄러가 부른다.
 *
 * <h2>중복은 두 겹으로 접는다</h2>
 * 이어 펼치면 앞 틱에 나간 계정이 다시 걸린다. OUTBOX 는 결정적 키
 * ({@code noti:MAGAZINE_PUBLISHED:<userId>:<issueId>:<KST 날짜>}), LEGACY 는 {@code notification_sent_logs}
 * 의 {@code (user_id, kind, subject_id=호 id)} <b>선점</b>이다 — 선례({@code InactiveReturnNotificationService})는
 * 중복 방지를 범위 밖으로 뒀지만 여기서는 중복 0 이 완료 조건이라 반대로 선점이 필수다.
 *
 * <p>LEGACY 는 쪽(200명) 단위 트랜잭션이다 — FCM 이 나간 뒤 그 쪽의 커밋이 실패하면 선점이 같이 되돌아가
 * 그 쪽이 한 번 더 나간다(ponytail: 계정마다 선점을 먼저 커밋하면 막히지만 FCM 왕복마다 트랜잭션 둘이 든다.
 * 커밋 실패는 드물어 감수 — 정확히 한 번이 필요해지면 선점을 따로 커밋한다).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MagazineIssueNotifier {

    /** 구 경로 제목 — 신 경로 템플릿({@code MAGAZINE_PUBLISHED.ko}, 알림 서버 V8)과 같은 문장이어야 한다. */
    static final String TITLE = "오늘의 고양이 잡지가 왔어요";
    /** 본문 앞뒤 — {@code 냐옹 {issueNo}호가 나왔어요 — 새 섬 소식을 확인해 보세요}. */
    static final String BODY_PREFIX = "냐옹 ";
    static final String BODY_SUFFIX = "호가 나왔어요 — 새 섬 소식을 확인해 보세요";
    static final String DEEP_LINK_PREFIX = "gromo://magazine?issue=";

    private static final UUID NIL = new UUID(0L, 0L);

    private final MagazineIssueRepository issues;
    private final UserRepository users;
    private final UserQueryService userQueryService;
    private final NotificationDispatcher dispatcher;
    private final NotificationSentLogRepository sentLogs;
    private final PushNotificationService pushNotificationService;
    private final PlatformTransactionManager transactionManager;

    /** 한 쪽 크기 — 테스트가 쪽 경계를 만들려고 줄인다. */
    int pageSize = 200;

    /**
     * 그날 호가 있고 아직 펼치지 않았으면 이어서 펼친다.
     *
     * @param issueDate 호의 KST 날짜
     * @param now       선점·표시 시각
     * @throws RuntimeException 중간 실패 — {@code notified_at} 은 NULL 로 남아 다음 틱이 이어 간다
     */
    public void notifyIfPending(LocalDate issueDate, Instant now) {
        MagazineIssue issue = issues.findByIssueDate(issueDate).orElse(null);
        if (issue == null || issue.getNotifiedAt() != null) {
            return;
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        UUID after = NIL;
        int total = 0;
        int failed = 0;
        while (true) {
            UUID cursor = after;
            Page page = transaction.execute(status -> processPage(issue, cursor, now));
            if (page.last() == null) {
                break;
            }
            if (!page.outbox().isEmpty()) {
                // 판정 트랜잭션 밖의 짧은 조각 — 수신자 잠금 순서를 fan-out 이 정본 순서로 잡는다(GROMO-893).
                dispatcher.writeFanOut(page.outbox(), NotificationFanOutUnit.RECIPIENT);
            }
            total += page.size();
            failed += page.failed();
            after = page.last();
        }
        if (failed > 0) {
            // 예외로 쪽 트랜잭션을 되돌리면 이미 나간 FCM 이 다음 틱에 중복된다 — 정상 반환하되 완료는 확정하지 않는다.
            log.warn("고양이 잡지 알림 일시 실패 — 실패 {}건 — 다음 틱 재시도 date={} issueNo={}", failed, issueDate,
                    issue.getIssueNo());
            return;
        }
        transaction.executeWithoutResult(status -> issues.markNotified(issue.getId(), now));
        log.info("고양이 잡지 알림 펼치기 완료 date={} issueNo={} 대상={}", issueDate, issue.getIssueNo(), total);
    }

    private Page processPage(MagazineIssue issue, UUID after, Instant now) {
        List<User> targets = users.findFormalUsersAfter(after, PageRequest.ofSize(pageSize));
        if (targets.isEmpty()) {
            return new Page(null, List.of(), 0, 0);
        }
        Map<UUID, UserNotificationSettings> settings = userQueryService
                .findAllNotificationSettings(targets.stream().map(User::getId).toList()).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
        boolean outboxMode = dispatcher.isOutboxMode();
        List<NotificationRequest> outbox = new ArrayList<>();
        List<UUID> sent = new ArrayList<>();
        List<UUID> unsent = new ArrayList<>();
        int failed = 0;
        for (User user : targets) {
            NotificationRequest request = requestOf(issue, user);
            if (outboxMode) {
                outbox.add(request);
                continue;
            }
            UUID claimId = UUID.randomUUID();
            if (sentLogs.insertPendingClaim(claimId, user.getId(), NotificationSentLog.TYPE_MAGAZINE_PUBLISHED,
                    issue.getId(), null, null, now) == 0) {
                continue; // 앞 틱에 이미 선점·발송된 계정
            }
            UserNotificationSettings own = settings.get(user.getId());
            PushMessage message = new PushMessage(TITLE, BODY_PREFIX + issue.getIssueNo() + BODY_SUFFIX,
                    DEEP_LINK_PREFIX + issue.getId(), own == null || own.isSoundEnabled(),
                    Map.of("type", NotificationSentLog.TYPE_MAGAZINE_PUBLISHED));
            // 필터에 걸리는 계정(토큰 없음·알림 끔·조용한 시간)은 영구 미발송이고, 안 걸렸는데 못 나갔으면 전송 오류다
            // (sendIfAllowed 는 타임아웃·서버 오류에서도 예외 대신 false 를 돌려준다).
            boolean filtered = pushNotificationService.isFilteredOut(user, own, now);
            if (dispatcher.dispatch(user, own, request, message, now).recordsLegacyLog()) {
                sent.add(claimId);
            } else {
                // 선점은 어느 쪽이든 지운다 — 남기면 «보냈다» 로 읽혀 다음 틱 재시도가 막힌다.
                unsent.add(claimId);
                if (!filtered) {
                    failed++;
                }
            }
        }
        if (!sent.isEmpty()) {
            sentLogs.updateStatusByIds(sent, NotificationSendStatus.SENT, now);
        }
        if (!unsent.isEmpty()) {
            sentLogs.deleteByIds(unsent);
        }
        return new Page(targets.get(targets.size() - 1).getId(), outbox, targets.size(), failed);
    }

    private static NotificationRequest requestOf(MagazineIssue issue, User user) {
        return new NotificationRequest(NotificationKind.MAGAZINE_PUBLISHED, user.getId(), issue.getId(), null,
                null, issue.getPublishedAt(), user.getLanguage(),
                Map.of("issueId", issue.getId().toString(), "issueNo", String.valueOf(issue.getIssueNo()),
                        "issueDate", issue.getIssueDate().toString()));
    }

    private record Page(UUID last, List<NotificationRequest> outbox, int size, int failed) {
    }
}
