package com.oneorthree.phone.invitelink.dto;


/**
 * 랜딩 한 장을 그리는 데 필요한 것 전부 — 링크와 그룹명, 혹은 "만료".
 *
 * <p>"만료"는 셋을 합친 상태다: 없는 slug, 삭제된 링크, 사라진 그룹. 랜딩 입장에서는 모두 같은 결말
 * (초대는 못 열지만 200 으로 스토어 버튼은 보여준다)이라, 컨트롤러가 세 경우를 각각 판정하는 대신
 * 서비스가 하나로 접어 넘긴다.
 *
 * @param link        유효한 초대 링크를 가리키는 값. 만료면 {@code null}
 * @param groupName   그룹명(이스케이프 전 원본). 만료면 {@code null}
 * @param inviterName 초대자 닉네임(이스케이프 전 원본). 만료·탈퇴·닉네임 미설정이면 {@code null}
 */
public record LandingView(InviteLinkRef link, String groupName, String inviterName) {

    /**
     * @return 세 필드가 모두 null 인 "만료" 상태. 없는 slug·삭제된 링크·사라진 그룹이
     *         랜딩 입장에서 같은 결말이라 하나로 접은 것이다
     */
    public static LandingView expired() {
        return new LandingView(null, null, null);
    }

    /**
     * @return {@code link} 가 null 인지로 판정한다. groupName·inviterName 은 유효한 초대에서도
     *         null 일 수 있으므로(그룹명 조회 실패·초대자 탈퇴) 만료 판정의 근거가 될 수 없다
     */
    public boolean isExpired() {
        return link == null;
    }
}
