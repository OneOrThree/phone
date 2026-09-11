package com.oneorthree.business.upstream.link.dto;

import java.util.UUID;

/**
 * 링크가 기록한 <b>잠정(pending) claim</b> 과 그 확정에 필요한 서명 자격 (A22 ㋟ · ⓚ).
 *
 * <p>왜 잠정인가: {@code claimSeq}(Data 판정 순서)는 <b>링크가 기록한 순서가 아니다</b>. 판정 seq 10 을
 * 받은 claim 이 지연되는 사이 폐기가 seq 11 로 커밋되면, 그 claim 은 폐기 뒤에 기록됐는데도
 * {@code 10 > 11} 이 아니라 살아남는다. 그래서 링크는 잠정만 기록하고, <b>Data 가 멤버십 락 아래
 * 남긴 확정 레코드</b>가 relay 로 와야 유효로 승격한다.
 *
 * @param claimId    잠정 claim 식별자 — Data 확정 요청에 실어 보낸다.
 *                   <b>null 일 수 있다</b>: 셀프 초대이거나 붙일 클릭이 없으면 링크 서버가
 *                   {@code {claimId:null, capability:null, groupId}} 를 «정상»으로 돌려준다
 *                   ({@code link/src/lib/links.ts:145·149}). 기존 {@code InviteLinkMatchService:169-177}
 *                   의 「붙일 곳이 없을 뿐 오류가 아니다」 경로와 같은 뜻이라, 그때는 확정을 건너뛰고
 *                   200 을 준다 — 기존 컨트롤러도 boolean 을 무시하고 항상 200 이었다
 * @param capability 링크 서버가 서명한 자격(slug · groupId · inviterId · membershipEpoch · 만료).
 *                   Data 가 <b>커밋 안에서</b> 현재 상태와 대조한다 — 대조를 트랜잭션 경계까지 끌고 오는
 *                   유일한 수단이다
 * @param groupId    그 링크의 그룹
 */
public record LinkClaimResult(UUID claimId, String capability, UUID groupId) {
}
