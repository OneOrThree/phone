package com.oneorthree.phone.notification.service;

import com.oneorthree.phone.common.port.PushMessage;
import com.oneorthree.phone.league.domain.LeagueArena;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.domain.LeagueMemberResult;
import com.oneorthree.phone.league.repository.LeagueArenaRepository;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.domain.UserNotificationSettings;
import com.oneorthree.phone.user.repository.UserNotificationSettingsRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 리그 푸시 트리거 3종 (GROMO-528 커밋④) — apns.md §3 ①②⑥.
 * ①② 승격/강등: 월 09:00 KST — 직전 주차 ENDED 아레나의 확정 result 재조회(상태 재조회 방식, 큐 없음).
 * ⑥ 마감 임박: 일 20:00 KST — ACTIVE 아레나 참가자 전원.
 */
@Service
@RequiredArgsConstructor
@Slf4j
@Transactional
public class LeagueNotificationService {

    // 리그 도메인 타임존 고정 — 412/519 와 통일 (LeagueBatchService.LEAGUE_ZONE 과 동일 값)
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final LeagueArenaRepository leagueArenaRepository;
    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final UserNotificationSettingsRepository userNotificationSettingsRepository;
    private final PushNotificationService pushNotificationService;

    /** ①② 승격/강등 알림 — 스케줄러(월 09:00 KST)·수동 트리거 진입점. */
    public void sendWeeklyResultNotifications() {
        sendWeeklyResultNotifications(Instant.now());
    }

    /**
     * ①② 승격/강등 알림 본체 — 직전 주차 ENDED 아레나의 확정 result 재조회(상태 재조회 방식, 큐 없음).
     * Instant 주입 오버로드 = 412/519 시각 주입 선례 (테스트 결정성).
     */
    public void sendWeeklyResultNotifications(Instant now) {
        // 직전 주차 = 이번 주 월요일 00:00(KST) − 7일. 배치가 저장한 weekStartAt 과 equality 조회
        Instant prevWeekStart = resolveWeekStart(now).minus(7, ChronoUnit.DAYS);
        List<LeagueArenaUser> members = leagueArenaUserRepository.findEndedByWeekStartAndResultIn(
                prevWeekStart, List.of(LeagueMemberResult.PROMOTED, LeagueMemberResult.RELEGATED));
        if (members.isEmpty()) {
            // 배치(412) 미실행/실패 주간이면 빈 리스트 — 오발송 없이 무발송 (스펙 리스크 절)
            log.info("주간 리그 결과 알림 — 대상 없음 (prevWeekStart={})", prevWeekStart);
            return;
        }
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(members.stream()
                .map(member -> member.getUser().getId())
                .toList());
        for (LeagueArenaUser member : members) {
            User user = member.getUser();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            PushMessage message = member.getResult() == LeagueMemberResult.PROMOTED
                    ? composePromotion(member.getTierLevel(), soundEnabled)
                    : composeRelegation(member.getTierLevel(), soundEnabled);
            pushNotificationService.sendIfAllowed(user, settings, message, now);
        }
        log.info("주간 리그 결과 알림 — 대상 {}건 처리 완료 (prevWeekStart={})", members.size(), prevWeekStart);
    }

    /** ⑥ 마감 임박 알림 — 스케줄러(일 20:00 KST)·수동 트리거 진입점. */
    public void sendDeadlineReminders() {
        sendDeadlineReminders(Instant.now());
    }

