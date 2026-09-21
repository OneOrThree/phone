package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.domain.FocusSessionLifecycle;
import com.oneorthree.phone.focus.support.FocusRewardAccrualGate;
import com.oneorthree.phone.internal.service.GoldenFishService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/**
 * 황금 물고기 추첨 틱 (GROMO-1956) — 「황금 물고기는 <b>섬마다 1분에 한 번</b> 추첨하며」의 그 1분이다.
 *
 * <p>{@link FocusRewardScheduler} 와 같은 패턴이다: 이 클래스는 무트랜잭션이고 섬마다
 * {@link GoldenFishService} 가 자기 트랜잭션으로 돈다. 한 섬의 실패가 다른 섬의 추첨을 되돌리지 않는다.
 *
 * <p><b>틱을 놓쳐도 확률이 오르지 않는다</b> — 주사위가 {@code (섬, 분)} 의 순수 함수라
 * ({@code GoldenFishDraw}) 같은 분을 다시 돌려도 같은 결과이고, 이긴 분의 중복 적립은 섬 원장 키가 막는다.
 * 반대로 <b>건너뛴 분은 영영 지나간다</b>: 이 틱은 «지금 분» 만 돌린다. 밀린 분을 소급해 굴리면 그만큼
 * 기대 보너스가 뭉쳐 나와 「1분에 한 번」이라는 정책의 리듬이 깨진다(집중 적립의 워터마크와 반대 선택이다 —
 * 그쪽은 «찬 시간» 이 근거라 소급이 옳고, 이쪽은 «흐른 분» 이 근거라 소급이 틀리다).
 *
 * <p>초 20에 도는 것은 정각(집중 적립)·30초(퀘스트 보너스)와 겹치지 않으려는 것이고, 집중 적립 뒤라
 * 방금 60초를 채운 주민도 이미 그 분의 물고기를 받은 상태다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class GoldenFishScheduler {

    private final FocusSessionDetailRepository details;
    private final GoldenFishService goldenFish;
    /**
     * 분당 적립 크론과 <b>같은 스위치</b>를 쓴다 — 황금 물고기도 분 단위 지급이라, 혼합 버전 배포에서
     * 옛 이미지가 도는 동안에는 켜지 않는다. 별도 flag 를 두면 「적립은 꺼져 있는데 보너스만 나가는」
     * 조합이 생겨, 옛 finish 가 세션 전체를 다시 지급할 때 그 위에 보너스까지 얹힌다.
     */
    private final FocusRewardAccrualGate gate;
    private final Clock clock;

    /** 매분 20초 — ACTIVE 가 2명 이상인 섬만 추첨한다. */
    @Scheduled(cron = "20 * * * * *", zone = "UTC", scheduler = SchedulingConfig.FOCUS_REWARD_SCHEDULER)
    @SchedulerLock(name = "golden-fish-draw")
    public void drawDueIslands() {
        if (!gate.isOpen()) {
            return;
        }
        Instant minute = clock.instant().truncatedTo(ChronoUnit.MINUTES);
        for (UUID islandId : details.findIslandIdsWithAtLeast(
                FocusSessionLifecycle.ACTIVE, GoldenFishService.MIN_MEMBERS)) {
            try {
                goldenFish.drawAndCredit(islandId, minute);
            } catch (RuntimeException e) {
                // 건별 격리 — 이 분은 지나가지만 결과는 결정적이라 다음 분이 새로 추첨한다.
                log.error("황금 물고기 추첨 실패 — island={}, minute={}", islandId, minute, e);
            }
        }
    }
}
