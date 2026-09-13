package com.oneorthree.phone.notification.producer;

import java.util.Arrays;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Data 가 <b>판정</b>하는 알림 종류 — 18종. 렌더·발송은 알림 서버가 한다 (A22 · 계약 §5).
 *
 * <p>이 enum 이 하는 일은 셋이다: ① 결정적 사건 키의 시간 축을 고정하고
 * ({@link NotificationSlotGranularity}), ② 조용한 시간 정책을 실어 보내고
 * ({@link NotificationQuietPolicy}), ③ 「이 kind 의 대상 id 가 무엇인가」를 이름으로 남긴다.
 *
 * <p><b>{@code RANK_OVERTAKE} 와 봇 계열은 없다</b> — A5 에서 폐기됐다. 구 코드에는
 * {@code RankOvertakeNotificationService} 와 크론이 남아 있지만 새 경로로 옮기지 않는다.
 * 「일단 옮겨 두고 끄면 된다」는 이관 뒤에 <b>끄는 것을 잊는 쪽</b>으로만 실패한다.
 *
 * <p>이름은 구 {@code NotificationSentLog.TYPE_*} 문자열과 <b>같은 값</b>이다(있는 것에 한해).
 * 앱이 {@code data.type} 문자열로 분기하고 있어서(GA4 {@code push_opened}·결과 모달 라우팅)
 * 여기서 이름을 바꾸면 구 바이너리의 라우팅이 조용히 끊긴다.
 */
public enum NotificationKind {

