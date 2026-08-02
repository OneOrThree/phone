package com.oneorthree.phone.group.service;

import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * FOCUS 창(TIME_WINDOW) 집계 — focus_sessions 를 날짜별 창으로 클리핑해 유저별 창 내 집중 분을 구한다.
 *
 * <p>카드 진행률·myAchievedNow(B2a)와 정산 판정(B2b)이 <b>같은 소스</b>를 쓰도록 분리한 순수 컴포넌트다.
 *
 * <p><b>창 해석(KST 앵커)</b>: TIME_WINDOW 는 매일 반복 시간대다. 저장된 window_start_at/end_at(Instant)
 * 은 UTC 시각(time-of-day)만 의미를 갖고(응답의 "HH:mm:ss" 변환과 동일 기준), 날짜 D 의 실제 창은
 * D(KST)에 그 시각을 얹어 조합한다. 시작 ≥ 종료면 자정 걸침 창 — D 의 시작 ~ D+1 의 종료로 해석한다.
 *
 * <p><b>판정 기준</b>: 창 판정은 세션 겹침 길이 기준이다(방해시간 미차감 — daily_focus_stats 의
 * total_focus_seconds 도 미차감이라 동일 기준). ACTIVE(미종료)·CANCELED·AUTO_CLOSED 세션은 제외한다.
 * 달성 플래그만 {@link #WINDOW_FOCUS_TOLERANCE_MINUTES} 관용치를 적용하고(합 ≥ 목표 − 5분),
 * 진행률 표시값은 실측 그대로 둔다.
 */
@Component
@RequiredArgsConstructor
public class WindowFocusAggregator {

    /** 창 달성 관용치(분) — 판정 소스 단일 상수. UI 안내 문구("5분 모자라도 달성 인정")와 짝이다. */
    public static final int WINDOW_FOCUS_TOLERANCE_MINUTES = 5;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final FocusSessionRepository focusSessionRepository;

    /**
     * 날짜 {@code date}(KST) 의 창 내 집중 분(유저별, 실측·초→분 내림 — GROMO-642 관례).
     * 창과 겹치는 세션이 없는 유저는 키가 없다(FOCUS 는 데이터 없음 = 0분이 사실).
     */
    public Map<UUID, Integer> focusMinutesWithin(Collection<UUID> userIds, LocalDate date,
            GroupChallengeWindow window) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return focusSessionRepository
                .sumOverlapSecondsInWindow(userIds, windowStartOn(date, window), windowEndOn(date, window))
                .stream()
                .collect(Collectors.toMap(
                        FocusSessionRepository.WindowFocusOverlap::getUserId,
                        overlap -> (int) (overlap.getOverlapSeconds() / 60)));
    }

    /** 달성 판정 — 관용치 적용(실측 분 ≥ 목표 − 5분). 진행률 표시값에는 쓰지 말 것(표시는 실측 그대로). */
    public static boolean isAchieved(int focusMinutes, int goalMinutes) {
        return focusMinutes >= goalMinutes - WINDOW_FOCUS_TOLERANCE_MINUTES;
    }

    /** 날짜 D 의 창 시작 Instant — D(KST) + 시작 시각. */
    public Instant windowStartOn(LocalDate date, GroupChallengeWindow window) {
        return date.atTime(timeOfDay(window.getWindowStartAt())).atZone(KST).toInstant();
    }

    /** 날짜 D 의 창 종료 Instant — 시작 < 종료면 D, 아니면(자정 걸침) D+1 의 종료 시각. */
    public Instant windowEndOn(LocalDate date, GroupChallengeWindow window) {
        LocalTime start = timeOfDay(window.getWindowStartAt());
        LocalTime end = timeOfDay(window.getWindowEndAt());
        LocalDate endDate = start.isBefore(end) ? date : date.plusDays(1);
        return endDate.atTime(end).atZone(KST).toInstant();
    }

    /**
     * 창 Instant 의 의미 있는 부분 — UTC 시각(time-of-day). 생성 검증·겹침 판정({@code GroupChallengeService})·
     * 집계 경계(여기)·응답 "HH:mm:ss" 변환이 전부 이 <b>단일 기준</b>을 쓴다 — 한쪽만 바뀌어 조용히
     * 갈라지지 않도록 공용으로 노출한다(PR #438 리뷰).
     */
    public static LocalTime timeOfDay(Instant instant) {
        return LocalTime.ofInstant(instant, ZoneOffset.UTC);
    }
}
