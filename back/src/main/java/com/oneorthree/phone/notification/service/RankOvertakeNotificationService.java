package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueRankSnapshot;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.league.repository.LeagueRankSnapshotRepository;
import com.oneorthree.phone.notification.domain.NotificationSentLog;
import com.oneorthree.phone.notification.repository.NotificationSentLogRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 순위 추월 푸시 트리거 (GROMO-579) — apns.md §3-⑤.
 *
 * <p>매일 19:00 KST 배치(NotificationScheduler)·수동 트리거(NotificationBatchController)가 진입점.
 * ACTIVE 아레나별 오늘 실시간 순위(findRankedByArena, totalFocusSeconds DESC)를 확보하고,
 * <b>어제 스냅샷</b>(created_at = 어제 KST)과 비교해 "나를 제친 라이벌"(어제 나보다 아래/같음 → 오늘 나보다 위)을
 * 감지한다. 라이벌이 있으면 대표 1명 + "외 N명" 으로 <b>1건 묶음</b> 발송하고, 처리 후 오늘 순위를
 * created_at = 오늘 로 upsert 해 다음날 비교 기준을 남긴다(부트스트랩: 어제 스냅샷이 없으면 감지 없이 저장만).
 *
 * <p>발송 파이프라인은 528 을 재사용 — settings 일괄 로드(findAllById) 후 sendIfAllowed 로 위임.
 * quiet hours(야간)는 sendIfAllowed 가 처리하며, 실제 발송(true 반환)된 건만 notification_sent_logs 에 기록해
 * 48h 쿨다운·주2회 상한을 판정한다.
 *
 * <p>억제(하나라도 해당 시 스킵): (a) 내가 최하위 (b) 오늘 이미 접속 (c) 오늘 이미 집중 (d) 마감 임박(12h 이내)
 * (e) 같은 라이벌 48h 쿨다운 (f) 이번 주 이미 2회. 리그계열(①②⑥)과의 크로스 dedup 은 별도 저장소 없이
 * 추월 자체의 쿨다운/상한만 구현 — 크로스 dedup 은 후속 티켓.
 *
 * <p>N+1 회피: 아레나별 1쿼리 순위(findRankedByArena), 어제 스냅샷·오늘 focus·settings·sent_log 를 모두
 * 대상 유저 집합에 대해 일괄 조회한다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class RankOvertakeNotificationService {

    // 리그/알림 도메인 타임존 고정 — 412/519/528/578 과 통일.
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 마감 임박 억제 임계 — 다음 리그 마감(월 00:00 KST)까지 이 시간 이내면 스킵(⑥ 마감 임박 알림과 역할 분리).
    private static final Duration DEADLINE_SUPPRESS_WINDOW = Duration.ofHours(12);
    // 같은 라이벌 재발송 쿨다운 — 엎치락뒤치락 핑퐁 방지.
    private static final Duration RIVAL_COOLDOWN = Duration.ofHours(48);
    // 이번 주 RANK_OVERTAKE 발송 상한.
    private static final int WEEKLY_CAP = 2;

    private final LeagueArenaRepository leagueArenaRepository;
    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final LeagueRankSnapshotRepository leagueRankSnapshotRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final NotificationSentLogRepository notificationSentLogRepository;
    private final PushNotificationService pushNotificationService;

    /** 스케줄러(매일 19:00 KST)·수동 트리거 진입점. */
    public void sendRankOvertakeNotifications() {
        sendRankOvertakeNotifications(Instant.now());
    }

    /**
     * 순위 추월 푸시 본체. Instant 주입 오버로드 = 고정 시각 테스트용(LeagueNotificationService 선례).
     */
    public void sendRankOvertakeNotifications(Instant now) {
        LocalDate today = now.atZone(KST).toLocalDate();
        LocalDate yesterday = today.minusDays(1);

        List<LeagueArena> activeArenas = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        if (activeArenas.isEmpty()) {
            log.info("순위 추월 푸시 — ACTIVE 아레나 없음");
            return;
        }
        List<UUID> arenaIds = activeArenas.stream().map(LeagueArena::getId).toList();

        // 1. 아레나별 오늘 실시간 순위 — findRankedByArena 순서 index+1 (/league/me/rank 와 동일 산정, user JOIN FETCH)
        Map<UUID, List<LeagueArenaUser>> rankedByArena = new HashMap<>();
        Set<UUID> candidateUserIds = new HashSet<>();
        for (LeagueArena arena : activeArenas) {
            List<LeagueArenaUser> ranked = leagueArenaUserRepository.findRankedByArena(arena);
            rankedByArena.put(arena.getId(), ranked);
            ranked.forEach(m -> candidateUserIds.add(m.getUser().getId()));
        }

        // 2. 어제 스냅샷 일괄 로드 → (arenaId,userId) → 어제 순위
        Map<RankKey, Integer> yesterdayRank = leagueRankSnapshotRepository
                .findByArenaIdInAndCapturedOn(arenaIds, yesterday).stream()
                .collect(Collectors.toMap(
                        s -> new RankKey(s.getArenaId(), s.getUserId()), LeagueRankSnapshot::getRank));

        // 3. 억제 판정용 데이터 일괄 로드
        Instant startOfTodayKst = today.atStartOfDay(KST).toInstant();
        Instant startOfTomorrowKst = today.plusDays(1).atStartOfDay(KST).toInstant();
        List<UUID> candidateList = new ArrayList<>(candidateUserIds);
        // (c) 오늘 집중한 유저 집합
        Set<UUID> focusedTodayUserIds = new HashSet<>(focusSessionRepository
                .findUserIdsWithSessionStartedBetween(candidateList, startOfTodayKst, startOfTomorrowKst));
        // (d) 마감 임박 — 다음 리그 마감(월 00:00 KST)까지 12h 이내면 전 유저 스킵(글로벌 판정)
        boolean deadlineImminent = isDeadlineImminent(now);
        // (e)(f) 이번 주 RANK_OVERTAKE 로그 — 48h 가 주 경계를 넘을 수 있어 min(주시작, now−48h) 부터 로드
        Instant weekStart = resolveWeekStart(now);
        Instant sinceForLogs = weekStart.isBefore(now.minus(RIVAL_COOLDOWN))
                ? weekStart : now.minus(RIVAL_COOLDOWN);
        List<NotificationSentLog> logs = notificationSentLogRepository
                .findByTypeAndUserIdInSince(NotificationSentLog.TYPE_RANK_OVERTAKE, candidateList, sinceForLogs);
        // 유저별 이번 주 발송 횟수 (weekStart 이후만 카운트)
        Map<UUID, Integer> weeklySentCount = new HashMap<>();
        // (유저, 라이벌) 별 최근 발송 시각
        Map<RivalKey, Instant> lastSentToRival = new HashMap<>();
        for (NotificationSentLog logEntry : logs) {
            if (!logEntry.getSentAt().isBefore(weekStart)) {
                weeklySentCount.merge(logEntry.getUserId(), 1, Integer::sum);
            }
            if (logEntry.getTargetUserId() != null) {
                lastSentToRival.merge(new RivalKey(logEntry.getUserId(), logEntry.getTargetUserId()),
                        logEntry.getSentAt(), (a, b) -> a.isAfter(b) ? a : b);
            }
        }

        // 4. 추월 감지 + 억제 → 발송 대상 수집
        List<Overtake> overtakes = new ArrayList<>();
        for (LeagueArena arena : activeArenas) {
            List<LeagueArenaUser> ranked = rankedByArena.get(arena.getId());
            int size = ranked.size();
            for (int i = 0; i < size; i++) {
                LeagueArenaUser me = ranked.get(i);
                UUID myId = me.getUser().getId();
                int myTodayRank = i + 1;
                Integer myYesterdayRank = yesterdayRank.get(new RankKey(arena.getId(), myId));
                // 부트스트랩/신규 멤버 — 어제 순위 없으면 나에 대한 감지 스킵(오늘 스냅샷은 뒤에서 저장)
                if (myYesterdayRank == null) {
                    continue;
                }
                // (a) 내가 최하위(아래에 아무도 없음) → 추월 개념 자체가 성립 안 함
                if (myTodayRank == size) {
                    continue;
                }
                // 나를 제친 라이벌 = 어제 나보다 아래/같음(어제 rank ≥ 내 어제 rank) & 오늘 나보다 위(오늘 rank < 내 오늘 rank)
                List<LeagueArenaUser> rivals = new ArrayList<>();
                for (int j = 0; j < myTodayRank - 1; j++) {   // 오늘 나보다 위 = index < myTodayRank-1
                    LeagueArenaUser candidate = ranked.get(j);
                    UUID rivalId = candidate.getUser().getId();
                    if (rivalId.equals(myId)) {
                        continue;
                    }
                    Integer rivalYesterday = yesterdayRank.get(new RankKey(arena.getId(), rivalId));
                    if (rivalYesterday != null && rivalYesterday >= myYesterdayRank) {
                        rivals.add(candidate);
                    }
                }
                if (rivals.isEmpty()) {
                    continue;
                }
                // 대표 = 오늘 순위가 가장 위(최상위) 라이벌. rivals 는 순위 오름차순(위→아래)이라 첫 원소.
                LeagueArenaUser representative = rivals.get(0);
                UUID repRivalId = representative.getUser().getId();

                // 억제 (b) 오늘 접속 / (c) 오늘 집중 / (d) 마감 임박 / (e) 48h 쿨다운 / (f) 주2회 상한
                if (me.getUser().getLastActiveAt() != null
                        && !me.getUser().getLastActiveAt().isBefore(startOfTodayKst)) {
                    continue;   // (b)
                }
                if (focusedTodayUserIds.contains(myId)) {
                    continue;   // (c)
                }
                if (deadlineImminent) {
                    continue;   // (d)
                }
                Instant lastToRival = lastSentToRival.get(new RivalKey(myId, repRivalId));
                if (lastToRival != null && lastToRival.isAfter(now.minus(RIVAL_COOLDOWN))) {
                    continue;   // (e)
                }
                if (weeklySentCount.getOrDefault(myId, 0) >= WEEKLY_CAP) {
                    continue;   // (f)
                }
                overtakes.add(new Overtake(me.getUser(), representative.getUser(), rivals.size()));
            }
        }

        // 5. 발송 + 발송된 건만 sent_log INSERT
        if (!overtakes.isEmpty()) {
            Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(overtakes.stream()
                    .map(o -> o.me().getId()).toList());
            List<NotificationSentLog> newLogs = new ArrayList<>();
            for (Overtake overtake : overtakes) {
                User user = overtake.me();
                UserNotificationSettings settings = settingsByUserId.get(user.getId());
                boolean soundEnabled = settings == null || settings.isSoundEnabled();
                PushMessage message = compose(overtake.representative().getNickname(),
                        overtake.rivalCount(), soundEnabled);
                boolean sent = pushNotificationService.sendIfAllowed(user, settings, message, now);
                if (sent) {
                    newLogs.add(NotificationSentLog.builder()
                            .userId(user.getId())
                            .type(NotificationSentLog.TYPE_RANK_OVERTAKE)
                            .targetUserId(overtake.representative().getId())
                            .sentAt(now)
                            .build());
                }
            }
            notificationSentLogRepository.saveAll(newLogs);
            log.info("순위 추월 푸시 — 대상 {}건 중 실발송 {}건 (today={})",
                    overtakes.size(), newLogs.size(), today);
        } else {
            log.info("순위 추월 푸시 — 발송 대상 없음 (today={})", today);
        }

        // 6. 오늘 스냅샷 upsert — 다음날 비교 기준(부트스트랩 포함: 어제 없어도 오늘은 저장)
        saveTodaySnapshots(rankedByArena, arenaIds, today);
    }

    // 오늘 순위를 created_at=today 로 저장. 이미 오늘치가 있으면(재실행) 값 갱신, 없으면 신규 INSERT.
    // ⚠️ read-then-write(원자적 upsert 아님) — 동시 실행(수동 트리거+스케줄러, 또는 멀티 인스턴스)이 겹치면
    //    둘 다 "없음"으로 읽어 UNIQUE(arena_id,user_id,created_at) 위반·이중 발송 가능. 분산 락(GROMO-565) 클래스 이슈.
    private void saveTodaySnapshots(Map<UUID, List<LeagueArenaUser>> rankedByArena,
                                    List<UUID> arenaIds, LocalDate today) {
        Map<RankKey, LeagueRankSnapshot> existing = leagueRankSnapshotRepository
                .findByArenaIdInAndCapturedOn(arenaIds, today).stream()
                .collect(Collectors.toMap(s -> new RankKey(s.getArenaId(), s.getUserId()), Function.identity()));
        List<LeagueRankSnapshot> toSave = new ArrayList<>();
        for (Map.Entry<UUID, List<LeagueArenaUser>> entry : rankedByArena.entrySet()) {
            UUID arenaId = entry.getKey();
            List<LeagueArenaUser> ranked = entry.getValue();
            for (int i = 0; i < ranked.size(); i++) {
                UUID userId = ranked.get(i).getUser().getId();
                int rank = i + 1;
                LeagueRankSnapshot snapshot = existing.get(new RankKey(arenaId, userId));
                if (snapshot != null) {
                    snapshot.setRank(rank);   // 더티체킹으로 갱신
                } else {
                    toSave.add(LeagueRankSnapshot.builder()
                            .arenaId(arenaId).userId(userId).rank(rank).createdAt(today).build());
                }
            }
        }
        leagueRankSnapshotRepository.saveAll(toSave);
    }

    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    // 마감 임박 — 다음 리그 마감(now 가 속한 주의 '다음' 월 00:00 KST) 까지 12h 이내인가.
    // weekStart(이번 주 월 00:00) + 7일 = 다음 마감. resolveWeekStart 재사용(⑥ 마감 임박 산정과 동일 유래).
    private boolean isDeadlineImminent(Instant now) {
        Instant nextDeadline = resolveWeekStart(now).plus(7, ChronoUnit.DAYS);
        return Duration.between(now, nextDeadline).compareTo(DEADLINE_SUPPRESS_WINDOW) <= 0;
    }

    // now 가 속한 주의 월요일 00:00(KST) — LeagueBatchService.resolveWeekStart 와 동일(private 라 재구현).
    private static Instant resolveWeekStart(Instant now) {
        return now.atZone(KST).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(KST)
                .toInstant();
    }

    // 문구 조립 (apns.md §3-⑤ — 카피 변경 시 apns.md 와 함께 수정). 딥링크는 리그(gromo://league).
    private PushMessage compose(String rivalNickname, int rivalCount, boolean soundEnabled) {
        String title = rivalCount > 1
                ? rivalNickname + "님 외 " + (rivalCount - 1) + "명한테 순위 뺏겼어요!"
                : rivalNickname + "님한테 순위 뺏겼어요!";
        return new PushMessage(title, "잠깐 집중해서 다시 제쳐볼까요?", "gromo://league", soundEnabled);
    }

    // (아레나, 유저) 순위 조회 키
    private record RankKey(UUID arenaId, UUID userId) {
    }

    // (나, 라이벌) 쿨다운 조회 키
    private record RivalKey(UUID userId, UUID rivalId) {
    }

    // 발송 대상 1건 — 나 + 대표 라이벌 + 라이벌 총원(묶음 문구용)
    private record Overtake(User me, User representative, int rivalCount) {
    }
}
