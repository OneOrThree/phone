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
 * <p><b>창 해석(KST 앵커)</b>: TIME_WINDOW 는 활성 요일마다 반복되는 시간대다. 저장된
 * window_start/window_end 는 Asia/Seoul 벽시계 시각({@code time}, V32)이고, 날짜 D 의 실제 창은
 * D(KST)에 그 시각을 얹어 조합한다. <b>창은 자정을 걸칠 수 없으므로</b>(정책 §A6-1, 결정 N25 —
 * 생성 검증과 V32 CHECK 가 시작 &lt; 종료를 강제한다) 시작·종료가 모두 같은 날짜 D 에 얹힌다.
 * 시간 모델 어디에도 D+1 이 등장하지 않는다.
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
        return startOn(date, window.getWindowStart());
    }

    /** 날짜 D 의 창 종료 Instant — D(KST) + 종료 시각. 자정 걸침이 없으니 종료일도 항상 D 다. */
    public Instant windowEndOn(LocalDate date, GroupChallengeWindow window) {
        return endOn(date, window.getWindowEnd());
    }

    /** 회차일 D 의 창 시작 — 저장된 KST 벽시계 시각을 D 에 얹는다. */
    public static Instant startOn(LocalDate date, LocalTime start) {
        return date.atTime(start).atZone(KST).toInstant();
    }

    /**
     * 회차일 D 의 창 종료 — 종료일은 <b>항상</b> D 다(정책 §A6-1).
     *
     * <p>자정 걸침을 허용하던 시절에는 {@code start.isBefore(end) ? date : date.plusDays(1)} 분기가
     * 있었고, 그래서 시작 시각까지 인자로 받아야 했다. 걸침이 금지되면서 분기도 인자도 사라졌다.
     */
    public static Instant endOn(LocalDate date, LocalTime end) {
        return date.atTime(end).atZone(KST).toInstant();
    }

    /**
     * Instant 의 <b>Asia/Seoul 벽시계 시각(time-of-day)</b>. 창 시각은 V32 부터 {@code time} 으로
     * 저장되므로 이 변환은 <b>구앱이 보낸 ISO Instant 를 받는 입구</b>({@link #parseRequestTime})에서만 쓴다.
     *
     * <p>앱은 창 시각을 {@code +09:00} 오프셋의 진짜 Instant 로 보낸다. 종전에는 저장 Instant 의
     * UTC 시각을 KST 벽시계로 간주해 정확히 9시간 어긋났다(GROMO-1100) — KST 해석으로 통일한다.
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
     * <b>수용하는 두 표기(계약)는 그대로다.</b> V32 에서 저장 타입이 {@code time} 이 되며 반환만
     * {@code Instant}(EPOCH 날짜 앵커) → {@link LocalTime} 으로 좁혀졌다 — 날짜부라는 무의미한
     * 자유도가 사라진 것이라 의미 손실이 없다.
     *
     * @throws DateTimeParseException 두 형식 모두 아닐 때 — 호출부가 INVALID_MISSION_PARAMS 로 매핑한다
     */
    public static LocalTime parseRequestTime(String value) {
        return REQUEST_TIME_PATTERN.matcher(value).matches()
                ? LocalTime.parse(value)
                : timeOfDay(Instant.parse(value));
    }

    /**
     * 창 시각의 응답 표기 — {@code "HH:mm:ss"}. {@code /challenges} 목록과 그룹 상세·오버뷰
     * (GROMO-1206)가 같은 문자열을 내보내는 단일 출구다 — 응답 경로마다 포맷을 새로 만들지 말 것.
     */
    public static String timeOfDayString(LocalTime time) {
        return time.format(TIME_FORMATTER);
    }
}
