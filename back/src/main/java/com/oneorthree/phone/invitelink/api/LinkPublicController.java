package com.oneorthree.phone.invitelink.api;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.service.InviteLinkClickService;
import com.oneorthree.phone.invitelink.service.InviteLinkService;
import com.oneorthree.phone.invitelink.support.LandingRenderer;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

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
    private final GroupRepository groupRepository;
    private final LandingRenderer landingRenderer;

    /**
     * 초대 랜딩 — <b>항상 200 HTML</b>(계약 ②).
     *
     * <p>302 로 스토어에 보내지 않는 이유: 도달자는 미설치 유저·카톡 인앱브라우저·OG 스크레이퍼 셋인데
     * 리다이렉트는 뒤의 둘을 망가뜨린다(인앱브라우저는 스킴 점프 기회를 잃고, 스크레이퍼는 미리보기를 못 만든다).
     */
    @Operation(summary = "초대 랜딩", description = "만료·미존재 slug 도 200 HTML(만료 변형)")
    @GetMapping(value = "/l/{slug}", produces = HTML_UTF8)
    public ResponseEntity<String> landing(@PathVariable String slug, HttpServletRequest request) {
        Optional<GroupInviteLink> link = inviteLinkService.findBySlug(slug);
        if (link.isEmpty()) {
            return html(landingRenderer.renderExpired());
        }

        Optional<Group> group = groupRepository.findById(link.get().getGroupId())
                .filter(g -> g.getDeletedAt() == null);
        if (group.isEmpty()) {
            // 링크는 살아 있지만 그룹이 사라졌다 — 참여시킬 곳이 없으니 만료와 같게 다룬다.
            return html(landingRenderer.renderExpired());
        }

        recordClickQuietly(link.get(), request);
        return html(landingRenderer.render(group.get().getName(), schemeUrl(link.get())));
    }

    /** 랜딩 응답은 기록·분석보다 우선한다 — 클릭 저장이나 GA4 전송이 죽어도 초대는 열려야 한다. */
    private void recordClickQuietly(GroupInviteLink link, HttpServletRequest request) {
        try {
            inviteLinkClickService.record(link, request);
        } catch (Exception e) {
            log.warn("초대 클릭 기록 실패 — slug={}", link.getSlug(), e);
        }
    }

    private String schemeUrl(GroupInviteLink link) {
        return "gromo://join?g=" + link.getGroupId() + "&s=" + link.getSlug();
    }

    private ResponseEntity<String> html(String body) {
        return ResponseEntity.ok()
                .contentType(MediaType.valueOf(HTML_UTF8))
                .body(body);
    }
}
