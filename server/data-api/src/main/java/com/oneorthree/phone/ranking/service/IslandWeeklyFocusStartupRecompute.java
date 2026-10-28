package com.oneorthree.phone.ranking.service;

import com.oneorthree.phone.ranking.support.RankingWeek;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;

/**
 * 기동이 끝나면 «이번 주» 주간 섬 랭킹 분자(read model)를 정본으로 한 번 다시 채우는 운영 손잡이 (GROMO-2349).
 *
 * <p>{@link IslandWeeklyFocusService#recompute} 는 HTTP 표면이 없고 주 마감 크론(지난 주)만 부른다. 이번 주 값이
 * 배포 창·장애로 어긋났을 때 바로잡을 길이 필요해서, 환경 변수로 켜는 기동 옵션으로 둔다. 새 엔드포인트도 새 비밀도
 * 만들지 않는다. 기본은 꺼짐이다 — {@code ranking.weekly-focus.recompute-on-startup}
 * ({@code RANKING_WEEKLY_FOCUS_RECOMPUTE_ON_STARTUP}).
 *
 * <p>결과는 멱등이다 — 정본에서 그 주를 지우고 다시 채우므로 몇 번을 돌려도 같은 값이다. 인스턴스가 여럿이어도
 * 각자 돌 뿐이고, 서로는 {@code island_weekly_focus} 테이블 잠금에서 줄을 선다(진행 중 집중 완료의 가산도 같은 잠금으로
 * 직렬화된다).
 *
 * <p><b>한 번 돌린 뒤에는 스위치를 다시 끈다.</b> 켜 둔 채로 두면 재기동·재배포마다 테이블 잠금(수 초)을 쥔다. 절차와
 * 대조 SQL 은 {@code docs/prd/fishcat/island-rankings/ops-runbook.md}.
 *
 * <p>{@code recompute} 는 활성 트랜잭션 안에서 부르면 거절한다. 준비 완료 리스너는 트랜잭션 밖에서 돌므로 여기서
 * 트랜잭션을 열지 않는다. 실패해도 기동은 이미 끝난 뒤라 앱은 정상으로 남는다 — 다만 준비 완료 리스너의 예외가 번지지
 * 않게 여기서 error 로그로 남기고 삼킨다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "ranking.weekly-focus.recompute-on-startup", havingValue = "true")
public class IslandWeeklyFocusStartupRecompute {

    private final IslandWeeklyFocusService weeklyFocus;
    private final Clock clock;

    /** 기동 직후 이번 주(UTC 일요일 시작)를 다시 채운다. 실패는 error 로그만 남기고 삼킨다. */
    @EventListener(ApplicationReadyEvent.class)
    public void recomputeCurrentWeek() {
        LocalDate week = RankingWeek.weekStart(clock.instant());
        try {
            weeklyFocus.recompute(week);
        } catch (RuntimeException e) {
            log.error("기동 시 주간 섬 랭킹 분자 재계산 실패 week={} — 다시 하려면 재배포한다", week, e);
        }
    }
}
