package com.oneorthree.phone.group.service;

import com.oneorthree.phone.focus.repository.FocusSessionRepository;
import com.oneorthree.phone.group.repository.domain.GroupChallengeWindow;
import com.oneorthree.phone.group.support.GroupBetSessionFactory;
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
      *
      * @param userIds 집계 대상 유저 — 비어 있으면 쿼리 없이 빈 맵을 돌려준다
      * @param date 창을 얹을 날짜(KST)
      * @param window 창 시각의 출처인 CTI 상세 행
      * @return 유저별 창 내 집중 분(초→분 내림). 겹치는 세션이 없는 유저는 <b>키 자체가 없다</b> —
      *     FOCUS 는 「기록 없음 = 0분」이 사실이라 0 으로 채우지 않는다
     */
    public Map<UUID, Integer> focusMinutesWithin(Collection<UUID> userIds, LocalDate date,
            GroupChallengeWindow window) {
        return focusMinutesWithin(userIds, date, window.getWindowStart(), window.getWindowEnd());
    }

    /**
     * 벽시계 창 시각으로 직접 집계하는 판(GROMO-1280) — 판정 커널({@link GroupBetJudge})이 <b>회차
     * 스냅샷의 창 시각</b>으로 부른다. 챌린지 CTI 행이 사라져도 회차 판정이 성립해야 하기 때문에,
     * 집계 입구는 엔티티가 아니라 시각을 받는 쪽이 정본이다.
      *
      * @param userIds 집계 대상 유저 — 비어 있으면 쿼리 없이 빈 맵을 돌려준다
      * @param date 창을 얹을 날짜(KST)
      * @param windowStart 창 시작 벽시계 시각
      * @param windowEnd 창 종료 벽시계 시각 — 시작보다 뒤라 종료는 언제나 같은 날 안이다
      * @return 유저별 창 내 집중 분. 키가 없는 유저는 창과 겹친 세션이 하나도 없었다는 뜻이다
     */
    public Map<UUID, Integer> focusMinutesWithin(Collection<UUID> userIds, LocalDate date,
            LocalTime windowStart, LocalTime windowEnd) {
        if (userIds.isEmpty()) {
            return Map.of();
        }
        return focusSessionRepository
                .sumOverlapSecondsInWindow(userIds,
                        windowStartOn(date, windowStart), windowEndOn(date, windowEnd))
                .stream()
                .collect(Collectors.toMap(
                        FocusSessionRepository.WindowFocusOverlap::getUserId,
                        overlap -> (int) (overlap.getOverlapSeconds() / 60)));
    }

    /**
     * 달성 판정 — 관용치 적용(실측 분 ≥ 목표 − 5분). 진행률 표시값에는 쓰지 말 것(표시는 실측 그대로).
     *
     * @param focusMinutes 실측 집중 분
     * @param goalMinutes 회차에 박제된 목표 분
     * @return 관용치를 얹은 달성 여부 — 목표에 5분이 모자라도 true 다
     */
    public static boolean isAchieved(int focusMinutes, int goalMinutes) {
        return focusMinutes >= goalMinutes - WINDOW_FOCUS_TOLERANCE_MINUTES;
    }

    /**
     * 날짜 D 의 창 시작 Instant — CTI 엔티티 입력판(알림·집계 호출부 호환).
     *
     * @param date 창을 얹을 날짜(KST)
     * @param window 창 시작 시각의 출처
     * @return 그 날짜의 창이 열리는 순간
     */
    public Instant windowStartOn(LocalDate date, GroupChallengeWindow window) {
        return windowStartOn(date, window.getWindowStart());
    }

    /**
     * 날짜 D 의 창 종료 Instant — CTI 엔티티 입력판. 종료일은 <b>항상 회차일 D</b> 다(아래 참고).
     *
     * @param date 창을 얹을 날짜(KST)
     * @param window 창 종료 시각의 출처
     * @return 그 날짜의 창이 닫히는 순간
     */
    public Instant windowEndOn(LocalDate date, GroupChallengeWindow window) {
        return windowEndOn(date, window.getWindowEnd());
    }

    /**
     * 날짜 D 의 창 시작 Instant — 벽시계 시각 입력판. 창 시각 → Instant 변환은 <b>여기와
     * {@link #windowEndOn(LocalDate, LocalTime)} 둘뿐</b>이다(GROMO-1280): 정산 대기 가드·개설
     * 시각 박제·마감 판정이 저마다 KST 산술을 다시 쓰면 창 경계가 조용히 갈라진다.
      *
      * @param date 창을 얹을 날짜(KST)
      * @param windowStart 창 시작 벽시계 시각
      * @return 창이 열리는 순간
     */
    public static Instant windowStartOn(LocalDate date, LocalTime windowStart) {
        return date.atTime(windowStart).atZone(KST).toInstant();
    }

    /**
     * 날짜 D 의 창 종료 Instant — 벽시계 시각 입력판이고 종료일은 <b>항상 회차일 D</b> 다.
     * V35(GROMO-1406)가 자정 걸침을 DB CHECK({@code window_start < window_end})로 금지해(§A6-1)
     * 종전의 {@code D+1} 분기는 도달할 수 없다 — 죽은 분기를 남기면 개설 시각 박제
     * ({@link GroupBetSessionFactory})·정산 대기 가드({@link GroupBetSettler})와 규칙이 갈려 보인다.
     * 그래서 시작 시각을 아예 받지 않는다: 종료 경계는 종료 시각만으로 결정된다.
      *
      * @param date 창을 얹을 날짜(KST)
      * @param windowEnd 창 종료 벽시계 시각
      * @return 창이 닫히는 순간 — 자정 걸침이 금지돼 언제나 {@code date} 안이다
     */
    public static Instant windowEndOn(LocalDate date, LocalTime windowEnd) {
        return date.atTime(windowEnd).atZone(KST).toInstant();
    }

    /**
     * 구앱 ISO Instant 창 시각의 KST 벽시계 해석 — {@link #parseRequestTime} 의 레거시 경로 전용.
     * 종전에는 저장 Instant 의 UTC 시각을 KST 벽시계로 간주해 정확히 9시간 어긋났다(GROMO-1100) —
     * KST 해석으로 통일한다. 저장이 time 타입(V35)이 된 뒤 창 저장·응답 경로에서는 더 쓰지 않는다.
      *
      * @param instant 구앱이 보낸 절대 시각
      * @return 그 시각을 KST 로 읽은 벽시계 시각. UTC 로 읽으면 정확히 9시간 어긋난다
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
     * @param value 신앱의 {@code "HH:mm(:ss)"} 또는 구앱의 ISO Instant 문자열
     * @return 두 표기가 수렴한 KST 벽시계 시각 — 어느 쪽으로 들어와도 같은 값이 나온다
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
      *
      * @param time 응답에 실을 벽시계 시각
      * @return {@code "HH:mm:ss"} 문자열 — 초까지 항상 채워 나간다
     */
    public static String timeOfDayString(LocalTime time) {
        return time.format(TIME_FORMATTER);
    }
}
