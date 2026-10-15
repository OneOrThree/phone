package com.oneorthree.phone.invitelink.support;

import com.oneorthree.phone.invitelink.dto.InviteLinkRef;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
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

    /**
     * 랜딩이 점프하는 커스텀 스킴. 카톡 인앱브라우저처럼 UL 이 발화하지 않는 경로의 주 통로다.
     *
     * @param link 대상 링크의 값 사본
     * @return {@code gromo://join?g=…&s=…}. 앱이 안 깔려 있으면 아무 일도 일어나지 않으므로
     *         랜딩은 이 점프에 실패해도 스토어 버튼이 남아 있어야 한다
     */
    public String scheme(InviteLinkRef link) {
        return "gromo://join?g=" + link.groupId() + "&s=" + link.slug();
    }
}
