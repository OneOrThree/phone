package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueRankingRow;
import com.oneorthree.phone.league.domain.LeagueTierConfig;
import com.oneorthree.phone.league.domain.LeagueWeeklyResult;
import com.oneorthree.phone.league.domain.LeagueWeeklyResultType;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.repository.LeagueTierConfigRepository;
import com.oneorthree.phone.league.repository.LeagueWeeklyResultRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import com.oneorthree.phone.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
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
@Transactional(isolation = Isolation.REPEATABLE_READ)
public class LeagueNotificationService {

    static final int NOTIFICATION_PAGE_SIZE = 200;

    /** 결과 발표 대상 — 정산된 전원(승격·강등·잔류). */
    private static final List<LeagueWeeklyResultType> WEEKLY_RESULT_TYPES = List.of(
            LeagueWeeklyResultType.PROMOTED,
            LeagueWeeklyResultType.STAY,
            LeagueWeeklyResultType.RELEGATED);

    /** 최하위 티어 — 강등 대상이 아니므로 강등 경고 발송에서 제외한다. */
    private static final int MIN_TIER_LEVEL = 1;

    /** 최상위 티어 — 승급 대상이 아니므로 마감 D-1(승급 독려) 발송에서 제외한다. */
    private static final int MAX_TIER_LEVEL = 5;

    private final LeagueWeeklyResultRepository leagueWeeklyResultRepository;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueTierConfigRepository leagueTierConfigRepository;
    private final UserRepository userRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final PushNotificationService pushNotificationService;
    private final LeagueWeek leagueWeek;
    private final EntityManager entityManager;

    /** 승격/강등 알림 — 스케줄러(월 09:00 KST)·수동 트리거 진입점. */
    public void sendWeeklyResultNotifications() {
        sendWeeklyResultNotifications(Instant.now());
    }

    /** 직전 주차에 확정된 승격/강등/잔류 결과 전원을 기준으로 알림을 발송한다. */
    public void sendWeeklyResultNotifications(Instant now) {
        Instant previousWeekStart = leagueWeek.previousWeekStart(now);
        // STAY 포함으로 대상이 정산된 전원(대다수 잔류)이라, 전체를 한 번에 로드하지 않고 id keyset 으로
        // 페이지를 끊어 조회한다 — 초기 조회·1차 캐시가 유저 수에 비례해 커지지 않도록.
        Pageable pageLimit = PageRequest.ofSize(NOTIFICATION_PAGE_SIZE);
        int processedCount = 0;
        UUID cursorId = null;
        while (true) {
            List<LeagueWeeklyResult> page = leagueWeeklyResultRepository.findResultPageAfter(
                    previousWeekStart, WEEKLY_RESULT_TYPES, cursorId, pageLimit);
            if (page.isEmpty()) {
                break;
            }
            boolean hasMore = page.size() == NOTIFICATION_PAGE_SIZE;
            UUID nextCursor = page.get(page.size() - 1).getId();
            processedCount += sendWeeklyResultPage(page, now);
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            cursorId = nextCursor;
        }
        if (processedCount == 0) {
            log.info("주간 리그 결과 알림 — 대상 없음 (previousWeekStart={})", previousWeekStart);
            return;
        }
        log.info("주간 리그 결과 알림 — 대상 {}건 처리 완료 (previousWeekStart={})",
                processedCount, previousWeekStart);
    }

