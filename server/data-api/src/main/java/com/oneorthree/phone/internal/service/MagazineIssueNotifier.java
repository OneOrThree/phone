package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.magazine.support.MagazineCalendar;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationOutboxProducer;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 정식 계정에 잡지 발행 알림을 펼친다. 중간 실패 시 다음 틱이 결정적 키로 중복 없이 이어 간다. */
@Slf4j
@Service
@RequiredArgsConstructor
public class MagazineIssueNotifier {

    private static final UUID NIL = new UUID(0L, 0L);

    private final MagazineIssueRepository issues;
    private final UserRepository users;
    private final UserQueryService userQueryService;
    private final NotificationOutboxProducer producer;
    private final PlatformTransactionManager transactionManager;

    /** 한 쪽 크기 — 테스트가 쪽 경계를 만들려고 줄인다. */
    int pageSize = 200;

    /** 자정을 넘겨도 아직 유효한 미완료 호를 다시 찾는다. 완료 표시가 내구 재시도 기준이다. */
    public List<LocalDate> pendingIssueDates(Instant now) {
        return issues.findTop7ByOrderByIssueNoDesc().stream()
                .filter(issue -> issue.getNotifiedAt() == null && !issue.getPublishedAt().isAfter(now)
                        && now.isBefore(MagazineCalendar.currentUntil(issue.getIssueDate())))
                .map(MagazineIssue::getIssueDate).toList();
    }

    /** 수신자마다 독립 트랜잭션으로 적고, 전부 완료한 뒤 호에 완료 시각을 표시한다. */
    public Result notifyIfPending(LocalDate issueDate, Instant now) {
        MagazineIssue issue = issues.findByIssueDate(issueDate).orElse(null);
        if (issue == null || issue.getNotifiedAt() != null) {
            return Result.DONE;
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        UUID after = NIL;
        int total = 0;
        while (true) {
            // 페이지 조회 뒤 실제 기록할 때 사용자 상태를 잠가 다시 확인한다.
            List<User> targets = users.findFormalUsersAfter(after, PageRequest.ofSize(pageSize));
            if (targets.isEmpty()) {
                break;
            }
            for (User target : targets) {
                transaction.executeWithoutResult(status -> userQueryService.findActiveForShare(target.getId())
                        .filter(user -> !user.isGuest())
                        .ifPresent(user -> producer.appendAll(List.of(requestOf(issue, user)))));
            }
            total += targets.size();
            after = targets.get(targets.size() - 1).getId();
        }
        Integer marked = transaction.execute(status -> issues.markNotified(issue.getId(), now));
        if (marked != null && marked == 1) {
            // 겹친 틱에서는 먼저 확정한 쪽만 완료 로그를 남긴다(markNotified 가 0 을 돌려준다).
            log.info("고양이 잡지 알림 펼치기 완료 date={} issueNo={} 대상={}", issueDate, issue.getIssueNo(), total);
        }
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

    private static NotificationRequest requestOf(MagazineIssue issue, User user) {
        return new NotificationRequest(NotificationKind.MAGAZINE_PUBLISHED, user.getId(), issue.getId(),
                issue.getPublishedAt(), user.getLanguage(),
                Map.of("issueId", issue.getId().toString(), "issueNo", String.valueOf(issue.getIssueNo()),
                        "issueDate", issue.getIssueDate().toString()));
    }

}
