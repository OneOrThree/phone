package com.oneorthree.phone.focus.scheduler;

import com.oneorthree.phone.focus.repository.FocusLiveActivityRepository;
import com.oneorthree.phone.focus.service.FocusLiveActivityService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;

/** DB의 최신 전이 상태와 성공 버전으로 서버 재시작·일시 전송 실패 뒤에도 수렴한다. */
@Component
@RequiredArgsConstructor
@Slf4j
public class FocusLiveActivityScheduler {
    private final FocusLiveActivityRepository activities;
    private final FocusLiveActivityService service;
    private final Clock clock;

    @Scheduled(fixedDelayString = "${focus.live-activity.poll-ms:5000}")
    @SchedulerLock(name = "focus-live-activity", lockAtMostFor = "PT3M")
    public void tick() {
        // 최대 20건 × 5초 HTTP 제한. 한 건 실패가 다음 세션의 종료를 막지 않는다.
        for (var sessionId : activities.findDue(clock.instant(), PageRequest.of(0, 20))) {
            try {
                service.deliver(sessionId);
            } catch (RuntimeException e) {
                log.warn("Live Activity 상태 반영 실패: {}", e.getClass().getSimpleName());
            }
        }
    }
}
