package com.oneorthree.phone.internal.dto;

import java.util.UUID;

/**
 * 링크 발급에 실을 코어의 사실 — <b>Data 가 판정한다</b> (A22 ㊫ · ⓚ · ⓑ″ · ㋥ · ㋡).
 *
 * <p>링크 서버는 코어를 부를 수 없다(§3 단방향). 그래서 「그룹이 살아 있는가 · 이 사람이 활성 멤버인가 ·
 * 표시할 이름 · 순서 판정용 값들」을 여기서 받아 발급 요청에 동봉한다. 기존
 * {@code InviteLinkService.issue} 의 {@code findActiveGroup} + 멤버십 확인을 그대로 옮긴 것이다.
 *
 * @param groupActive         그룹이 삭제·종료되지 않았는가
 * @param inviterActiveMember 발급자가 그 그룹의 <b>활성</b> 멤버인가
 * @param membershipEpoch     <b>현재</b> 세대 — 링크가 오래된 명령을 거부하는 기준
 * @param linkVersion         <b>발급 당시</b> 세대 — 폐기가 「정확히 일치」로 대상을 고르는 기준(ⓑ″).
 *                            발급 시점에는 {@code membershipEpoch} 와 같은 값이지만 뜻이 다르다
 * @param transitionSeq       그 멤버십 전이 커밋의 순서(㋥)
 * @param snapshotVersion     표시정보 스냅샷의 버전(㋡)
 * @param groupName           랜딩 표시용 현재 그룹명
 * @param inviterDisplayName  랜딩 표시용 현재 발급자 닉네임. 게스트·탈퇴는 {@code null}
 * @param groupId             확인된 그룹
 * @param inviterId           확인된 발급자
 */
public record InviteIssueContextResponse(
        boolean groupActive,
        boolean inviterActiveMember,
        long membershipEpoch,
        long linkVersion,
        long transitionSeq,
        long snapshotVersion,
        String groupName,
        String inviterDisplayName,
        UUID groupId,
        UUID inviterId) {
}
