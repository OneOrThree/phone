package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.notification.producer.NotificationDispatcher;
import com.oneorthree.phone.notification.producer.NotificationFanOutUnit;
import com.oneorthree.phone.notification.producer.NotificationKind;
import com.oneorthree.phone.notification.producer.NotificationRequest;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 미접속 복귀 푸시 트리거 (GROMO-578) — apns.md §3 ④.
 * last_active_at 기준 D+3/7/14 정확히 N일째 유저에게 단계별 문구로 발송(escalation).
 * 매일 10:00 KST 배치(NotificationScheduler)·수동 트리거(NotificationBatchController)가 진입점.
 * <p>발송 파이프라인은 528 을 재사용 — settings 일괄 로드(findAllById) 후 sendIfAllowed 로 위임.
 * <p>재접속 리셋: last_active_at 가 최신화되면 자연히 3/7/14 경계를 벗어나 대상에서 빠진다(별도 카운터 불필요).
 * 14일 초과는 대상 아님(중단).
 * <p>⚠️ Dedup 은 이번 스코프 제외 — 각 단계는 KST 하루 경계라 정상 1일 1회 배치에선 유저당 최대 1회 발송이지만,
 * 같은 날 재트리거 시 중복 발송될 수 있다(운영 주의). 발송 이력 기반 dedup 은 후속 티켓.
 * <p>⚠️ Known limitation — 배치 실패 시 유실(catch-up 없음): 각 단계는 "오늘 기준 정확히 N일째"라는
 * 단일 KST 날짜 창만 조회한다. 장애·배포로 그날 배치가 못 돌면 그 D+3/7/14 창에 걸린 유저는
 * 다음 날 창이 하루 밀려 소급 발송 없이 영구 스킵된다(리텐션 발송이 조용히 샐 수 있음).
 * 배치 성공/실패·발송 건수 모니터링(알림·대시보드) 없이는 유실을 인지하기 어렵다.
 * 소급이 필요하면 창을 [오늘−N, 오늘) 처럼 넓히거나 last_notified 이력 기반 catch-up 을 후속으로 도입.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class InactiveReturnNotificationService {

    /**
     * last_active_at date diff 판정 타임존 고정 — 리그 도메인과 통일.
     * ⚠️ UserActivityService 는 더 이상 KST 를 쓰지 않는다 (GROMO-903) — 활동 갱신 스로틀이 달력 하루에서
     * 슬라이딩 창으로 바뀌어, last_active_at 은 실제 마지막 활동보다 최대 app.user-activity.touch-interval
     * 만큼 과거일 수 있다. 자정 직후 그 창 안에 그날 첫 활동을 한 유저는 여기서 한 단계 이르게 판정된다.
     * 날짜 경계를 정하는 책임은 이제 이 클래스 단독이다 — 비-KR 유저에게 KST 고정이 부정확한 문제(발송 시각
     * 포함)는 GROMO-564(리그 마감 비KR 타임존)와 같은 부류로, 존 정책은 후속 티켓에서 함께 다룬다.
     */
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository userRepository;
    private final UserQueryService userQueryService;
    private final PushNotificationService pushNotificationService;
    private final NotificationDispatcher notificationDispatcher;

    /** 스케줄러(매일 10:00 KST)·수동 트리거 진입점. */
    public void sendInactiveReturnNotifications() {
        sendInactiveReturnNotifications(Instant.now());
    }

    /**
     * 미접속 복귀 푸시 본체. Instant 주입 오버로드 = 고정 시각 테스트용(LeagueNotificationService 선례).
     *
     * @param now "정확히 N일째"를 세는 기준 시각. KST 날짜로 환산해 비교하므로 한 유저는
     *            D+3·7·14 중 한 단계에만 들어간다. 발송 이력을 남기지 않아 같은 날 다시
     *            부르면 중복 발송된다
     */
    public void sendInactiveReturnNotifications(Instant now) {
        LocalDate today = now.atZone(KST).toLocalDate();

        // 단계별 대상 유저 수집 — 유저당 정확히 한 단계에만 든다(date diff 는 단일 값).
        List<Target> targets = new ArrayList<>();
        for (ReturnStage stage : ReturnStage.values()) {
            // 정확히 N일째 = last_active_at 의 KST 날짜가 (오늘 − N일)인 유저
            // → [오늘−N일 00:00 KST, 오늘−(N−1)일 00:00 KST) 반열림 구간.
            Instant startInclusive = today.minusDays(stage.days).atStartOfDay(KST).toInstant();
            Instant endExclusive = today.minusDays(stage.days - 1L).atStartOfDay(KST).toInstant();
            for (User user : userRepository.findInactiveReturnTargets(startInclusive, endExclusive)) {
                targets.add(new Target(user, stage));
            }
        }
        if (targets.isEmpty()) {
            log.info("미접속 복귀 푸시 — 대상 없음 (today={})", today);
            return;
        }

        // 설정 일괄 로드 — 유저별 단건 조회 N+1 금지 (row 부재 유저는 Map 에 없음 = sendIfAllowed 가 기본값 취급)
        Map<UUID, UserNotificationSettings> settingsByUserId = userQueryService
                .findAllNotificationSettings(targets.stream().map(t -> t.user().getId()).toList()).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));

        List<NotificationRequest> outbox = new ArrayList<>();
        for (Target target : targets) {
            User user = target.user();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            // 신 경로가 싣는 것은 단계(D3·D7·D14)뿐이다 — 세 단계의 문구는 kind x locale 템플릿이 갖는다.
            NotificationRequest request = new NotificationRequest(NotificationKind.INACTIVE_RETURN, user.getId(),
                    null, null, null, now, user.getLanguage(), Map.of("stage", target.stage().name()));
            if (notificationDispatcher.isOutboxMode()) {
                outbox.add(request);
            } else {
                notificationDispatcher.dispatch(user, settings, request, target.stage().compose(soundEnabled), now);
            }
        }
        // 신 경로는 D3·D7·D14 를 이어 붙인 대상 전체를 판정 트랜잭션 밖의 짧은 조각으로 적는다(GROMO-893) —
        // 단계 순서 그대로 한 트랜잭션에서 잠그면 정렬이 없는 수신자 순서가 그대로 잠금 순서가 된다.
        if (!outbox.isEmpty()) {
            notificationDispatcher.writeFanOut(outbox, NotificationFanOutUnit.RECIPIENT);
        }
        log.info("미접속 복귀 푸시 — 대상 {}건 처리 완료 (today={})", targets.size(), today);
    }

    private record Target(User user, ReturnStage stage) {
    }

    /**
     * 복귀 유도 단계 정의 (apns.md §3-④ — 카피 변경 시 apns.md 와 함께 수정).
     * 딥링크는 세 단계 모두 홈(gromo://home).
     */
    private enum ReturnStage {
        D3(3, "요즘 안 보이네",
                "방이 좀 허전해. 잠깐 들러서 얼굴만 보여줄래?"),
        D7(7, "벌써 일주일째야",
                "네가 모은 코인이랑 방, 그대로 기다리고 있어. 5분만 같이 집중할까?"),
        D14(14, "처음 그 마음, 기억나?",
                "네가 직접 정한 목표가 아직 그대로 남아있어. 초심으로 딱 한 번만 다시 시작해보자.");

        private static final String LINK = "gromo://home";

        private final int days;
        private final String title;
        private final String body;

        ReturnStage(int days, String title, String body) {
            this.days = days;
            this.title = title;
            this.body = body;
        }

        private PushMessage compose(boolean soundEnabled) {
            return new PushMessage(title, body, LINK, soundEnabled);
        }
    }
}
