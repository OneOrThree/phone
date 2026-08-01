package com.oneorthree.phone.invitelink.support;

import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 링크 하나를 URL 두 형태로 바꾸는 단일 지점 (스펙 §4-1 계약).
 *
 * <p>공유용 Universal Link 와 랜딩이 점프하는 커스텀 스킴은 같은 링크의 두 표현인데, 각각 다른
 * 계층에서 문자열을 조립하면 한쪽만 바뀌어도 앱이 파싱에 실패한다(앱은 이 세 형식만 수용한다).
 * 형식 지식을 여기 한 곳에 모은다.
 */
@Component
public class InviteLinkUrls {

    private final String baseUrl;

    public InviteLinkUrls(@Value("${link.base-url}") String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * 공유·Universal Link 형식. groupId 를 동봉하는 이유는 설치 유저가 링크를 탭했을 때
     * 서버 왕복 0회로 초대 시트를 띄우기 위해서다(slug 는 어트리뷰션용으로만 동행).
     */
    public String universalLink(GroupInviteLink link) {
        return baseUrl + "/l/" + link.getSlug() + "?g=" + link.getGroupId();
    }

    /** 랜딩이 점프하는 커스텀 스킴. 카톡 인앱브라우저처럼 UL 이 발화하지 않는 경로의 주 통로다. */
    public String scheme(GroupInviteLink link) {
        return "gromo://join?g=" + link.getGroupId() + "&s=" + link.getSlug();
    }
}
