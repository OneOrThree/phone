package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
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
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class InactiveReturnNotificationService {

    // last_active_at date diff 판정 타임존 고정 — UserActivityService·리그 도메인과 통일.
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final PushNotificationService pushNotificationService;

    /** 스케줄러(매일 10:00 KST)·수동 트리거 진입점. */
    public void sendInactiveReturnNotifications() {
        sendInactiveReturnNotifications(Instant.now());
    }

    /**
     * 미접속 복귀 푸시 본체. Instant 주입 오버로드 = 고정 시각 테스트용(LeagueNotificationService 선례).
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
        Map<UUID, UserNotificationSettings> settingsByUserId = userNotificationSettingsRepository
                .findAllById(targets.stream().map(t -> t.user().getId()).toList()).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));

        for (Target target : targets) {
            User user = target.user();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(user, settings, target.stage().compose(soundEnabled), now);
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
