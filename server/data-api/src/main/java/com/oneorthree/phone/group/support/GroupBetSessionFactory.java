package com.oneorthree.phone.group.support;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupBetStatus;
import com.oneorthree.phone.group.repository.domain.GroupChallenge;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBet;
import com.oneorthree.phone.group.repository.domain.GroupChallengeBetSession;
import com.oneorthree.phone.group.repository.domain.MissionCategory;
import com.oneorthree.phone.group.service.GroupBetJudge;
import com.oneorthree.phone.group.service.WindowFocusAggregator;
import com.oneorthree.phone.group.service.GroupBetService;
import com.oneorthree.phone.group.service.GroupBetSessionOpeningService;
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
 * <p>시각 계산: 하루형은 회차일 00:00 ~ 익일 00:00(KST), 창형은 창 시작 ~ 창 종료로 <b>둘 다
 * 회차일 안</b>이다(자정 걸침 금지 §A6-1). {@code joinClosesAt} 은 LLD §1.1 정의(창형 = 창 시작, 하루형 = 회차
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
            // 창 시각은 회차 스냅샷의 벽시계 값 그대로다 — V35(GROMO-1406) 이후 저장이 time 타입이라
            // Instant→LocalTime 변환(WindowFocusAggregator.timeOfDay)이 더는 없다.
            windowStart = target.windowStart();
            windowEnd = target.windowEnd();
            // 창 시각 → Instant 변환은 WindowFocusAggregator 단일 변환점을 지난다(GROMO-1280) —
            // 여기서 KST 산술을 다시 쓰면 개설 시각 박제가 판정 쪽과 조용히 갈라진다. 창 종료는 항상
            // 회차일이다(V35 의 DB CHECK window_start < window_end 로 자정 걸침 금지 §A6-1) — 판정
            // 소스·정산 대기 가드(GroupBetSettler.windowEndOf)와 같은 규칙임이 이 호출로 드러난다.
            startsAt = WindowFocusAggregator.windowStartOn(sessionDate, windowStart);
            closesAt = WindowFocusAggregator.windowEndOn(sessionDate, windowEnd);
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
            return WindowFocusAggregator.windowStartOn(date, target.windowStart());
        }
        return date.plusDays(1).atStartOfDay(KST).toInstant();
    }
}