    /** ⑥ 마감 임박 알림 본체 — ACTIVE 아레나 참가자 전원에게 현재 순위 포함 발송. */
    public void sendDeadlineReminders(Instant now) {
        List<LeagueArena> activeArenas = leagueArenaRepository.findByStatus(LeagueArenaStatus.ACTIVE);
        if (activeArenas.isEmpty()) {
            log.info("리그 마감 임박 알림 — ACTIVE 아레나 없음");
            return;
        }
        // 아레나당 1쿼리로 전원 순위 확보 (findRankedByArena 순서 = /league/me/rank 와 동일 산정, index+1)
        Map<LeagueArenaUser, Integer> rankByMember = new LinkedHashMap<>();
        for (LeagueArena arena : activeArenas) {
            List<LeagueArenaUser> ranked = leagueArenaUserRepository.findRankedByArena(arena);
            for (int i = 0; i < ranked.size(); i++) {
                rankByMember.put(ranked.get(i), i + 1);
            }
        }
        Map<UUID, UserNotificationSettings> settingsByUserId = loadSettings(rankByMember.keySet().stream()
                .map(member -> member.getUser().getId())
                .toList());
        for (Map.Entry<LeagueArenaUser, Integer> entry : rankByMember.entrySet()) {
            User user = entry.getKey().getUser();
            UserNotificationSettings settings = settingsByUserId.get(user.getId());
            boolean soundEnabled = settings == null || settings.isSoundEnabled();
            pushNotificationService.sendIfAllowed(
                    user, settings, composeDeadline(entry.getValue(), soundEnabled), now);
        }
        log.info("리그 마감 임박 알림 — 아레나 {}개, 대상 {}건 처리 완료", activeArenas.size(), rankByMember.size());
    }

    // 대상 유저 설정 일괄 로드 — 유저별 단건 조회 N+1 금지 (row 부재 유저는 Map 에 없음 = sendIfAllowed 가 기본값 취급)
    private Map<UUID, UserNotificationSettings> loadSettings(Collection<UUID> userIds) {
        return userNotificationSettingsRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(UserNotificationSettings::getUserId, Function.identity()));
    }

    // ── 문구 조립 (apns.md §3 ①②⑥ — 카피 변경 시 apns.md 와 함께 수정) ────────────────────

    // ① 승격 — {상위티어} = 현재 tierLevel + 1 의 표시명
    private PushMessage composePromotion(int tierLevel, boolean soundEnabled) {
        String upperTier = tierDisplayName(tierLevel + 1);
        return new PushMessage(
                "🎉 우리 승격했어 !",
                "이번 주 몰입으로 " + upperTier + " 리그에 올라갔어. 새 순위 보러 올래?",
                "gromo://league",
                soundEnabled);
    }

    // ② 강등 — {하위티어} = 현재 tierLevel − 1 의 표시명, 복귀 동선 유도로 focus 딥링크
    private PushMessage composeRelegation(int tierLevel, boolean soundEnabled) {
        String lowerTier = tierDisplayName(tierLevel - 1);
        return new PushMessage(
                "저번 주 리그가 종료되었어요!",
                "이번주는 " + lowerTier + " 리그에서 조금 더 힘내봐요!",
                "gromo://focus",
                soundEnabled);
    }

    // ⑥ 마감 임박 — {내순위} = 아레나 내 순위 (findRankedByArena 순서 index+1)
    private PushMessage composeDeadline(int rank, boolean soundEnabled) {
        return new PushMessage(
                "리그 마감까지 4시간!",
                "지금 " + rank + "위야. 마지막 스퍼트 한 번 어때?",
                "gromo://league",
                soundEnabled);
    }

    /**
     * 티어 표시명 매핑 — DB 에는 badge_id 만 있고 표시명은 앱에서 매핑하는 정책이라 서버 상수로 둔다.
     * ⚠️ 앱 app/src/constants/tiers.ts 와 동기 필수 — 티어 개명 시 양쪽을 함께 수정할 것.
     * 범위 밖 레벨은 1..5 클램프 (tiers.ts 와 동일. 최상위 승격/최하위 강등은 배치 보정상 발생하지 않지만 방어).
     */
    private static String tierDisplayName(int tierLevel) {
        String[] tierNames = {"뽀시래기", "예열 모드", "초집중 모드", "갓생러", "집중 정복자"};
        int clamped = Math.max(1, Math.min(tierNames.length, tierLevel));
        return tierNames[clamped - 1];
    }

    // now 가 속한 주의 월요일 00:00(KST) — LeagueBatchService.resolveWeekStart 와 동일 로직
    // (private 라 참조 불가해 재구현. 배치가 저장한 weekStartAt 과 equality 비교되므로 산정 방식이 반드시 일치해야 함)
    private static Instant resolveWeekStart(Instant now) {
        return now.atZone(KST).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(KST)
                .toInstant();
    }
}
