package com.oneorthree.phone.notification.migration;

import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * 놓친 Data 잔류 크론 하나 — <b>ShedLock 이름 그대로</b> 가 식별자다 (A22 ㋦).
 *
 * <h2>왜 이 목록이 필요한가</h2>
 * 컷오버 창(구 발송 정지 → 신 수신 개방) 동안 Data 의 판정 크론은 돌지 않는다. 그 사이에 지나간
 * 슬롯의 알림은 <b>아무도 대신 만들어 주지 않는다</b> — 알림 서버는 코어 DB 를 읽지 않아 후보를
 * 다시 찾을 수 없고, Data 로 트리거를 부를 수도 없다(조회 3종뿐, 계약 §2). 그래서 재생은 Data 쪽
 * CLI 여야 한다.
 *
 * <h2>{@code validity} 가 이 enum 의 핵심이다</h2>
 * 놓친 크론을 전부 되돌리면 안 된다. 「리그 마감까지 4시간!」을 마감이 지난 뒤에 보내면 그건
 * <b>거짓말</b>이고, 사용자에게는 서비스가 고장난 것으로 보인다. 반대로 주간 결과 발표처럼
 * 「일어난 사실의 통보」는 하루 늦어도 여전히 맞다.
 *
 * <p>그래서 종류마다 «사건 시각으로부터 언제까지 유효한가»를 못 박고, 그 밖이면 <b>건너뛴다</b>.
 * 건너뛴 것은 실패가 아니라 정책이므로 보고서에 {@code SKIPPED_EXPIRED} 로 남는다 — 「보냈다」로
 * 기록하지 않는다. 과거 슬롯을 성공으로 기록하면 그 슬롯은 다시는 점검되지 않는다.
 */
public enum NotificationCronReplayJob {

    /**
     * 주간 리그 결과 발표(월 07:00 KST). <b>일어난 사실의 통보</b>라 늦어도 유효하다 — 다만 다음 주가
     * 시작되면 「저번 주 결과」가 두 주 전 이야기가 되므로 한 주까지다.
     */
    LEAGUE_WEEKLY_RESULTS("notification-league-weekly-results", Duration.ofDays(7)),

    /** 마감 4시간 전(일 20:00). 마감(월 00:00)까지만 유효하다. */
    LEAGUE_DEADLINE("notification-league-deadline", Duration.ofHours(4)),

    /** 일요일 위기 알림(일 09:00) — 강등 경고 + 마감 D-1. 그날 자정까지. */
    LEAGUE_SUNDAY_CRISIS("notification-league-sunday-crisis", Duration.ofHours(15)),

    /** 강등 경고 저녁 재발송(일 18:00). 마감까지 6시간. */
    LEAGUE_RELEGATION_WARNING("notification-league-relegation-warning", Duration.ofHours(6)),

    /** 마감 2시간 전(일 22:00). 이름 그대로 2시간. */
    LEAGUE_FINAL_DEADLINE("notification-league-final-deadline", Duration.ofHours(2)),

    /**
     * 미접속 복귀(매일 10:00). 「정확히 N일째」 판정이라 다음 날이 되면 <b>그 유저는 이미 다른
     * 단계</b>다 — 하루 늦게 보내면 D+3 문구가 D+4 사용자에게 간다. 조용한 시간 진입(23:00)까지.
     */
    INACTIVE_RETURN("notification-inactive-return", Duration.ofHours(13)),

    /** 오늘 미집중(평일 21:00). 「오늘」이 지나면 거짓이다 — 조용한 시간 진입까지 2시간. */
    MISSED_FOCUS_TODAY("notification-missed-focus-today", Duration.ofHours(2)),

    /** 스트릭 위기(22:00 / 일 21:00). 자정이면 이미 끊겼거나 지켜졌다. */
    STREAK_AT_RISK("notification-streak-at-risk", Duration.ofHours(2)),

    /**
     * 내기 사건 재훑기(15분). 자기 회복형이라 <b>지금 한 번 돌리면 48시간치를 스스로 회수한다</b> —
     * 슬롯별로 되돌릴 필요가 없고, 그래서 유효기간도 재훑기 창과 같은 48시간이다.
     */
    BET_EVENT_RESCAN("notification-bet-event-rescan", Duration.ofHours(48)),

    /**
     * 회차 참여 모집(15분). 슬롯 유예가 2시간이고, 그 밖은 구 경로도 포기하던 구간이다.
     * 참가 마감이 지났는지는 알림 서버의 적격성 조회가 한 번 더 본다.
     */
    SESSION_OPEN("notification-session-open", Duration.ofHours(2)),

    /** 창형 챌린지 창 종료(15분). 결과 통보라 그날 안이면 유효하다. */
    CHALLENGE_WINDOW_END("notification-challenge-window-end", Duration.ofHours(24)),

    /** 일 목표 챌린지 마감(매일 09:00). 어제치 결과 통보 — 조용한 시간 진입까지. */
    CHALLENGE_DURATION_END("notification-challenge-duration-end", Duration.ofHours(14));

    /**
     * 재생 대상이 <b>아닌</b> 크론과 그 이유. 목록에서 그냥 빼면 「빠뜨린 것」과 구분되지 않는다.
     *
     * <ul>
     *   <li>{@code notification-rank-overtake} — A5 폐기. 신 카탈로그에 kind 자체가 없다.</li>
     *   <li>{@code notification-bet-event-flush} — 발송은 알림 서버 소유다. Data의 결과 슬롯 완료는
     *       내구 원장에서 매 5분 재개하므로 별도 과거 시각 재생이 필요 없다.</li>
     *   <li>{@code notification-silent-flush} — {@code settle_after − 15분} 창의 사일런트다.
     *       정산이 이미 지났으면 깨워 봐야 flush 할 것이 없고, 포그라운드 sync 가 최후 보루다.</li>
     *   <li>{@code group-bet-freeze-monitor} — 사용자 발송이 아니라 운영 로그다.</li>
     * </ul>
     */
    public static final List<String> NOT_REPLAYABLE = List.of(
            "notification-rank-overtake",
            "notification-bet-event-flush",
            "notification-silent-flush",
            "group-bet-freeze-monitor");

    private final String lockName;
    private final Duration validity;

    NotificationCronReplayJob(String lockName, Duration validity) {
        this.lockName = lockName;
        this.validity = validity;
    }

    /** @return ShedLock 이름 — 운영자가 로그에서 보는 것과 같은 문자열이다 */
    public String lockName() {
        return lockName;
    }

    /** @return 사건 시각으로부터 이 기간 안에서만 재생한다 */
    public Duration validity() {
        return validity;
    }

    /**
     * 이름으로 찾는다 — enum 이름과 ShedLock 이름 둘 다 받는다.
     *
     * @param name 찾을 이름
     * @return 찾은 잡. 없으면 {@code null}
     */
    public static NotificationCronReplayJob find(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        String trimmed = name.trim();
        return Arrays.stream(values())
                .filter(job -> job.lockName.equalsIgnoreCase(trimmed)
                        || job.name().equalsIgnoreCase(trimmed.toUpperCase(Locale.ROOT)))
                .findFirst()
                .orElse(null);
    }
}
