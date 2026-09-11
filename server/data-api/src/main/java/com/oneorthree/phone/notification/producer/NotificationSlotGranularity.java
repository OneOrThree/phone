package com.oneorthree.phone.notification.producer;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;

import java.time.DayOfWeek;
import java.time.format.DateTimeFormatter;

/**
 * 결정적 사건 키의 <b>시간 축</b> — 같은 사건이 몇 번 감지되어도 한 키로 접히는 폭이다 (A22 ㊢).
 *
 * <p>구 경로의 dedup 은 저마다 다른 장치에 흩어져 있었다: 선점 UNIQUE
 * ({@code user_id, kind, subject_id}), 「당일 {@code sent_at}」 조회, 「최근 1분」 조회, 그리고
 * 아예 없는 것(리그·복귀 — 같은 날 두 번 부르면 두 번 나갔다). 새 경로는 그 전부를
 * <b>eventId 하나</b>로 옮긴다 — 소비 측 dedup 의 유일한 근거는 {@code eventId} 이기 때문이다
 * (계약 §3).
 *
 * <p>그래서 폭을 여기서 고정한다. 폭이 구 dedup 창보다 <b>좁으면</b> 중복 푸시가 나가고,
 * <b>넓으면</b> 매일 반복되는 알림(창 종료·미접속 복귀)이 첫날 이후 영영 안 나간다. 둘 다
 * 조용히 일어나므로 kind 마다 명시적으로 고른다.
 */
public enum NotificationSlotGranularity {

    /** 시간 축 없음 — 사건 자체가 1회성이다(챌린지 개설·승리 확정·회차 사일런트 flush). */
    NONE,

    /** 분 단위 — 구 「최근 1분」 dedup 창(친구 요청·수락)을 그대로 옮긴 폭이다. */
    MINUTE,

    /** 15분 슬롯 — 내기 묶음 슬롯({@code settled_at} 기준, N20)과 같은 축이다. */
    QUARTER_HOUR,

    /** KST 날짜 — 「당일 {@code sent_at}」 dedup(창 종료·일 목표 마감)과 매일 도는 크론이 쓴다. */
    DAY,

    /** KST 주(월요일 시작) — 주 1회 리그 결과처럼 주간 회차가 곧 사건인 것들. */
    WEEK;

    /** 판정 기준 시간대 — 크론·리그 도메인이 전부 KST 고정이라 여기도 같다. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private static final DateTimeFormatter DAY_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd");
    private static final Duration QUARTER = Duration.ofMinutes(15);

    /**
     * 사건 키에 들어갈 시간 축 문자열.
     *
     * @param at 사건 시각. {@link #NONE} 이면 쓰이지 않으므로 {@code null} 이어도 된다
     * @return 키 조각. 축이 없으면 {@code "none"}
     */
    public String bucketOf(Instant at) {
        if (this == NONE || at == null) {
            return "none";
        }
        return switch (this) {
            case MINUTE -> String.valueOf(at.truncatedTo(ChronoUnit.MINUTES).getEpochSecond());
            // 15분 슬롯은 «내림»이다 — 묶음 슬롯(BetEventNotificationService#slotOf)과 같은 계산이라야
            // 같은 슬롯의 두 사건이 같은 버킷에 든다.
            case QUARTER_HOUR -> String.valueOf(
                    at.getEpochSecond() - Math.floorMod(at.getEpochSecond(), QUARTER.toSeconds()));
            case DAY -> at.atZone(KST).toLocalDate().format(DAY_FORMAT);
            case WEEK -> at.atZone(KST).toLocalDate()
                    .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).format(DAY_FORMAT);
            default -> "none";
        };
    }
}