    // ── 리그 (LeagueNotificationService) ────────────────────────────────────────
    /** 주간 결과 — 승격·강등·유지. 주 1회라 축이 주다. params: {@code result}·티어. */
    LEAGUE_WEEKLY_RESULT(NotificationSlotGranularity.WEEK, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /** 마감 4시간 전 — 일 20:00. params: {@code rank}. */
    LEAGUE_DEADLINE(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /** 마감 D-1 승급 독려 — 일 09:00 분기의 한쪽. params: {@code shortfallSeconds}. */
    LEAGUE_DEADLINE_D1(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /** 강등 경고 — 일 09:00 위기 분기의 한쪽. params: {@code shortfallSeconds}. */
    LEAGUE_RELEGATION_WARNING(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /**
     * 강등 경고 <b>저녁 재발송</b> — 일 18:00. 문구는 {@link #LEAGUE_RELEGATION_WARNING} 과 같지만
     * kind 를 나눈다: 축이 날이라 같은 kind 로 두면 18:00 재발송이 09:00 키에 접혀 <b>영영 안 나간다</b>.
     * 「같은 문구니까 같은 kind」는 구 동작(의도된 하루 2회 발송)을 조용히 없앤다.
     */
    LEAGUE_RELEGATION_WARNING_EVENING(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP,
            SubjectKind.NONE),

    /** 마감 2시간 전 — 일 22:00. params: {@code rank}. */
    LEAGUE_FINAL_DEADLINE(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    // ── 리텐션 (InactiveReturn · LeagueReengagement) ───────────────────────────
    /** 미접속 복귀 — D+3·7·14 단계. params: {@code stage}. */
    INACTIVE_RETURN(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /** 오늘 미집중 — 평일 21:00. 렌더 입력 없음. */
    MISSED_FOCUS_TODAY(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    /** 스트릭 위기 — params: {@code streakCount}. */
    STREAK_AT_RISK(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.NONE),

    // ── 내기 (BetEvent · BetWon · SilentFlush) ─────────────────────────────────
    /** 내기 정산 결과. 대상 = 회차, 슬롯 = {@code settled_at} 15분(N20 묶음 축과 동일). */
    BET_RESULT(NotificationSlotGranularity.NONE, NotificationQuietPolicy.DEFER, SubjectKind.BET_SESSION),

    /** 무산 환불 통지(N48). 결과와 <b>같은 묶음 슬롯</b>을 쓴다 — 섞인 슬롯은 알림 서버가 한 건으로 요약한다. */
    BET_VOID_REFUND(NotificationSlotGranularity.NONE, NotificationQuietPolicy.DEFER, SubjectKind.BET_SESSION),

    /** 개인 승리 조기 확정(FR-43). 1회성이고 조용한 시간이면 버린다 — 결과는 {@link #BET_RESULT} 가 다시 알린다. */
    BET_WON(NotificationSlotGranularity.NONE, NotificationQuietPolicy.DROP, SubjectKind.BET_SESSION),

    /** 정산 직전 사일런트 flush(FR-22) — 표시가 아니라 앱 기동 신호라 조용한 시간을 타지 않는다. */
    BET_SILENT_FLUSH(NotificationSlotGranularity.NONE, NotificationQuietPolicy.BYPASS, SubjectKind.BET_SESSION),

    /** 회차 참여 모집(N40). 이월하되 참가 마감에서 만료된다 — {@code params.deferExpiresAt}. */
    CHALLENGE_SESSION_OPEN(NotificationSlotGranularity.NONE, NotificationQuietPolicy.DEFER_UNTIL,
            SubjectKind.BET_SESSION),

    // ── 챌린지 (ChallengeEndPushDispatcher · ChallengeCreated) ─────────────────
    /** 창형 챌린지 창 종료(B4). 창은 매일 반복이라 축이 날이다. 대상 = 챌린지. */
    CHALLENGE_WINDOW_END(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.CHALLENGE),

    /** 일 목표형 하루 마감. 이름이 {@code CHALLENGE_ENDED} 인 것은 구 앱 딥링크 폴백 때문이다. */
    CHALLENGE_ENDED(NotificationSlotGranularity.DAY, NotificationQuietPolicy.DROP, SubjectKind.CHALLENGE),

    /** 그룹에 새 챌린지 개설. 1회성. params: {@code groupName}·구조화 목표 {@code mission}. */
    CHALLENGE_CREATED(NotificationSlotGranularity.NONE, NotificationQuietPolicy.DROP, SubjectKind.CHALLENGE),

    // ── 친구 (FriendNotificationService) ───────────────────────────────────────
    /** 친구 요청 도착. 대상 = 보낸 유저. 축이 분인 것은 구 「최근 1분」 dedup 창을 그대로 옮긴 것이다. */
    FRIEND_REQUEST(NotificationSlotGranularity.MINUTE, NotificationQuietPolicy.DROP, SubjectKind.COUNTERPART_USER),

    /** 보낸 요청이 수락됨. 대상 = 수락한 유저. */
    FRIEND_ACCEPTED(NotificationSlotGranularity.MINUTE, NotificationQuietPolicy.DROP, SubjectKind.COUNTERPART_USER);

    /** {@code subjectId} 가 가리키는 것 — 알림 서버의 상태 재검증이 무엇을 조회할지 가른다. */
    public enum SubjectKind {
        /** 대상 없음 — 유저 자신에 대한 판정이다. */
        NONE,
        /** 그룹 챌린지 내기 회차 id. */
        BET_SESSION,
        /** 그룹 챌린지 id. */
        CHALLENGE,
        /** 상대 유저 id. */
        COUNTERPART_USER
    }

    private static final Map<String, NotificationKind> BY_NAME = Arrays.stream(values())
            .collect(Collectors.toUnmodifiableMap(Enum::name, Function.identity()));

    private final NotificationSlotGranularity slotGranularity;
    private final NotificationQuietPolicy quietPolicy;
    private final SubjectKind subjectKind;

    NotificationKind(NotificationSlotGranularity slotGranularity, NotificationQuietPolicy quietPolicy,
                     SubjectKind subjectKind) {
        this.slotGranularity = slotGranularity;
        this.quietPolicy = quietPolicy;
        this.subjectKind = subjectKind;
    }

    /** @return 결정적 사건 키의 시간 축 */
    public NotificationSlotGranularity slotGranularity() {
        return slotGranularity;
    }

    /** @return 조용한 시간 정책 — 실행은 알림 서버가 한다 */
    public NotificationQuietPolicy quietPolicy() {
        return quietPolicy;
    }

    /** @return {@code subjectId} 가 가리키는 대상의 종류 */
    public SubjectKind subjectKind() {
        return subjectKind;
    }

    /**
     * 이름으로 찾는다 — <b>모르는 이름은 {@code null}</b> 이다.
     *
     * <p>{@code valueOf} 를 쓰지 않는 이유: 적격성 판정은 모르는 kind 를 <b>fail-closed</b> 로
     * 다뤄야 하는데({@code eligible=false}), {@code IllegalArgumentException} 은 호출부에서
     * 「일시 오류」와 구분되지 않아 5xx 로 새어 나간다.
     *
     * @param name 대소문자 구분 없는 kind 이름
     * @return 찾은 kind. 없으면 {@code null}
     */
    public static NotificationKind find(String name) {
        if (name == null || name.isBlank()) {
            return null;
        }
        return BY_NAME.get(name.trim().toUpperCase(Locale.ROOT));
    }
}
