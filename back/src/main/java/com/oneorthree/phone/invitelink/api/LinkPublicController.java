package com.oneorthree.phone.invitelink.api;

import com.oneorthree.phone.common.util.ClientIpResolver;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import com.oneorthree.phone.invitelink.dto.LandingView;
import com.oneorthree.phone.invitelink.service.InviteLinkClickService;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.invitelink.service.InviteLinkService;
import com.oneorthree.phone.invitelink.support.InviteLinkUrls;
import com.oneorthree.phone.invitelink.support.IpHasher;
import com.oneorthree.phone.invitelink.support.LandingRenderer;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 무인증 초대 링크 엔드포인트 — {@code /l/*}.
 *
 * <p>{@code JwtFilter}·{@code TraceIdFilter} 는 {@code /api/*} 에만 등록돼 있어 이 경로는 인증 없이 열린다
 * (의도된 설계 — 도달하는 사람은 아직 우리 유저가 아니다).
 */
@RestController
@RequiredArgsConstructor
@Slf4j
@Tag(name = "InviteLink(public)", description = "무인증 초대 링크 — 랜딩·deferred 매치")
public class LinkPublicController {

    private static final String HTML_UTF8 = MediaType.TEXT_HTML_VALUE + ";charset=UTF-8";

    private final InviteLinkService inviteLinkService;
    private final InviteLinkClickService inviteLinkClickService;
    private final InviteLinkMatchService inviteLinkMatchService;
    private final LandingRenderer landingRenderer;
    private final InviteLinkUrls inviteLinkUrls;
    private final ClientIpResolver clientIpResolver;
    private final IpHasher ipHasher;

    /**
     * 초대 랜딩 — <b>항상 200 HTML</b>(계약 ②).
     *
     * <p>302 로 스토어에 보내지 않는 이유: 도달자는 미설치 유저·카톡 인앱브라우저·OG 스크레이퍼 셋인데
     * 리다이렉트는 뒤의 둘을 망가뜨린다(인앱브라우저는 스킴 점프 기회를 잃고, 스크레이퍼는 미리보기를 못 만든다).
     */
    @Operation(summary = "초대 랜딩", description = "만료·미존재 slug 도 200 HTML(만료 변형)")
    @GetMapping(value = "/l/{slug}", produces = HTML_UTF8)
    public ResponseEntity<String> landing(@PathVariable String slug, HttpServletRequest request) {
        LandingView view = inviteLinkService.resolveLanding(slug);
        if (view.isExpired()) {
            return html(landingRenderer.renderExpired());
        }

        recordClickQuietly(view.link(), request);
        return html(landingRenderer.render(
                view.groupName(), view.inviterName(), inviteLinkUrls.scheme(view.link())));
    }

    /**
     * deferred 매치 — 설치 직후 첫 실행에서 호출한다(계약 ③).
     *
     * <p>실패도 200 {@code {"matched": false}} 다. 앱은 "서버 응답을 받았다"를 기준으로 확인 완료
     * 플래그를 세우므로, 4xx/5xx 로 내려가면 매 실행 재시도가 돈다.
     */
    @Operation(summary = "deferred 매치", description = "IP해시+OS+시간창 fingerprint 로 미소진 클릭 1건을 원자적으로 소진")
    @PostMapping(value = "/l/match", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<InviteMatchResponse> match(
            @Valid @RequestBody InviteMatchRequest request,
            HttpServletRequest httpRequest) {
        String ipHash = ipHasher.hash(clientIpResolver.resolve(httpRequest));
        return ResponseEntity.ok(inviteLinkMatchService.match(ipHash, request));
    }

    /** 랜딩 응답은 기록·분석보다 우선한다 — 클릭 저장이나 GA4 전송이 죽어도 초대는 열려야 한다. */
    private void recordClickQuietly(GroupInviteLink link, HttpServletRequest request) {
        try {
            inviteLinkClickService.record(link, request);
        } catch (Exception e) {
            log.warn("초대 클릭 기록 실패 — slug={}", link.getSlug(), e);
        }
    }

    private ResponseEntity<String> html(String body) {
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf(HTML_UTF8))
                .body(body);
    }
}
