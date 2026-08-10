package com.oneorthree.phone.group.service;

import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.domain.GroupChallengeWindow;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Collection;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * FOCUS 창(TIME_WINDOW) 집계 — focus_sessions 를 날짜별 창으로 클리핑해 유저별 창 내 집중 분을 구한다.
 *
 * <p>카드 진행률·myAchievedNow(B2a)와 정산 판정(B2b)이 <b>같은 소스</b>를 쓰도록 분리한 순수 컴포넌트다.
 *
 * <p><b>창 해석(KST)</b>: TIME_WINDOW 는 요일 반복 시간대다. 저장된 window_start/end 는 KST 벽시계
 * 시각(time 타입, V35 · GROMO-1406)이고 항상 시작 &lt; 종료다(자정 걸침 금지 §A6-1 — DB CHECK).
 * 날짜 D 의 실제 창은 D(KST)에 그 시각을 얹어 조합한다 — 창의 모든 시각이 회차일 D 안에서 끝난다.
 *
 * <p><b>판정 기준</b>: 창 판정은 세션 겹침 길이에서 <b>방해 비율만큼을 뺀</b> 순수 집중 시간이다
 * (GROMO-1214 코드리뷰 ⑥ — daily_focus_stats 의 total_focus_seconds·by-category 와 같은 기준).
 * 차감 공식은 {@code FocusSessionRepository.sumOverlapSecondsInWindow} 참고.
 * ⚠️ 이 값이 달성 판정 → 내기 정산을 가른다: 일시정지 시간으로 창을 통과하던 유저는 이제 미달성이 된다.
 * ACTIVE(미종료)·CANCELED·AUTO_CLOSED 세션은 제외한다.
 * 겹침의 종료측은 완료 시점에 고정한 유효 종료(stat_end_at, 레거시 행은 ended_at 폴백)다 — 미래 종료로
 * 위조한 세션의 미경과 꼬리가 내기 정산에 계상되지 않게(GROMO-1252 6차 ①, sumOverlapSecondsInWindow).
 * 달성 플래그만 {@link #WINDOW_FOCUS_TOLERANCE_MINUTES} 관용치를 적용하고(합 ≥ 목표 − 5분),
 * 진행률 표시값은 실측 그대로 둔다.
 */
@Component
@RequiredArgsConstructor
public class WindowFocusAggregator {

    /** 창 달성 관용치(분) — 판정 소스 단일 상수. UI 안내 문구("5분 모자라도 달성 인정")와 짝이다. */
    public static final int WINDOW_FOCUS_TOLERANCE_MINUTES = 5;

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /** 응답 표기 포맷 — {@link #timeOfDayString} 전용. */
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm:ss");

    /** 신형 요청 표기 판별 — "HH:mm" 또는 "HH:mm:ss"(GROMO-1225). 이 꼴이 아니면 구앱 ISO Instant 로 간주한다. */
    private static final Pattern REQUEST_TIME_PATTERN = Pattern.compile("\\d{2}:\\d{2}(:\\d{2})?");

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
        return date.atTime(window.getWindowStart()).atZone(KST).toInstant();
    }

    /**
     * 날짜 D 의 창 종료 Instant — 종료일은 <b>항상 회차일 D</b> 다. 자정 걸침 금지(§A6-1)로
     * 시작 &lt; 종료가 DB CHECK 불변식이라 종전의 {@code D+1} 분기(GROMO-1406 되돌리기)가 없다.
     */
    public Instant windowEndOn(LocalDate date, GroupChallengeWindow window) {
        return date.atTime(window.getWindowEnd()).atZone(KST).toInstant();
    }

    /**
     * 구앱 ISO Instant 창 시각의 KST 벽시계 해석 — {@link #parseRequestTime} 의 레거시 경로 전용.
     * 종전에는 저장 Instant 의 UTC 시각을 KST 벽시계로 간주해 정확히 9시간 어긋났다(GROMO-1100) —
     * KST 해석으로 통일한다. 저장이 time 타입(V35)이 된 뒤 창 저장·응답 경로에서는 더 쓰지 않는다.
     */
    public static LocalTime timeOfDay(Instant instant) {
        return LocalTime.ofInstant(instant, KST);
    }

    /**
     * 창 시각 요청 문자열의 <b>파싱 입구</b>(GROMO-1225) — 응답 {@link #timeOfDayString} 와 대칭인 단일 변환점.
     * 요청 경로마다 파싱을 새로 만들지 말고 반드시 이 메서드를 거칠 것.
     *
     * <p>신앱은 {@code "HH:mm:ss"}(또는 {@code "HH:mm"})를, 구앱은 ISO Instant
     * ({@code 2026-08-05T09:00:00+09:00} 꼴)를 보낸다 — 이중 수용해 같은 KST 벽시계 시각으로 수렴시킨다.
     * 구앱 경로는 기존 {@link #timeOfDay} 를 그대로 경유하므로 종전 저장 의미(Instant 의 KST 시각)가
     * 그대로 보존된다. 저장은 time 타입(V35)이라 반환도 {@link LocalTime} 그 자체다 — 종전의
     * EPOCH 날짜부 앵커 규약은 타입 전환과 함께 폐기됐다.
     *
     * @throws DateTimeParseException 두 형식 모두 아닐 때 — 호출부가 INVALID_MISSION_PARAMS 로 매핑한다
     */
    public static LocalTime parseRequestTime(String value) {
        return REQUEST_TIME_PATTERN.matcher(value).matches()
                ? LocalTime.parse(value)
                : timeOfDay(Instant.parse(value));
    }

    /**
     * 창 시각의 응답 표기 — {@code "HH:mm:ss"} 문자열. {@code /challenges} 목록과 그룹 상세·오버뷰
     * (GROMO-1206)가 같은 문자열을 내보내는 단일 출구다 — 응답 경로마다 포맷을 새로 만들지 말 것.
     */
    public static String timeOfDayString(LocalTime time) {
        return time.format(TIME_FORMATTER);
    }
}
