package com.oneorthree.phone.group.dto;

import com.oneorthree.phone.group.domain.GroupBetStatus;
import lombok.Builder;
import lombok.Getter;

import java.util.List;
import java.util.UUID;

/**
 * 챌린지 카드에 붙는 "오늘의 내기". 조회 {@code date} 의 내기가 없으면 필드 자체가 null 이다.
 *
 * <p>{@code myJoined}/{@code myAchievedNow} 를 {@link Boolean} 으로 둔 것은 is 접두 getter 의
 * 이중 직렬화 함정을 피하기 위함이다(선례: {@link ChallengeMemberProgressResponse}).
 */
@Getter
@Builder
public class GroupBetResponse {

    private UUID betId;

    /**
     * 개설자 — 앱이 취소 버튼(개설자 본인 && 단독 참가 && OPEN)을 판정하는 데 쓴다.
     * additive 필드이며 {@code @JsonInclude(NON_NULL)} 은 금지 — 앱은 bet 필드의
     * undefined/null 을 구분하는 3상 로직이라 직렬화 형태가 흔들리면 안 된다.
     */
    private UUID creatorUserId;

    /** 1인 판돈. */
    private int stake;

    /** 팟 = stake × 참가자 수. */
    private int pot;

    private GroupBetStatus status;

    /** 내가 이미 참가했는가. */
    private Boolean myJoined;

    /**
     * 지금 내가 목표 달성 상태인가 — <b>카테고리마다 의미가 다르다</b>(내기 대상이 4조합으로 확대되며 갈렸다).
     *
     * <ul>
     *   <li><b>FOCUS</b>: <b>확정</b> 달성. 서버 데이터(일 통계·창 클리핑 집계)라 한 번 달성하면
     *       뒤집히지 않는다. true 면 참가가 거절된다({@code BET_ALREADY_ACHIEVED}) — 앱은 이 값으로
     *       참가 버튼을 미리 잠그고 안내해도 된다</li>
     *   <li><b>SCREEN_TIME</b>: <b>잠정</b> 달성(현재 보고값 ≤ 목표)일 뿐이다. 하루/창이 끝나야
     *       확정이라 이후 사용으로 뒤집힌다. <b>true 여도 참가는 허용된다</b> — 이 값으로 버튼을
     *       잠그면 안 된다. 거절은 반대 방향으로만 일어난다(이미 목표 초과 = 확정 패배 →
     *       {@code BET_ALREADY_FAILED})</li>
     * </ul>
     *
     * <p>미보고·판정 불가(스크린타임 권한 철회, 창 사용분 미보고)는 false 다 — 3상이 필요하면
     * {@code memberProgress} 의 {@code achieved}(null 허용)를 보라.
     * 판정 규칙은 {@code GroupChallengeService.myAchievedByChallengeId} 가 카드 진행률과 공유한다.
     */
    private Boolean myAchievedNow;

    private List<GroupBetParticipantResponse> participants;
}
