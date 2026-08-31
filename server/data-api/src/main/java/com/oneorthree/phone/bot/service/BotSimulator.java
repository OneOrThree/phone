package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.repository.BotProfileRepository;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.repository.domain.FocusSession;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.focus.service.FocusService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 봇 유저 대신 집중 세션을 열고 닫는다 (GROMO-1565).
 *
 * <p>매 tick 마다 봇의 "지금 집중하고 있어야 하는가"({@link BotScheduleGenerator})와 실제 라이브 세션
 * 유무를 비교해 <b>차이가 나는 봇만</b> 건드린다. 대부분의 tick 에서 전이는 몇 건뿐이다.
 *
 * <p>세션 생성·종료는 기존 {@code FocusService} 를 그대로 호출한다. 그래야 일일 집계
 * ({@code daily_focus_stats})·스트릭·코인이 실유저와 완전히 같은 경로로 쌓이고, 봇 전용 집계 로직을
 * 따로 만들 필요가 없다. 대가로 봇에게도 코인·스트릭이 쌓이는데, 실유저 통계를 뽑을 때
 * {@code users.is_bot} 으로 거르면 된다.
 *
 * <p>한 봇의 실패가 나머지를 막지 않도록 봇 단위로 예외를 삼킨다({@code LeagueBatchService} 선례).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class BotSimulator {

    /** 라이브로 인정할 세션의 최대 나이 — {@code FocusLiveInfoLookup} 과 같은 기준(12시간). */
    private static final Duration LIVE_SESSION_MAX_AGE = Duration.ofHours(12);

    private static final int MINUTES_PER_DAY = 24 * 60;

    private final BotProfileRepository botProfileRepository;
    private final UserFocusTagRepository userFocusTagRepository;
    private final FocusSessionRepository focusSessionRepository;
    private final BotScheduleGenerator scheduleGenerator;
    private final FocusService focusService;

    /**
     * 봇 전원의 상태를 한 번 맞춘다.
     *
     * @param now 판정 기준 시각
     * @return 이번 tick 에서 시작·종료한 세션 수
     */
    public BotTickResult tick(Instant now) {
        List<BotProfile> profiles = botProfileRepository.findAll();
        if (profiles.isEmpty()) {
            return new BotTickResult(0, 0, 0, 0);
        }
        List<UUID> botIds = profiles.stream().map(BotProfile::getUserId).toList();
        Map<UUID, List<UUID>> tagsByBot = focusTagIdsByBot(botIds);
        Map<UUID, FocusSession> liveByBot = focusSessionRepository
                .findLiveSessionsByUserIdIn(botIds, now.minus(LIVE_SESSION_MAX_AGE))
                .stream()
                .collect(Collectors.toMap(session -> session.getUser().getId(), Function.identity(),
                        (existing, duplicate) -> existing));

        LocalDateTime nowKst = LocalDateTime.ofInstant(now, ZonePolicy.KST);
        LocalDate today = nowKst.toLocalDate();
        int minuteOfDay = nowKst.toLocalTime().getHour() * 60 + nowKst.toLocalTime().getMinute();

        int started = 0;
        int ended = 0;
        int replaced = 0;
        int failed = 0;
        for (BotProfile profile : profiles) {
            UUID botId = profile.getUserId();
            Optional<ScheduledBlock> current =
                    currentBlock(profile, today, minuteOfDay, tagsByBot.getOrDefault(botId, List.of()));
            FocusSession live = liveByBot.get(botId);
            // user-activity 이벤트(FOCUS_SESSION_COMPLETED·STREAK_UPDATED)는 MDC 의 user_id 를 읽는다.
            // 스케줄러 스레드에는 인증 필터가 채워 주는 MDC 가 없어, 세팅하지 않으면 봇이 만든 이벤트가
            // 전부 user_id=null 로 발행돼 분석에서 실유저 지표와 섞인다(코드리뷰 반영).
            // 봇 id 는 결정론적이고 users.is_bot 으로 조인되므로, id 만 실리면 사후 분리가 가능하다.
            MDC.put("user_id", botId.toString());
            try {
                if (current.isEmpty()) {
                    if (live != null) {
                        endLive(botId, live);
                        ended++;
                    }
                } else if (live == null) {
                    if (start(botId, current.get())) {
                        started++;
                    }
                } else if (!current.get().startedWithin(live.getStartedAt())) {
                    // 배포나 DB 장애로 휴식 구간의 tick 을 놓치고 다음 블록 안에서 복구된 경우다.
                    // 그냥 두면 이전 블록 세션이 계속 열린 채 남아, 종료 시 휴식·장애 시간까지 집중으로
                    // 적립되고 태그도 이전 과목으로 남는다(코드리뷰 반영).
                    endLive(botId, live);
                    if (start(botId, current.get())) {
                        replaced++;
                    }
                }
            } catch (RuntimeException e) {
                // 한 봇의 실패로 나머지를 멈추지 않는다. 다음 tick 이 같은 상태를 다시 맞춘다.
                failed++;
                log.warn("봇 집중 세션 전이 실패 — botId={}", botId, e);
            } finally {
                MDC.remove("user_id");
            }
        }
        return new BotTickResult(started, ended, replaced, failed);
    }

    /**
     * 라이브 세션을 닫는다.
     *
     * <p>종료 시각을 블록의 예정 경계로 지정하지 못하는 이유: {@code FocusService} 가 클라 시각을
     * {@code [now-5분, now]} 로 클램프하므로 그보다 과거를 보내도 서버 수신 시각으로 치환된다.
     * 정상 운영에서는 tick 주기(5분)만큼만 늦어져 오차가 거의 없고, 장애로 여러 tick 을 놓친
     * 경우에만 놓친 시간이 집중분에 얹힌다 — 그 구간을 통째로 버리는 것(취소)보다는 낫다고 봤다.
     */
    private void endLive(UUID botId, FocusSession live) {
        focusService.endFocusSession(botId, new FocusSessionEndRequest(live.getId(), null, 0, null));
    }

    private boolean start(UUID botId, ScheduledBlock scheduled) {
        // 시작 시각으로 블록 경계를 넘긴다 — tick 이 5분 주기라 그냥 두면 매 세션이 최대 5분씩 짧아진다.
        // FocusService 의 클램프 창이 [now-5분, now] 라 tick 주기와 같아 정상 흐름에서는 그대로 반영되고,
        // 창을 벗어나면 서버 수신 시각으로 치환된다 — 그 경우에도 여전히 블록 안이라 판정이 어긋나지 않는다.
        FocusSessionStartResponse response = focusService.startFocusSession(
                botId, new FocusSessionStartRequest(scheduled.block().focusTagId(), scheduled.startInstant()));
        // sessionId 가 null 이면 마커가 만들어지지 않은 것이다(FocusService 의 순서 역전 방어).
        // 봇은 tick 당 한 번만 시작하므로 정상 흐름에선 나오지 않지만, 나오면 다음 tick 이 다시 시도한다.
        if (response.sessionId() == null) {
            log.debug("봇 세션 시작이 마커를 만들지 못했다 — botId={}", botId);
            return false;
        }
        return true;
    }

    /**
     * 지금 이 봇이 있어야 할 블록.
     *
     * <p>오늘 날짜뿐 아니라 <b>어제 날짜의 블록도 본다</b> — 야간형 봇은 자정을 넘겨 최대 다음날 06시까지
     * 집중하므로, 새벽 tick 이 오늘 블록만 계산하면 이 봇들이 갑자기 사라진다.
     */
    private Optional<ScheduledBlock> currentBlock(BotProfile profile, LocalDate today, int minuteOfDay,
                                                  List<UUID> focusTagIds) {
        Optional<ScheduledBlock> fromToday = scheduleGenerator.blocksOf(profile, today, focusTagIds).stream()
                .filter(block -> block.contains(minuteOfDay))
                .findFirst()
                .map(block -> new ScheduledBlock(block, today));
        if (fromToday.isPresent()) {
            return fromToday;
        }
        // 어제 기준 분으로 환산해 비교한다 — 어제 25:30 블록은 오늘 01:30 이다.
        LocalDate yesterday = today.minusDays(1);
        return scheduleGenerator.blocksOf(profile, yesterday, focusTagIds).stream()
                .filter(block -> block.contains(minuteOfDay + MINUTES_PER_DAY))
                .findFirst()
                .map(block -> new ScheduledBlock(block, yesterday));
    }

    /**
     * 블록과 그 블록이 속한 스케줄 기준일. 블록 시각이 기준일 00시로부터의 분이라, 실제 세션이
     * 이 블록에서 시작됐는지 절대 시각으로 따지려면 기준일이 함께 있어야 한다.
     */
    private record ScheduledBlock(BotFocusBlock block, LocalDate scheduleDate) {

        Instant startInstant() {
            return scheduleDate.atStartOfDay(ZonePolicy.KST).plusMinutes(block.startMinute()).toInstant();
        }

        boolean startedWithin(Instant sessionStartedAt) {
            long minutes = ChronoUnit.MINUTES.between(
                    scheduleDate.atStartOfDay(), LocalDateTime.ofInstant(sessionStartedAt, ZonePolicy.KST));
            return minutes >= Integer.MIN_VALUE && minutes <= Integer.MAX_VALUE
                    && block.contains((int) minutes);
        }
    }

    private Map<UUID, List<UUID>> focusTagIdsByBot(List<UUID> botIds) {
        Map<UUID, List<UUID>> byBot = new HashMap<>();
        userFocusTagRepository.findActiveByUserIdIn(botIds).forEach(tag ->
                byBot.computeIfAbsent(tag.getUser().getId(), key -> new ArrayList<>()).add(tag.getId()));
        return byBot;
    }

    /**
     * 한 tick 의 결과.
     *
     * @param started  새로 연 세션 수
     * @param ended    닫은 세션 수
     * @param replaced 이전 블록 세션을 닫고 현재 블록으로 새로 연 수 — 0 이 아니면 tick 을 놓쳤다는 신호다
     * @param failed   전이에 실패한 봇 수
     */
    public record BotTickResult(int started, int ended, int replaced, int failed) {

        public boolean isQuiet() {
            return started == 0 && ended == 0 && replaced == 0 && failed == 0;
        }
    }
}
