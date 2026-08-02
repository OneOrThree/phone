package com.oneorthree.phone.invitelink.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 랜딩 HTML 렌더러 — classpath 템플릿의 자리표시자 4개를 채운다.
 *
 * <p>Thymeleaf 를 들이지 않는 이유는 이 페이지가 서버 렌더링 화면 중 유일한 한 장이고,
 * 치환 대상이 {@code {{groupName}} {{schemeUrl}} {{storeUrl}} {{ogImageUrl}} {{expired}}}
 * 다섯 개뿐이기 때문이다 (템플릿과 이 목록은 반드시 함께 고친다 — 안 채워진 자리는 빈 문자열이 된다).
 *
 * <p>치환은 <b>단일 패스</b>다. groupName 을 먼저 넣고 다른 자리표시자를 나중에 넣으면,
 * 그룹명이 {@code {{storeUrl}}} 인 방이 다른 값으로 다시 치환되는 주입 통로가 열린다.
 */
@Component
public class LandingRenderer {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\w+)}}");
    private static final String TEMPLATE_PATH = "invitelink/landing.html";
    /** 만료 랜딩의 {@code {{groupName}}} 대체 문자열 — 그룹명을 잃은 자리에 들어가는 중립 명칭. */
    private static final String EXPIRED_GROUP_NAME = "그로모 그룹";

    private final String template;
    private final String storeUrl;
    private final String ogImageUrl;

    public LandingRenderer(
            @Value("${link.store-ios-url}") String storeUrl,
            @Value("${link.base-url}") String baseUrl) {
        this.storeUrl = storeUrl;
        // 절대 URL 이어야 한다(OG 스크레이퍼는 상대 경로를 못 푼다). 도메인을 하드코딩하면
        // dev 발급 링크의 미리보기가 미배포 prod 이미지를 가리켜 깨진다 — 환경별 자기 도메인으로 만든다.
        this.ogImageUrl = baseUrl + "/link/og-invite-v1.png";
        this.template = loadTemplate();
    }

    /** 정상 초대 — 그룹명과 스킴 점프 링크를 채운다. */
    public String render(String groupName, String schemeUrl) {
        return render(Map.of(
                "groupName", HtmlUtils.htmlEscape(groupName),
                "schemeUrl", schemeUrl,
                "storeUrl", storeUrl,
                "ogImageUrl", ogImageUrl,
                "expired", "false"));
    }

    /**
     * 만료·미존재 초대 — 그래도 200 HTML 이고 스토어 버튼은 남긴다.
     * 여기까지 온 사람은 이미 설치 의향이 있는 유입이라, 404 로 돌려보내는 건 순손실이다.
     */
    public String renderExpired() {
        return render(Map.of(
                // 빈 문자열을 넣으면 OG 제목이 「」 처럼 깨진 채 미리보기로 퍼진다 — 중립 명칭으로 채운다.
                "groupName", EXPIRED_GROUP_NAME,
                "schemeUrl", "",
                "storeUrl", storeUrl,
                "ogImageUrl", ogImageUrl,
                "expired", "true"));
    }

    private String render(Map<String, String> values) {
        Matcher matcher = PLACEHOLDER.matcher(template);
        StringBuilder rendered = new StringBuilder();
        while (matcher.find()) {
            String replacement = values.getOrDefault(matcher.group(1), "");
            matcher.appendReplacement(rendered, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(rendered);
        return rendered.toString();
    }

    private String loadTemplate() {
        try {
            return new ClassPathResource(TEMPLATE_PATH)
                    .getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            // 템플릿이 없으면 초대 퍼널 전체가 죽는다 — 첫 요청 때가 아니라 기동 때 드러낸다.
            throw new UncheckedIOException("랜딩 템플릿을 읽을 수 없습니다: " + TEMPLATE_PATH, e);
        }
    }
}
