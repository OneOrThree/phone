package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
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
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 주간 정산 결과와 리그 마감 임박 푸시를 발송한다. */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class LeagueNotificationService {

    private static final int GLOBAL_POPULATION_LIMIT = Integer.MAX_VALUE;

    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;

    /** 승격/강등 알림 — 스케줄러(월 09:00 KST)·수동 트리거 진입점. */
    public void sendWeeklyResultNotifications() {
        sendWeeklyResultNotifications(Instant.now());
    }

    /** 직전 주차에 확정된 승격/강등 결과를 기준으로 알림을 발송한다. */
    public void sendWeeklyResultNotifications(Instant now) {
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);
        List<LeagueWeeklyResult> results = leagueWeeklyResultRepository.findByWeekStartAtAndResultIn(
                previousWeekStart,
                List.of(LeagueWeeklyResultType.PROMOTED, LeagueWeeklyResultType.RELEGATED));
        if (results.isEmpty()) {
            log.info("주간 리그 결과 알림 — 대상 없음 (previousWeekStart={})", previousWeekStart);
            return;
        }

        List<UUID> userIds = results.stream().map(result -> result.getUser().getId()).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (LeagueWeeklyResult result : results) {
            User user = usersById.get(result.getUser().getId());
            if (user == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = result.getResult() == LeagueWeeklyResultType.PROMOTED
                    ? composePromotion(result.getPreviousTierLevel(), result.getNewTierLevel(), soundEnabled)
                    : composeRelegation(result.getPreviousTierLevel(), result.getNewTierLevel(), soundEnabled);
            pushNotificationService.sendIfAllowed(user, settings, message, now);
            processedCount++;
        }
        log.info("주간 리그 결과 알림 — 대상 {}건 처리 완료 (previousWeekStart={})",
                processedCount, previousWeekStart);
    }

    /** 리그 마감 임박 알림 — 스케줄러(일 20:00 KST)·수동 트리거 진입점. */
    public void sendDeadlineReminders() {
        sendDeadlineReminders(Instant.now());
    }

    /** 이번 주 전역 랭킹의 모든 활성 사용자에게 현재 전역 순위를 포함해 발송한다. */
    public void sendDeadlineReminders(Instant now) {
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate toDate = leagueWeek.currentDate(now);
        List<LeagueRankingRow> ranking = leagueRankingQueryRepository.findTop(
                fromDate, toDate, null, GLOBAL_POPULATION_LIMIT);
        if (ranking.isEmpty()) {
            log.info("리그 마감 임박 알림 — 전역 랭킹 대상 없음");
            return;
        }

        List<UUID> userIds = ranking.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (int index = 0; index < ranking.size(); index++) {
            UUID userId = ranking.get(index).userId();
            User user = usersById.get(userId);
            if (user == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(userId);
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(user, settings, composeDeadline(index + 1, soundEnabled), now);
            processedCount++;
        }
        log.info("리그 마감 임박 알림 — 전역 대상 {}건 처리 완료", processedCount);
    }

    private Map<UUID, User> loadUsers(Collection<UUID> userIds) {
        return userRepository.findAllByIdInAndIsDeletedFalse(userIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
    }

    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    private PushMessage composePromotion(int previousTierLevel, int newTierLevel, boolean soundEnabled) {
        String previousTier = tierDisplayName(previousTierLevel);
        String newTier = tierDisplayName(newTierLevel);
        return new PushMessage(
                "🎉 우리 승격했어 !",
                "이번 주 몰입으로 " + previousTier + " 리그에서 " + newTier
                        + " 리그에 올라갔어. 새 순위 보러 올래?",
                "gromo://league",
                soundEnabled);
    }

    private PushMessage composeRelegation(int previousTierLevel, int newTierLevel, boolean soundEnabled) {
        String previousTier = tierDisplayName(previousTierLevel);
        String newTier = tierDisplayName(newTierLevel);
        return new PushMessage(
                "저번 주 리그가 종료되었어요!",
                "저번 주 " + previousTier + " 리그에서 이번 주 " + newTier
                        + " 리그로 이동했어요. 조금 더 힘내봐요!",
                "gromo://focus",
                soundEnabled);
    }

    private PushMessage composeDeadline(int rank, boolean soundEnabled) {
        return new PushMessage(
                "리그 마감까지 4시간!",
                "지금 " + rank + "위야. 마지막 스퍼트 한 번 어때?",
                "gromo://league",
                soundEnabled);
    }

    private static String tierDisplayName(int tierLevel) {
        String[] tierNames = {"뽀시래기", "예열 모드", "초집중 모드", "갓생러", "집중 정복자"};
        int clamped = Math.max(1, Math.min(tierNames.length, tierLevel));
        return tierNames[clamped - 1];
    }
}
