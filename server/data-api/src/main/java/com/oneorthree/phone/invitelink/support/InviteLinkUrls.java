package com.oneorthree.phone.invitelink.support;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** 현재 섬 초대의 공유 URL을 만든다. */
@Component
public class InviteLinkUrls {

    private final String baseUrl;

    /**
     * @param baseUrl {@code link.base-url} — 링크의 자기 도메인. AASA 를 서빙하는 호스트와
     *                <b>반드시 같아야</b> iOS 가 Universal Link 를 발화시킨다.
     *                환경별로 갈리므로 하드코딩하면 dev 링크가 prod 도메인을 가리키게 된다
     */
    public InviteLinkUrls(@Value("${link.base-url}") String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * 공유·Universal Link 형식. groupId 를 동봉하는 이유는 설치 유저가 링크를 탭했을 때
     * 서버 왕복 0회로 초대 시트를 띄우기 위해서다(slug 는 어트리뷰션용으로만 동행).
     *
     * @param link 대상 링크 엔티티
     * @return {@code {base}/l/{slug}?g={groupId}} 형태의 공유용 절대 URL.
     *         앱이 수용하는 형식이 정해져 있어 <b>모양을 바꾸면 앱의 파싱이 깨진다</b>
     */
    public String universalLink(GroupInviteLink link) {
        return baseUrl + "/l/" + link.getSlug() + "?g=" + link.getGroupId();
    }

}
