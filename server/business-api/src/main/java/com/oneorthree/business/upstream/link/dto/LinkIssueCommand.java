package com.oneorthree.business.upstream.link.dto;

import java.util.UUID;

/**
 * 링크 발급 명령 — 링크 서버가 코어를 못 부르므로 <b>필요한 코어 사실을 전부 동봉</b>한다(§3).
 *
 * <h2>네 값이 각자 다른 경합을 막는다</h2>
 * <ul>
 *   <li>{@code linkVersion} = <b>발급 당시</b> epoch. 폐기가 「정확히 일치하는 링크만」 지우는 기준이다
 *       (A22 ⓑ″ · ㋑). 전이 후 값만 실으면 「정확 일치」 조건 때문에 예전 링크를 못 지운다.</li>
 *   <li>{@code membershipEpoch} = <b>현재</b> epoch. 링크 서버가 「최대값보다 오래된 명령」을 발급·폐기
 *       가릴 것 없이 거부하는 기준이다. 옛 값만 실으면 지연 발급을 못 막는다.</li>
 *   <li>{@code transitionSeq} = 그 멤버십 <b>전이 커밋의 순서</b>. 같은 epoch 안에서도 HTTP 적용 순서는
 *       보장되지 않아(A22 ㋥: relay 직렬화는 같은 {@code userId} 단위인데 claim 사용자와 발급자는
 *       다르다) 링크 서버가 {@code (groupId, inviterId)} 별 전이 seq 로 걸러야 한다. 이게 없으면
 *       역순 검증 자체가 불가능하다.</li>
 *   <li>{@code snapshotVersion} = 표시정보(그룹명·닉네임) 스냅샷의 버전. 스냅샷은 발급 시점 고정이
 *       아니라 {@code group.renamed}·{@code user.displayNameChanged} relay 로 갱신되는데(㋡), 늦게 온
 *       갱신이 최신 이름을 덮지 않으려면 version 대조가 필요하다.</li>
 * </ul>
 *
 * <p><b>epoch 와 낙관락 {@code version} 을 섞지 않는다</b>(ⓚ): epoch 는 탈퇴·강퇴·재가입에만 오른다.
 * 낙관락을 쓰면 첫 수신자의 가입이 초대자 행의 version 을 올려 <b>재사용 링크의 이후 수신자가 전부
 * 실패</b>한다.
 */
public record LinkIssueCommand(
        UUID groupId,
        UUID inviterId,
        long linkVersion,
        long membershipEpoch,
        long transitionSeq,
        long snapshotVersion,
        String groupName,
        String inviterDisplayName) {
}
