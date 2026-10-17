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

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * <h2>왜 사용자별 트랜잭션인가 (LEGACY)</h2>
 * 쪽 조회는 잠금 없이 id·언어만 읽고, 사용자마다 짧은 트랜잭션 하나에서 <b>그 사용자 행을 공유 잠금</b>으로 다시 읽은 뒤
 * (탈퇴·소프트 삭제면 건너뜀) 선점 → 필터 판정 → 발송 → 상태 갱신을 하고 커밋한다. 탈퇴
 * ({@code AccountWithdrawalService#withdraw}: 행 배타 잠금 → sent_log 삭제 → 소프트 삭제)와는 직렬화되어 탈퇴자의
 * 발송 이력이 되살아나지 않고, 잠금은 <b>한 사용자의 FCM 왕복 동안만</b> 잡혀 쪽 전체(200명)를 잠그던 때처럼 알림
 * 지연이 프로필 수정·접속 갱신 지연으로 번지지 않는다. 무효 토큰 정리의 더티체킹도 같은 트랜잭션의 managed User 로 한다.
 *
 * <p>ponytail: FCM 이 나간 뒤 그 한 사용자의 커밋이 실패하면 선점이 되돌아가 그 사용자만 한 번 더 나간다(드물어
 * 감수 — 정확히 한 번이 필요해지면 선점을 따로 커밋한다).
 *
 * <h2>선점 행의 종착</h2>
 * 나감 → {@code SENT}(sent_at). <b>필터로 폐기</b>(알림 끔·토큰 없음·조용한 시간) → 역시 {@code SENT}(sent_at 없음) —
 * DROP 정책이라 이월·재시도가 없어야 하고, 지우면 다른 사용자의 일시 실패로 다음 틱이 이어질 때 조용한 시간이 끝난 이 계정이
 * 뒤늦게 받는다. 이 enum 에 「폐기」 값이 없어 {@code consumeUnsentClaims} 의 「소비 확정」 선례를 따랐고, 이관 export 는
 * {@code SENT} 를 종결(재발송 안 함)로 읽는다. <b>전송 오류만</b> 선점을 지워 다음 틱이 재시도한다.
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
    private final Clock clock;

    /** 한 쪽 크기 — 테스트가 쪽 경계를 만들려고 줄인다. */
    int pageSize = 200;

    /**
     * 그날 호가 있고 아직 펼치지 않았으면 이어서 펼친다.
     *
     * @param issueDate 호의 KST 날짜
     * @param now       선점·표시 시각(조용한 시간 판정은 사용자마다 발송 직전 시계를 새로 읽는다)
     * <p>cron 이 10분이고 {@code lockAtMostFor} 가 PT9M 이라 펼치기가 9분을 넘기면 다음 틱과 겹칠 수 있다 — 선점·결정적 키가
     * 중복을 막고, 겹친 틱이 같은 사용자에서 서로 기다릴 수 있다. 한 호를 펼치는 중에는
     * {@code NOTIFICATION_DISPATCH_MODE} 를 바꾸지 않는다(두 경로의 중복 키가 달라 같은 호가 두 번 나간다).
     *
     * @return 완료(또는 할 일 없음)면 {@code complete=true}, 전송 오류가 남았으면 {@code false} 와 실패 수 — 로그·최종 신호는
     *         스케줄러가 그날 마지막 틱 여부로 정한다
     * @throws RuntimeException 중간 실패 — {@code notified_at} 은 NULL 로 남아 다음 틱이 이어 간다
     */
    public Result notifyIfPending(LocalDate issueDate, Instant now) {
        MagazineIssue issue = issues.findByIssueDate(issueDate).orElse(null);
        if (issue == null || issue.getNotifiedAt() != null) {
            return Result.DONE;
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        boolean outboxMode = dispatcher.isOutboxMode();
        UUID after = NIL;
        int total = 0;
        int failed = 0;
        while (true) {
            // 잠금 없는 조회 — id·언어만 쓴다. 사용자 행은 LEGACY 가 사용자별 트랜잭션에서 다시 잠가 읽는다.
            List<User> targets = users.findFormalUsersAfter(after, PageRequest.ofSize(pageSize));
            if (targets.isEmpty()) {
                break;
            }
            if (outboxMode) {
                // 요청 조립뿐이다 — 적는 쪽(writeFanOut)이 수신자 축을 정본 순서로 잠근다(GROMO-893).
                dispatcher.writeFanOut(targets.stream().map(user -> requestOf(issue, user)).toList(),
                        NotificationFanOutUnit.RECIPIENT);
            } else {
                Map<UUID, UserNotificationSettings> settings = userQueryService
                        .findAllNotificationSettings(targets.stream().map(User::getId).toList()).stream()
                        .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
                // 재시도 틱의 비용 — 이미 처리된 계정은 사용자 트랜잭션(공유 잠금 + 선점 시도)에 들이지 않는다.
                Set<UUID> handled = new HashSet<>(sentLogs.findUserIdsByKindAndSubjectIdIn(
                        NotificationSentLog.TYPE_MAGAZINE_PUBLISHED, issue.getId(),
                        targets.stream().map(User::getId).toList()));
                for (User target : targets) {
                    if (handled.contains(target.getId())) {
                        continue;
                    }
                    UserNotificationSettings own = settings.get(target.getId());
                    if (transaction.execute(status -> sendLegacy(issue, target.getId(), own, now)) == Outcome.FAILED) {
                        failed++;
                    }
                }
            }
            total += targets.size();
            after = targets.get(targets.size() - 1).getId();
        }
        if (failed > 0) {
            // 예외로 되돌리지 않고 정상 반환한다 — 이미 나간 FCM 은 되돌릴 수 없다. 완료는 확정하지 않는다.
            return new Result(false, failed);
        }
        transaction.executeWithoutResult(status -> issues.markNotified(issue.getId(), now));
        log.info("고양이 잡지 알림 펼치기 완료 date={} issueNo={} 대상={}", issueDate, issue.getIssueNo(), total);
        return Result.DONE;
    }

    /**
     * 펼치기 결과.
     *
     * @param complete 확정했거나 할 일이 없었다
     * @param failed   남은 전송 오류 수(complete 면 0)
     */
    public record Result(boolean complete, int failed) {
        static final Result DONE = new Result(true, 0);
    }

    /** 사용자 한 명의 LEGACY 발송 — 호출한 사용자별 트랜잭션 안에서 돈다. */
    private Outcome sendLegacy(MagazineIssue issue, UUID userId, UserNotificationSettings own, Instant now) {
        User user = userQueryService.findActiveForShare(userId).orElse(null);
        if (user == null) {
            log.debug("고양이 잡지 알림 생략 — 탈퇴한 수신자 userId={}", userId);
            return Outcome.SKIPPED;
        }
        UUID claimId = UUID.randomUUID();
        if (sentLogs.insertPendingClaim(claimId, userId, NotificationSentLog.TYPE_MAGAZINE_PUBLISHED,
                issue.getId(), null, null, now) == 0) {
            return Outcome.SKIPPED; // 앞 틱에 이미 선점·발송·폐기된 계정
        }
        PushMessage message = new PushMessage(TITLE, BODY_PREFIX + issue.getIssueNo() + BODY_SUFFIX,
                DEEP_LINK_PREFIX + issue.getId(), own == null || own.isSoundEnabled(),
                Map.of("type", NotificationSentLog.TYPE_MAGAZINE_PUBLISHED));
        // 필터에 걸리는 계정(토큰 없음·알림 끔·조용한 시간)은 영구 미발송이고, 안 걸렸는데 못 나갔으면 전송 오류다
        // (sendIfAllowed 는 타임아웃·서버 오류에서도 예외 대신 false 를 돌려준다).
        // 조용한 시간은 «발송 직전» 시각으로 본다 — 22:50 에 시작한 전수 발송이 FCM 지연으로 23:00 을 넘겨도 뒤쪽 사용자가
        // 조용한 시간을 통과하지 않게. 선점·기록 시각은 배치 시각(now)을 쓴다.
        Instant sendAt = clock.instant();
        boolean filtered = pushNotificationService.isFilteredOut(user, own, sendAt);
        if (dispatcher.dispatch(user, own, requestOf(issue, user), message, sendAt).recordsLegacyLog()) {
            sentLogs.updateStatusByIds(List.of(claimId), NotificationSendStatus.SENT, now);
            return Outcome.SENT;
        }
        if (filtered) {
            // 폐기도 종결로 남긴다(클래스 javadoc) — sent_at 은 비워 «보내지 않았다» 를 남긴다.
            sentLogs.updateStatusByIds(List.of(claimId), NotificationSendStatus.SENT, null);
            return Outcome.DROPPED;
        }
        sentLogs.deleteByIds(List.of(claimId)); // 전송 오류 — 선점을 지워 다음 틱이 재시도한다
        return Outcome.FAILED;
    }

    private static NotificationRequest requestOf(MagazineIssue issue, User user) {
        return new NotificationRequest(NotificationKind.MAGAZINE_PUBLISHED, user.getId(), issue.getId(), null,
                null, issue.getPublishedAt(), user.getLanguage(),
                Map.of("issueId", issue.getId().toString(), "issueNo", String.valueOf(issue.getIssueNo()),
                        "issueDate", issue.getIssueDate().toString()));
    }

    private enum Outcome { SENT, DROPPED, FAILED, SKIPPED }
}
