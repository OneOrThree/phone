package com.oneorthree.phone.bot.service;

import com.oneorthree.phone.bot.domain.BotFocusBlock;
import com.oneorthree.phone.bot.domain.BotProfile;
import com.oneorthree.phone.bot.repository.BotProfileRepository;
import com.oneorthree.phone.common.util.ZonePolicy;
import com.oneorthree.phone.focus.domain.FocusSession;
import com.oneorthree.phone.focus.dto.FocusSessionEndRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartRequest;
import com.oneorthree.phone.focus.dto.FocusSessionStartResponse;
import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.focus.repository.UserFocusTagRepository;
import com.oneorthree.phone.focus.service.FocusService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
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
            return new BotTickResult(0, 0, 0);
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
        int failed = 0;
        for (BotProfile profile : profiles) {
            UUID botId = profile.getUserId();
            Optional<BotFocusBlock> current =
                    currentBlock(profile, today, minuteOfDay, tagsByBot.getOrDefault(botId, List.of()));
            FocusSession live = liveByBot.get(botId);
            try {
                if (current.isPresent() && live == null) {
                    if (start(botId, current.get())) {
                        started++;
                    }
                } else if (current.isEmpty() && live != null) {
                    focusService.endFocusSession(botId, new FocusSessionEndRequest(live.getId(), null, 0, null));
                    ended++;
                }
            } catch (RuntimeException e) {
                // 한 봇의 실패로 나머지를 멈추지 않는다. 다음 tick 이 같은 상태를 다시 맞춘다.
                failed++;
                log.warn("봇 집중 세션 전이 실패 — botId={}", botId, e);
            }
        }
        return new BotTickResult(started, ended, failed);
    }

    private boolean start(UUID botId, BotFocusBlock block) {
        FocusSessionStartResponse response =
                focusService.startFocusSession(botId, new FocusSessionStartRequest(block.focusTagId(), null));
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
    private Optional<BotFocusBlock> currentBlock(BotProfile profile, LocalDate today, int minuteOfDay,
                                                 List<UUID> focusTagIds) {
        Optional<BotFocusBlock> fromToday = scheduleGenerator.blocksOf(profile, today, focusTagIds).stream()
                .filter(block -> block.contains(minuteOfDay))
                .findFirst();
        if (fromToday.isPresent()) {
            return fromToday;
        }
        // 어제 기준 분으로 환산해 비교한다 — 어제 25:30 블록은 오늘 01:30 이다.
        return scheduleGenerator.blocksOf(profile, today.minusDays(1), focusTagIds).stream()
                .filter(block -> block.contains(minuteOfDay + MINUTES_PER_DAY))
                .findFirst();
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
     * @param started 새로 연 세션 수
     * @param ended   닫은 세션 수
     * @param failed  전이에 실패한 봇 수
     */
    public record BotTickResult(int started, int ended, int failed) {

        public boolean isQuiet() {
            return started == 0 && ended == 0 && failed == 0;
        }
    }
}
