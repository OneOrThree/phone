package com.oneorthree.phone.group.dto;

import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

/**
 * 오늘 회차({@code bet.session})의 참가자 한 줄 — LLD §2.1 카드 응답 계약.
 *
 * <p>{@code progressMinutes}/{@code achieved} 는 <b>하루형(DURATION) 참가 시트의 진행분 공개</b>
 * (N16 · FR-34) 용이다 — 창형은 계약상 싣지 않아 null 이다. 앱은 3상(undefined=구서버 /
 * null=미집계·창형 / number=실측)을 구분하므로 {@code @JsonInclude(NON_NULL)} 은 금지다
 * (LLD §2.1 직렬화 계약 — 필드가 통째로 사라지면 3상이 2상으로 무너진다).
 */
@Getter
@Builder
public class GroupBetSessionParticipantResponse {

    /**
     * 참가자 사용자 id. 탈퇴자 행은 null 이다(계정 LLD §4 — 과거 회차 명단이 탈퇴자 UUID 를 다른 그룹원에게
     * 계속 잇지 않게). 목록 key·행 구분에는 {@link #participantId} 를 쓴다.
     */
    private UUID userId;

    /** 회차별 참가 행 id — 탈퇴자 행도 항상 채워지는 목록 key. 회차를 넘어 같은 사람을 잇지 않는다. */
    private UUID participantId;

    private String nickname;

    /** 하루형만 실측 분. 창형·미집계(SCREEN_TIME 미보고)는 null. */
    private Integer progressMinutes;

    /** 하루형만 판정. null = 판정 불가(창형·미집계). */
    private Boolean achieved;
}
