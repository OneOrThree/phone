package com.oneorthree.phone.notification.producer;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;

import java.time.DayOfWeek;
import java.time.format.DateTimeFormatter;
import java.util.List;

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

    /**
     * 분 단위 — 구 「최근 1분」 dedup 창(친구 요청·수락)을 옮긴 폭이다.
     *
     * <p>이 버킷은 달력상의 분으로 절삭한 <b>고정 버킷</b>이지 «최근 1분»이 아니다. 그래서 쓰기 키만으로는
     * 폭이 모자란다 — {@link #lookupBucketsOf} 가 경계에서 인접 버킷까지 함께 대조한다.
     */
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
    private static final Duration MINUTE_WIDTH = Duration.ofMinutes(1);

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

    /**
     * 중복 판정에서 <b>함께 대조할</b> 버킷들 — 첫 원소는 언제나 쓰기 버킷({@link #bucketOf})이다.
     *
     * <h2>왜 쓰기 버킷 하나로는 모자란가</h2>
     * {@link #MINUTE} 은 달력상의 분으로 절삭한 고정 버킷이다. 버전 필드가 없는 친구 요청의 재개·수락은
     * 동시에 처리된 둘이 각자 자기 {@code updatedAt} 을 쓰므로, 그 둘이 {@code 12:00:59} 와
     * {@code 12:01:01} 로 갈리면 <b>서로 다른 키</b>가 되어 outbox 두 행 · 푸시 두 번이 나간다.
     * {@code FriendNotificationService} 가 말하는 「최근 1분 중복 억제」 계약이 그 자리에서 깨진다.
     *
     * <p>쓰기 키는 결정적이어야 하므로 그대로 두고, <b>찾을 때만</b> 앞뒤 버킷을 같이 본다. 그래야 폭이
     * 고정 버킷이 아니라 실제 1분 구간이 된다.
     *
     * <h2>다른 축은 넓히지 않는다</h2>
     * {@link #DAY}·{@link #WEEK} 는 <b>매일·매주 반복되는</b> 알림의 축이다. 인접 버킷까지 접으면
     * 어제 보낸 것 때문에 오늘 것이 사라진다 — 이 파일 머리말이 말하는 「넓으면 첫날 이후 영영 안
     * 나간다」가 정확히 그 모양이다. {@link #QUARTER_HOUR} 는 내기 묶음 슬롯과 <b>같은 축</b>이라
     * 넓히면 슬롯 경계가 어긋난다.
     *
     * @param at 사건 시각
     * @return 대조할 버킷 — 첫 원소가 쓰기 버킷
     */
    public List<String> lookupBucketsOf(Instant at) {
        String bucket = bucketOf(at);
        if (this != MINUTE || at == null) {
            return List.of(bucket);
        }
        return List.of(bucket,
                bucketOf(at.minus(MINUTE_WIDTH)),
                bucketOf(at.plus(MINUTE_WIDTH)));
    }
}
