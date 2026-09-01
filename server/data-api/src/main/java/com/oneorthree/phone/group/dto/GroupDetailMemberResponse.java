package com.oneorthree.phone.group.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import lombok.Builder;
import lombok.Getter;

import java.time.Instant;
import java.util.UUID;

/**
 * 그룹방 멤버 목록의 한 줄 — 역할·집중시간·집중 라이브 상태.
 *
 * <p>집중시간 두 필드는 축이 다르다: {@code focusTimeMinutes} 는 조회 date(KST)의 당일분,
 * {@code totalFocusMinutes} 는 전체 누적이고 목록 정렬은 뒤쪽을 쓴다(동점은 닉네임 오름차순).
 * 집중 라이브 3필드는 {@code FocusLiveInfoLookup} 공용 도출이라 리그 응답의 동명 필드와 의미가
 * 같다 — 앱이 두 소스를 같은 그리드에 섞어 쓴다. 탈퇴 유저는 목록에 실리지 않는다(GROMO-1220).
 */
@Getter
@Builder
public class GroupDetailMemberResponse {
    private UUID userId;
    private String nickname;
    private GroupMemberRole role;
    private Integer focusTimeMinutes;
    /**
     * A-8: 전체 누적 집중시간(분) — 그룹방 멤버 리더보드 정렬/표시용
     */
    private Integer totalFocusMinutes;

    /**
     * 집중 라이브 정보 (GROMO-1567) — FocusLiveInfoLookup 공용 도출. 의미·타입은 /league/me/ranking
     * (LeagueMemberResponse, GROMO-824)의 동명 필드와 동일하다 — 프론트가 같은 그리드에서 두 소스를 섞어 쓴다.
     * 현재 진행 중 세션 보유 여부. JSON 키 고정은 아래 명시적 getter 가 담당한다(사유는 GroupOverviewResponse#isMember).
     */
    private boolean isFocusing;

    /**
     * 진행 중 세션 시작 시각. 미집중이면 null.
     */
    private Instant focusStartedAt;

    /**
     * 진행 중 세션 태그명. 태그 미지정이거나 미집중이면 null.
     */
    private String focusTagName;

    /**
     * {@code isFocusing} 키를 만드는 유일한 접근자 — 필드 애노테이션이면 focusing 키가 함께 나간다.
     *
     * @return 조회 시점에 끝나지 않은 집중 세션이 있으면 true. 집계·라이브 어느 쪽에도 안 잡힌
     *     멤버는 false 로 내려간다(「기록 없음」과 구분하지 않는다).
     */
    @JsonProperty("isFocusing")
    public boolean isFocusing() {
        return isFocusing;
    }
}
