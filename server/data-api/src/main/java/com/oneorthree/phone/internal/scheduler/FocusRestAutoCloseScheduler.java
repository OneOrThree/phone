package com.oneorthree.phone.internal.scheduler;

import com.oneorthree.phone.config.SchedulingConfig;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.internal.service.FocusSessionLifecycleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.UUID;

/**
 * 휴식 1시간 자동 종료 틱 (GROMO-1998) — {@code PAUSED} 로 들어간 지
 * {@link FocusSessionLifecycleService#REST_AUTO_CLOSE_AFTER} 를 넘긴 세션을 <b>정상 완료</b>로 끝낸다.
 *
 * <p><b>왜 「다음 접속에 판정」이 아니라 크론인가.</b> 정책이 「앱을 끄고 쉬는 주민도 자동 종료 전까지
 * <b>다른 주민의</b> 모닥불 화면에 그대로 보인다」라고 정했다 — 뒤집으면 1시간이 지나면 <b>본인이
 * 접속하지 않아도</b> 남의 화면에서 사라져야 한다. 본인 요청을 기다리는 지연 판정으로는 그 순간이
 * 오지 않는다. {@code rest_seat} 도 같은 이유로 제때 반납되어야 다음 사람이 그 자리를 쓴다.
 *
 * <p>{@code FocusRewardScheduler}·{@code IslandQuestScheduler} 와 같은 패턴이다: 이 클래스는 무트랜잭션
 * 이고 세션마다 수명주기 서비스가 자기 트랜잭션으로 돈다. 틱을 놓쳐도 다음 틱이 같은 후보를 다시
 * 집는다 — 판정 기준은 «틱이 돌았는가»가 아니라 «휴식 시작 시각»이라 지연은 늦음일 뿐 누락이 아니다.
 *
 * <p><b>게이트를 두지 않는다.</b> 적립 크론({@code FocusRewardAccrualGate})의 게이트는 혼합 버전 배포에서
 * 지급 주체가 둘이 되는 것을 막는 것이었는데, 여기에는 그 문제가 없다 — 종결은 상세 행 배타 잠금과
 * {@code focus_settlements} 의 세션당 1행(PK)이 막고, 옛 이미지는 이 크론을 아예 돌리지 않는다.
 * 롤링 배포 중에는 자동 종료가 «새 이미지를 잡은 인스턴스에서만» 돌 뿐이고, ShedLock 이 그 중 하나로
 * 좁힌다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class FocusRestAutoCloseScheduler {

    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionLifecycleService lifecycle;
    private final Clock clock;

    /**
     * 매분 30초 — 같은 1스레드 풀의 적립 틱({@code 0 * * * * *})과 초를 어긋나게 둔다. 둘 다 진행 세션
     * 전수 스캔이라 정각에 겹치면 한쪽이 다른 쪽을 기다린다.
     *
     * <p>정산 계열 풀이 아니라 집중 보상 풀에 얹는 것은 의도다 — 정산 풀은 내기 크론 셋에 맞춘 정확히
     * 3스레드이고({@code SchedulingConfig#settlementTaskScheduler}), 거기에 매분 스캔을 더하면 5분 경계마다
     * 돈 처리 하나가 늘 대기한다. 이 틱은 집중 세션을 훑는다는 점에서 적립 틱과 같은 부류다.
     *
     * <p>ponytail: 휴식 중 세션 전수 스캔이다. PAUSED 자체가 드물어 대개 0건이고, 1시간을 넘긴 것만
     * 걸리는 WHERE 라 DB 가 거른다. 섬 규모가 커지면 {@code (lifecycle, last_transition_at)} 인덱스가
     * 다음 단계다.
     */
    @Scheduled(cron = "30 * * * * *", zone = "UTC", scheduler = SchedulingConfig.FOCUS_REWARD_SCHEDULER)
    @SchedulerLock(name = "focus-rest-auto-close")
    public void closeTimedOutRests() {
        int closed = 0;
        for (UUID sessionId : focusSessionDetailRepository.findSessionIdsRestingSince(
                clock.instant().minus(FocusSessionLifecycleService.REST_AUTO_CLOSE_AFTER))) {
            try {
                if (lifecycle.autoCloseTimedOutRest(sessionId)) {
                    closed++;
                }
            } catch (RuntimeException e) {
                // 건별 격리 — 다음 틱이 같은 세션을 다시 집는다(판정 기준이 휴식 시작 시각이라 멱등).
                log.error("휴식 자동 종료 실패 — 다음 틱에 재시도. session={}", sessionId, e);
            }
        }
        if (closed > 0) {
            log.info("휴식 1시간 초과 집중 세션 자동 종료: {}건", closed);
        }
    }
}
