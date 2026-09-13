package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 링크 발급에 필요한 코어의 사실 — <b>Data 가 판정하고 Business 가 링크에 동봉</b>한다.
 *
 * <p>링크 서버는 코어를 부를 수 없다(§3 단방향). 그래서 「그룹이 살아 있는가 · 이 사람이 그 그룹의
 * 활성 멤버인가 · 표시할 이름은 무엇인가」를 발급 요청에 실어 보내야 한다. 기존 동작을 보존하기 위한
 * 값이기도 하다 — 현 {@code InviteLinkService.issue} 는 {@code findActiveGroup} 과 멤버십을 확인한 뒤
 * 발급하고, {@code resolveLanding} 은 <b>열 때마다</b> 현재 그룹명·닉네임을 조회한다.
 *
 * <p><b>{@code membershipEpoch} 와 {@code linkVersion} 은 분리된 값이다</b>(A22 ⓑ″ · ㋑).
 * epoch 는 탈퇴·강퇴·재가입에만 오르고 일반 낙관락 {@code version} 과 다르다 — 낙관락을 쓰면 첫
 * 수신자의 가입이 초대자 행의 version 을 올려 <b>재사용 링크의 이후 수신자가 전부 실패</b>한다.
 *
 * @param groupActive      그룹이 삭제·종료되지 않았는가
 * @param inviterActiveMember 발급자가 그 그룹의 활성 멤버인가
 * @param membershipEpoch  {@code (groupId, inviterId)} 의 멤버십 전이 세대 — 링크가 오래된 명령을 거부하는 기준
 * @param linkVersion      <b>발급 당시</b> epoch — 폐기가 「정확히 일치」로 대상을 고르는 기준.
 *                         <b>발급 경로에서는 {@code membershipEpoch} 와 같은 값이어야 한다</b>:
 *                         링크 서버가 {@code epoch !== linkVersion} 이면 {@code ISSUE_EPOCH_MISMATCH}
 *                         400 으로 거절한다({@code link/src/lib/links.ts:34}). 두 값이 갈리는 것은
 *                         <b>폐기(revoke)</b> 뿐이다 — 그때는 폐기 대상 {@code linkVersion=N} 과 전이 후
 *                         {@code membershipEpoch=N+1} 을 함께 실어야 한다(A22 ㋑)
 * @param transitionSeq    그 멤버십 전이 커밋의 순서. 같은 epoch 안에서도 HTTP 적용 순서는 보장되지
 *                         않으므로(A22 ㋥) 링크 서버가 {@code (groupId, inviterId)} 별 전이 seq 로
 *                         역순을 거른다 — 이 값이 없으면 역순 검증 자체가 성립하지 않는다
 * @param snapshotVersion  표시정보 스냅샷의 버전. 늦게 온 이름 변경 relay 가 최신 이름을 덮지 않게
 *                         version 대조에 쓴다(A22 ㋡)
 * @param groupName        랜딩 표시용 현재 그룹명 스냅샷
 * @param inviterDisplayName 랜딩 표시용 현재 발급자 닉네임 스냅샷
 * @param groupId          확인된 그룹 id
 * @param inviterId        확인된 발급자 id
 */
public record InviteIssueContext(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean groupActive,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean inviterActiveMember,
        long membershipEpoch,
        long linkVersion,
        long transitionSeq,
        long snapshotVersion,
        String groupName,
        String inviterDisplayName,
        UUID groupId,
        UUID inviterId) {
}
