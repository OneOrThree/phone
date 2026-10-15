package com.oneorthree.phone.invitelink.support;

import java.util.UUID;

/**
 * 링크 서버가 서명한 <b>가입 자격</b>의 내용 (A22 ⓚ).
 *
 * <p>Data 는 Neon 을 읽을 수 없고 Business 는 「링크 확인」과 「가입」을 별개 호출로 조합하므로 그
 * 사이의 탈퇴·폐기를 놓친다. 그래서 링크가 서명한 이 값을 명령에 실어 보내고, Data 가 <b>커밋 안에서</b>
 * 현재 그룹 상태·멤버십 세대와 대조한다.
 *
 * <p>{@code membershipEpoch} 는 <b>그 링크가 발급된 시점</b>의 세대다(링크 원장의 {@code link_version}).
 * 현재 세대와 <b>정확히 같을 때만</b> 유효하다 — 탈퇴·강퇴·재가입이 한 번이라도 끼면 그 사이 공유된
 * 링크는 더 이상 같은 초대가 아니다.
 *
 * @param slug            링크 식별자
 * @param groupId         가입 대상 그룹
 * @param inviterId       발급자
 * @param membershipEpoch 발급 시점 세대 — 서명 payload 에는 <b>문자열</b>로 실린다
 * @param expiresAtEpochSecond 만료(초). 링크 서버가 짧게 잡는다
 */
public record LinkCapability(
        String slug,
        UUID groupId,
        UUID inviterId,
        long membershipEpoch,
        long expiresAtEpochSecond) {
}
