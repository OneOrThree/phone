package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.domain.GroupBetStatus;
import com.oneorthree.phone.group.domain.GroupChallenge;
import com.oneorthree.phone.group.domain.GroupChallengeBet;
import com.oneorthree.phone.group.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.domain.MissionCategory;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;

/**
 * 회차 행 조립의 단일 지점 — <b>미션 스냅샷 박제</b>(GROMO-1263): 카테고리·방식·목표분·창 시각·
 * 참가비를 챌린지·설정에서 복사한다. 챌린지가 삭제돼도 내역 한 줄이 조인 없이 온전해야 한다(N6-1).
 *
 * <p>레거시 개설 브리지({@link GroupBetService})와 자동 개설({@link GroupBetSessionOpeningService},
 * N35)이 <b>같은 조립</b>을 쓴다 — 갈라지면 개설 경로에 따라 마감·정산 시각이 달라진다.
 *
 * <p>시각 계산: 하루형은 회차일 00:00 ~ 익일 00:00(KST), 창형은 창 시작 ~ 창 종료(자정 걸침
 * 레거시 창은 익일 종료). {@code joinClosesAt} 은 LLD §1.1 정의(창형 = 창 시작, 하루형 = 회차
 * 종료)대로 박제하되, 브리지 기간의 레거시 참가 가드는 종전 규칙(창 종료까지)을 유지한다.
 */
@Component
public class GroupBetSessionFactory {

    /** 창형 정산 그레이스(분) — 늦게 확정되는 창 데이터를 받는 여유(N12). settle_after = 창 종료 + 30분. */
    static final int WINDOW_SETTLE_GRACE_MINUTES = 30;

    /** 하루형 FOCUS 정산 그레이스(시간) — 자정 넘겨 끝난 세션 수용(종전 01:00 배치와 짝). */
    static final int DURATION_FOCUS_SETTLE_GRACE_HOURS = 1;

    /** 하루형 SCREEN_TIME 정산 그레이스(시간) — 다음날 첫 앱 실행 보고 수용(종전 12:00 배치와 짝). */
    static final int DURATION_SCREEN_TIME_SETTLE_GRACE_HOURS = 12;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    public GroupChallengeBetSession create(GroupChallengeBet bet, Group group,
            GroupChallenge challenge, GroupBetJudge.Target target, LocalDate sessionDate) {
        LocalTime windowStart = null;
        LocalTime windowEnd = null;
        Instant startsAt;
        Instant closesAt;
        Instant joinClosesAt;
        Instant settleAfter;
        if (target.windowed()) {
            windowStart = WindowFocusAggregator.timeOfDay(target.window().getWindowStartAt());
            windowEnd = WindowFocusAggregator.timeOfDay(target.window().getWindowEndAt());
            startsAt = sessionDate.atTime(windowStart).atZone(KST).toInstant();
            LocalDate endDate = windowStart.isBefore(windowEnd) ? sessionDate : sessionDate.plusDays(1);
            closesAt = endDate.atTime(windowEnd).atZone(KST).toInstant();
            joinClosesAt = startsAt;
            settleAfter = closesAt.plusSeconds(WINDOW_SETTLE_GRACE_MINUTES * 60L);
        } else {
            startsAt = sessionDate.atStartOfDay(KST).toInstant();
            closesAt = sessionDate.plusDays(1).atStartOfDay(KST).toInstant();
            joinClosesAt = closesAt;
            int graceHours = target.category() == MissionCategory.SCREEN_TIME
                    ? DURATION_SCREEN_TIME_SETTLE_GRACE_HOURS
                    : DURATION_FOCUS_SETTLE_GRACE_HOURS;
            settleAfter = closesAt.plusSeconds(graceHours * 3600L);
        }
        return GroupChallengeBetSession.builder()
                .bet(bet)
                .group(group)
                .challenge(challenge)
                .sessionDate(sessionDate)
                .stake(bet.getStake())
                .goalMinutes(target.goalMinutes())
                .missionCategory(challenge.getCategory())
                .missionType(challenge.getType())
                .windowStart(windowStart)
                .windowEnd(windowEnd)
                .status(GroupBetStatus.OPEN)
                .startsAt(startsAt)
                .joinClosesAt(joinClosesAt)
                .closesAt(closesAt)
                .settleAfter(settleAfter)
                .build();
    }

    /** 날짜 {@code date} 회차의 참가 마감(LLD §1.1) — 창형은 창 시작, 하루형은 회차 종료(익일 00:00). */
    public Instant joinClosesAtOn(GroupBetJudge.Target target, LocalDate date) {
        if (target.windowed()) {
            return date.atTime(WindowFocusAggregator.timeOfDay(target.window().getWindowStartAt()))
                    .atZone(KST).toInstant();
        }
        return date.plusDays(1).atStartOfDay(KST).toInstant();
    }
}