    private int sendWeeklyResultPage(List<LeagueWeeklyResult> page, Instant now) {
        List<UUID> userIds = page.stream().map(result -> result.getUser().getId()).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (LeagueWeeklyResult result : page) {
            User user = usersById.get(result.getUser().getId());
            if (user == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = switch (result.getResult()) {
                case PROMOTED ->
                    composePromotion(result.getPreviousTierLevel(), result.getNewTierLevel(), soundEnabled);
                case RELEGATED ->
                    composeRelegation(result.getPreviousTierLevel(), result.getNewTierLevel(), soundEnabled);
                case STAY -> composeNewLeagueStart(soundEnabled);
            };
            pushNotificationService.sendIfAllowed(user, settings, message, now);
            processedCount++;
        }
        return processedCount;
    }

    /** 리그 마감 임박 알림 — 스케줄러(일 20:00 KST)·수동 트리거 진입점. */
    public void sendDeadlineReminders() {
        sendDeadlineReminders(Instant.now());
    }

    /** 이번 주 전역 랭킹의 모든 활성 사용자에게 현재 전역 순위를 포함해 마감 4시간 전 알림을 발송한다. */
    public void sendDeadlineReminders(Instant now) {
        sendDeadlineSequence(now, "마감 4시간 전", this::composeDeadline);
    }

    /** 마감 2시간 전 알림 — 스케줄러(일 22:00 KST)·수동 트리거 진입점. 진행 중 전원. */
    public void sendFinalDeadlineReminders() {
        sendFinalDeadlineReminders(Instant.now());
    }

    public void sendFinalDeadlineReminders(Instant now) {
        sendDeadlineSequence(now, "마감 2시간 전", this::composeFinalDeadline);
    }

    /** 전역 랭킹을 keyset 페이지로 순회하며 각 유저의 현재 순위로 마감 시퀀스 알림을 발송한다. */
    private void sendDeadlineSequence(Instant now, String label, DeadlineMessageComposer composer) {
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate toDate = leagueWeek.currentDate(now);
        int processedCount = 0;
        int rankOffset = 0;
        Integer cursorFocusSeconds = null;
        UUID cursorUserId = null;
        while (true) {
            List<LeagueRankingRow> fetched = leagueRankingQueryRepository.findGlobalRankingPage(
                    fromDate, toDate, cursorFocusSeconds, cursorUserId, NOTIFICATION_PAGE_SIZE + 1);
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > NOTIFICATION_PAGE_SIZE;
            List<LeagueRankingRow> page = hasMore
                    ? fetched.subList(0, NOTIFICATION_PAGE_SIZE) : fetched;
            processedCount += sendDeadlinePage(page, rankOffset, now, composer);
            rankOffset += page.size();
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            LeagueRankingRow lastRow = page.get(page.size() - 1);
            cursorFocusSeconds = lastRow.totalFocusSeconds();
            cursorUserId = lastRow.userId();
        }
        if (processedCount == 0) {
            log.info("리그 {} 알림 — 전역 랭킹 대상 없음", label);
            return;
        }
        log.info("리그 {} 알림 — 전역 대상 {}건 처리 완료", label, processedCount);
    }

    /** 강등 경고 + 마감 D-1 — 스케줄러(일 09:00 KST)·수동 트리거 진입점. 유저당 1건 분기(강등 경고 우선). */
    public void sendSundayCrisisReminders() {
        sendSundayCrisisReminders(Instant.now());
    }

    public void sendSundayCrisisReminders(Instant now) {
        sendCrisisReminders(now, true);
    }

    /** 강등 경고 재발송 — 스케줄러(일 18:00 KST)·수동 트리거 진입점. 강등 위험군만 손실회피 강화(마감 D-1 제외). */
    public void sendRelegationWarnings() {
        sendRelegationWarnings(Instant.now());
    }

    public void sendRelegationWarnings(Instant now) {
        sendCrisisReminders(now, false);
    }

    private void sendCrisisReminders(Instant now, boolean includeDeadlineDMinusOne) {
        Map<Integer, LeagueTierConfig> tierConfigs = loadTierConfigs();
        LocalDate fromDate = leagueWeek.currentWeekStartDate(now);
        LocalDate toDate = leagueWeek.currentDate(now);
        int processedCount = 0;
        Integer cursorFocusSeconds = null;
        UUID cursorUserId = null;
        while (true) {
            List<LeagueRankingRow> fetched = leagueRankingQueryRepository.findGlobalRankingPage(
                    fromDate, toDate, cursorFocusSeconds, cursorUserId, NOTIFICATION_PAGE_SIZE + 1);
            if (fetched.isEmpty()) {
                break;
            }
            boolean hasMore = fetched.size() > NOTIFICATION_PAGE_SIZE;
            List<LeagueRankingRow> page = hasMore
                    ? fetched.subList(0, NOTIFICATION_PAGE_SIZE) : fetched;
            processedCount += sendCrisisPage(page, tierConfigs, includeDeadlineDMinusOne, now);
            entityManager.flush();
            entityManager.clear();
            if (!hasMore) {
                break;
            }
            LeagueRankingRow lastRow = page.get(page.size() - 1);
            cursorFocusSeconds = lastRow.totalFocusSeconds();
            cursorUserId = lastRow.userId();
        }
        if (processedCount == 0) {
            log.info("리그 위기 알림 — 대상 없음 (includeDMinusOne={})", includeDeadlineDMinusOne);
            return;
        }
        log.info("리그 위기 알림 — 대상 {}건 처리 완료 (includeDMinusOne={})",
                processedCount, includeDeadlineDMinusOne);
    }

    /**
     * soft-delete 된 설정을 제외하고 티어 1~5 설정을 모두 확보한다.
     * 개수뿐 아니라 각 티어의 존재까지 검증한다 — 삭제된 T5 + 오활성 티어6처럼 개수는 5여도
     * 특정 티어가 비면 그 티어 유저의 위기 알림이 config == null 로 조용히 스킵되기 때문이다.
     * 불완전하면 예외로 드러낸다 (LeagueBatchService.loadTierConfigs 와 동일 정책).
     */
    private Map<Integer, LeagueTierConfig> loadTierConfigs() {
        Map<Integer, LeagueTierConfig> tierConfigs = leagueTierConfigRepository.findAll().stream()
                .filter(config -> config.getDeletedAt() == null)
                .collect(Collectors.toMap(LeagueTierConfig::getTierLevel, Function.identity()));
        if (tierConfigs.size() != MAX_TIER_LEVEL) {
            throw new IllegalStateException(
                    "리그 티어 설정이 불완전합니다 (활성 " + tierConfigs.size() + "개, 기대 " + MAX_TIER_LEVEL + "개)");
        }
        for (int tierLevel = MIN_TIER_LEVEL; tierLevel <= MAX_TIER_LEVEL; tierLevel++) {
            if (!tierConfigs.containsKey(tierLevel)) {
                throw new IllegalStateException("리그 티어 " + tierLevel + " 설정이 없습니다");
            }
        }
        return tierConfigs;
    }

    private int sendCrisisPage(List<LeagueRankingRow> page, Map<Integer, LeagueTierConfig> tierConfigs,
                               boolean includeDeadlineDMinusOne, Instant now) {
        List<UUID> userIds = page.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (LeagueRankingRow row : page) {
            User user = usersById.get(row.userId());
            if (user == null) {
                continue;
            }
            LeagueTierConfig config = tierConfigs.get(row.tierLevel());
            if (config == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(row.userId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = composeCrisisMessage(row, config, includeDeadlineDMinusOne, soundEnabled);
            if (message == null) {
                continue; // 안전권(승급 확정권/최상위) → 무발송
            }
            pushNotificationService.sendIfAllowed(user, settings, message, now);
            processedCount++;
        }
        return processedCount;
    }

    /** 유저당 1건 분기: 강등 위험 &gt; 마감 D-1(승급 독려) &gt; 무발송(안전권). */
    private PushMessage composeCrisisMessage(LeagueRankingRow row, LeagueTierConfig config,
                                             boolean includeDeadlineDMinusOne, boolean soundEnabled) {
        int total = row.totalFocusSeconds();
        // 1. 강등 위험 — T1 제외(강등 임계값 0), 이번 주 누적이 현재 티어 강등 임계값 미달
        if (row.tierLevel() > 1 && total < config.getRelegationTime()) {
            return composeRelegationWarning(config.getRelegationTime() - total, soundEnabled);
        }
        // 2. 마감 D-1 승급 독려 — 최상위(T5) 제외, 아직 승급 임계값 미달. 저녁 재발송(false)엔 생략
        if (includeDeadlineDMinusOne && row.tierLevel() < MAX_TIER_LEVEL && total < config.getPromotionTime()) {
            return composeDeadlineDMinusOne(config.getPromotionTime() - total, soundEnabled);
        }
        // 3. 안전권(승급 확정권/최상위) → 무발송
        return null;
    }

    private int sendDeadlinePage(List<LeagueRankingRow> page, int rankOffset, Instant now,
                                 DeadlineMessageComposer composer) {
        List<UUID> userIds = page.stream().map(LeagueRankingRow::userId).toList();
        Map<UUID, User> usersById = loadUsers(userIds);
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(userIds);
        int processedCount = 0;
        for (int index = 0; index < page.size(); index++) {
            LeagueRankingRow row = page.get(index);
            UUID userId = row.userId();
            User user = usersById.get(userId);
            if (user == null) {
                continue;
            }
            UserNotificationSettings settings = settingsByUserId.get(userId);
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(
                    user, settings, composer.compose(rankOffset + index + 1, soundEnabled), now);
            processedCount++;
        }
        return processedCount;
    }

    /** 마감 시퀀스 페이지의 각 유저 순위로 알림 문구를 만드는 컴포저(4h·2h가 문구·딥링크만 다름). */
    @FunctionalInterface
    private interface DeadlineMessageComposer {
        PushMessage compose(int rank, boolean soundEnabled);
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

    private PushMessage composeNewLeagueStart(boolean soundEnabled) {
        return new PushMessage(
                "새 리그 시작!",
                "이번 주 리그가 새로 시작됐어. 오늘 목표는? 지금 바로 몰입 시작하자!",
                "gromo://league",
                soundEnabled);
    }

    private PushMessage composeDeadline(int rank, boolean soundEnabled) {
        return new PushMessage(
                "리그 마감까지 4시간!",
                "지금 " + rank + "위야. 마지막 스퍼트 한 번 어때?",
                "gromo://league",
                soundEnabled);
    }

    private PushMessage composeFinalDeadline(int rank, boolean soundEnabled) {
        return new PushMessage(
                "마감 2시간 전!",
                "지금 " + rank + "위야. 마지막 스퍼트 한 번 어때?",
                "gromo://focus",
                soundEnabled);
    }

    private PushMessage composeRelegationWarning(int shortfallSeconds, boolean soundEnabled) {
        return new PushMessage(
                "강등 위기야!",
                "이번 주 " + formatShortfall(shortfallSeconds) + " 더 채워야 강등을 피할 수 있어. 지금 몰입할까?",
                "gromo://focus",
                soundEnabled);
    }

    private PushMessage composeDeadlineDMinusOne(int shortfallSeconds, boolean soundEnabled) {
        return new PushMessage(
                "리그 마감 하루 전!",
                "승급까지 " + formatShortfall(shortfallSeconds) + " 남았어. 오늘 몰아쳐볼까?",
                "gromo://league",
                soundEnabled);
    }

    /** 부족한 초를 사람이 읽는 "N시간 M분"(1분 미만도 최소 1분)으로 표기한다. */
    private static String formatShortfall(int shortfallSeconds) {
        int totalMinutes = (int) Math.ceil(shortfallSeconds / 60.0);
        int hours = totalMinutes / 60;
        int minutes = totalMinutes % 60;
        if (hours > 0) {
            return minutes > 0 ? hours + "시간 " + minutes + "분" : hours + "시간";
        }
        return minutes + "분";
    }

    private static String tierDisplayName(int tierLevel) {
        String[] tierNames = {"뽀시래기", "예열 모드", "초집중 모드", "갓생러", "집중 정복자"};
        int clamped = Math.max(1, Math.min(tierNames.length, tierLevel));
        return tierNames[clamped - 1];
    }
}
