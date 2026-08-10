package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.domain.GroupChallengeStatus;
import com.oneorthree.phone.group.domain.MissionCategory;
import com.oneorthree.phone.group.domain.MissionType;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Getter
@Builder
public class GroupChallengeResponse {
    private UUID id;
    private MissionType missionType;
    private MissionCategory missionCategory;

    /** DURATION: 하루 목표 분 · TIME_WINDOW: 창 내 목표 분(V20 additive — 목표 없는 구 창 챌린지는 null). */
    private Integer durationMinutes;

    /**
     * 도는 요일(§A3 · GROMO-1260) — 항상 월~일 정렬, 1개 이상. 구앱 미전송 생성분·V34 이전 행은
     * 매일(7개 전부)이다. 와이어 표기는 "MON"~"SUN"(앱 ChallengeRepeatDay 와 동일).
     */
    private List<RepeatDay> repeatDays;

    /** 오늘(KST, 조회 date 우선)이 도는 날인가 — 비활성 요일 카드 상태(FR-31-1)의 근거. */
    private boolean activeToday;

    private String windowStart;
    private String windowEnd;

    /**
     * 내부 상태 — 정본 enum(ACTIVE·ENDED, V34). 와이어에는 그대로 내보내지 않는다:
     * 직렬화는 {@link #getStatusWire()} 브리지가 담당하므로 여기서는 {@code @JsonIgnore}
     * (Lombok {@code getStatus()} 는 서버 내부·테스트용으로 남는다).
     */
    @JsonIgnore
    private GroupChallengeStatus status;

    /** 활동 시작 시각(V34) — 이력 표기 "언제부터". 기존 행은 created_at 과 같다. */
    private Instant startedAt;

    private Instant createdAt;
    private boolean canParticipate;

    /**
     * 멤버별 당일 진행률. 조회 시 {@code date} 를 주지 않았거나 목표 없는 창 챌린지
     * ({@code durationMinutes = null}), 또는 이미 끝난 챌린지({@code status = INACTIVE})면 null 이다
     * (하위 호환: 기존 클라이언트는 date 를 보내지 않으므로 필드가 항상 null 로 나간다).
     *
     * <p>TIME_WINDOW 는 date(KST) 의 창 기준 — FOCUS 는 세션 클리핑 실측(달성 판정만 5분 관용치),
     * SCREEN_TIME 은 클라 보고값(미보고 = null, 3상 유지).
     */
    private List<ChallengeMemberProgressResponse> memberProgress;

    /**
     * 조회 {@code date} 의 진행 중 내기. 내기가 없거나 date 를 주지 않았으면 null 이다.
     * 내기는 FOCUS + DURATION 챌린지에만 걸리므로 다른 챌린지에서는 항상 null 이다.
     */
    private GroupBetResponse bet;

    /**
     * 이 챌린지의 가장 최근 정산 내기(카드의 '지난 내기' 한 줄). 정산 이력이 없으면 null.
     * 조회 {@code date} 와 무관하므로 date 없이도 채워진다.
     */
    private GroupBetResultResponse lastSettledBet;

    /**
     * 휴면 챌린지 배지(GROMO-1201) — 내기 이력은 있는데(status 무관, 취소 포함) 지금 걸린 OPEN 내기가
     * 없으면 true. 이력 없는 새 챌린지는 항상 false. OPEN 판정은 요청 {@code date} 와 무관한 status
     * 조회라 과거 날짜 조회·date 없는 하위 호환 조회에서도 같은 값이 나온다. primitive 라 항상
     * 직렬화된다 — 앱은 3상 관례상 {@code dormant?: boolean} optional 로 받아 구서버 undefined 를
     * 흡수한다(additive).
     */
    private boolean dormant;

    /**
     * status 와이어 브리지 — <b>ENDED 를 구앱 어휘 "INACTIVE" 로 다운맵</b>해 내보낸다(§E3 additive).
     *
     * <p>구앱 계약이 {@code GroupChallengeStatus = 'ACTIVE' | 'INACTIVE'}(group.ts:17)로 굳어 있고
     * 종료 분기 전부가 {@code === 'INACTIVE'} 비교다(ChallengeCard.tsx:236 · challengeResult.ts:127) —
     * 'ENDED' 가 나가는 순간 끝난 챌린지가 활성처럼 렌더된다. DB·enum·내부 로직은 정본(ENDED)을 쓰고
     * 이 직렬화 지점 하나에서만 낮춘다. 신앱은 additive 필드(startedAt·endedAt·activeToday)로 실상태를
     * 읽는다.
     *
     * <p><b>제거 시점</b>: 구앱 강제 업데이트 이후 — GROMO-1238 축에서 이 메서드와 {@code @JsonIgnore}
     * 를 걷어내고 enum 직렬화로 되돌린다.
     */
    @JsonProperty("status")
    public String getStatusWire() {
        if (status == null) {
            return null;
        }
        return status == GroupChallengeStatus.ENDED ? "INACTIVE" : status.name();
    }
}
