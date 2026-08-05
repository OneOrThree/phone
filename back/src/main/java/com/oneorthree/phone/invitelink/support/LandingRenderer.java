package com.oneorthree.phone.invitelink.support;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 랜딩 HTML 렌더러 — classpath 템플릿의 자리표시자 아홉 개를 채운다.
 *
 * <p>Thymeleaf 를 들이지 않는 이유는 이 페이지가 서버 렌더링 화면 중 유일한 한 장이고, 치환 대상이
 * {@code {{groupName}} {{inviterName}} {{hasInviter}} {{pageTitle}} {{schemeUrl}} {{storeUrl}}
 * {{storeState}} {{ogImageUrl}} {{expired}}} 아홉 개뿐이기 때문이다
 * (템플릿과 이 목록은 반드시 함께 고친다 — 안 채워진 자리는 빈 문자열이 된다).
 *
 * <p>치환은 <b>단일 패스</b>다. groupName 을 먼저 넣고 다른 자리표시자를 나중에 넣으면,
 * 그룹명이 {@code {{storeUrl}}} 인 방이 다른 값으로 다시 치환되는 주입 통로가 열린다.
 */
@Slf4j
@Component
public class LandingRenderer {

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{\\{(\\w+)}}");
    private static final String TEMPLATE_PATH = "invitelink/landing.html";
    /** 만료 랜딩의 {@code {{groupName}}} 대체 문자열 — 그룹명을 잃은 자리에 들어가는 중립 명칭. */
    private static final String EXPIRED_GROUP_NAME = "그로모 그룹";
    /**
     * App Store 앱 id 가 전부 0 인 플레이스홀더({@code /id0000000000}) — 링크 자체는 열리지만
     * "현재 국가나 지역에서 사용할 수 없는 앱"이 뜬다(GROMO-1086 의 실제 사고).
     */
    private static final Pattern PLACEHOLDER_STORE_ID = Pattern.compile("/id0+(?=[/?#]|$)");
    /** 초대자 닉네임 표시 상한(사용자가 보는 글자 수). og:title 한 줄에서 초대자가 그룹명을 밀어내지 않을 만큼만 남긴다. */
    private static final int INVITER_NAME_MAX = 20;
    /**
     * 확장 grapheme cluster 한 덩어리 — 사용자가 "글자 하나"로 보는 단위.
     *
     * <p>{@code BreakIterator} 대신 정규식 {@code \X} 를 쓰는 이유: Java 17 의 BreakIterator 는
     * 피부톤 모디파이어(👍🏽)·국기(regional indicator)·ZWJ 이모지를 각각 쪼갠다. 그 경계로 자르면
     * 다른 이모지가 되거나 매달린 결합 문자가 남는다. 정규식 {@code \X} 는 같은 JVM 에서 UAX #29
     * 확장 규칙을 그대로 지킨다(검증: 17.0.10 에서 위 네 경우 모두 1 덩어리).
     */
    private static final Pattern GRAPHEME = Pattern.compile("\\X");

    private final String template;
    private final String storeUrl;
    private final String ogImageUrl;
    private final boolean storeUrlUsable;

    public LandingRenderer(
            @Value("${link.store-ios-url}") String storeUrl,
            @Value("${link.base-url}") String baseUrl) {
        this.storeUrl = storeUrl;
        this.storeUrlUsable = isUsableStoreUrl(storeUrl);
        if (!this.storeUrlUsable) {
            // 기동을 실패시키지는 않는다 — 랜딩은 스토어 링크가 없어도 초대를 열어야 하고,
            // 임의 값으로 뜨는 로컬·테스트 컨텍스트를 깨뜨릴 이유도 없다. 대신 로그로 드러낸다.
            // ${ENV:기본값} 구조는 값을 빼먹어도 조용히 깨진 링크를 서빙하므로, 조용함 자체가 사고였다.
            log.warn("link.store-ios-url 이 미설정/플레이스홀더입니다 — 스토어 버튼 대신 안내 문구를 노출합니다. value={}",
                    storeUrl);
        }
        // 절대 URL 이어야 한다(OG 스크레이퍼는 상대 경로를 못 푼다). 도메인을 하드코딩하면
        // dev 발급 링크의 미리보기가 미배포 prod 이미지를 가리켜 깨진다 — 환경별 자기 도메인으로 만든다.
        this.ogImageUrl = baseUrl + "/link/og-invite-v1.png";
        this.template = loadTemplate();
    }

    /** 정상 초대 — 그룹명·초대자 닉네임과 스킴 점프 링크를 채운다. */
    public String render(String groupName, String inviterName, String schemeUrl) {
        String safeGroupName = HtmlUtils.htmlEscape(groupName);
        String safeInviterName = escapeInviterName(inviterName);
        return render(Map.of(
                "groupName", safeGroupName,
                "inviterName", safeInviterName,
                "hasInviter", safeInviterName.isEmpty() ? "false" : "true",
                "pageTitle", pageTitle(safeGroupName, safeInviterName),
                "schemeUrl", schemeUrl,
                "storeUrl", storeHref(),
                "storeState", storeState(),
                "ogImageUrl", ogImageUrl,
                "expired", "false"));
    }

    /**
     * 만료·미존재 초대 — 그래도 200 HTML 이고 스토어 버튼은 남긴다.
     * 여기까지 온 사람은 이미 설치 의향이 있는 유입이라, 404 로 돌려보내는 건 순손실이다.
     *
     * <p>초대자 닉네임은 그룹명과 같은 규칙으로 숨긴다 — 없는 slug 도 이 변형으로 오므로 초대자를
     * 특정할 수 없고, 만료 안내 옆에 사람 이름만 남기면 "누가 왜"가 어긋난 화면이 된다.
     */
    public String renderExpired() {
        return render(Map.of(
                // 빈 문자열을 넣으면 OG 제목이 「」 처럼 깨진 채 미리보기로 퍼진다 — 중립 명칭으로 채운다.
                "groupName", EXPIRED_GROUP_NAME,
                "inviterName", "",
                "hasInviter", "false",
                "pageTitle", pageTitle(EXPIRED_GROUP_NAME, ""),
                "schemeUrl", "",
                "storeUrl", storeHref(),
                "storeState", storeState(),
                "ogImageUrl", ogImageUrl,
                "expired", "true"));
    }

    /**
     * {@code <title>}·og:title 한 줄 — 조건 분기가 불가능한 자리라 서버에서 완성해 넘긴다.
     *
     * <p>초대자를 제목 맨 앞에 두는 이유: 카톡 미리보기에서 가장 먼저 읽히는 줄이고,
     * "누가 불렀는가"가 링크를 누를지 말지를 가르는 정보다.
     *
     * <p>인자는 <b>이스케이프를 마친</b> 값이어야 한다 — 여기서 다시 이스케이프하면 이중 이스케이프가 된다.
     */
    private static String pageTitle(String safeGroupName, String safeInviterName) {
        String invitation = "gromo 그룹 「" + safeGroupName + "」에 초대했어요";
        return safeInviterName.isEmpty() ? invitation : safeInviterName + "님이 " + invitation;
    }

    /**
     * 초대자 닉네임 — 그룹명과 똑같이 <b>속성 안전</b> 이스케이프를 거친다.
     * {@code content="…"} 안에 들어가므로 {@code "} 하나로 속성 주입이 열린다.
     *
     * <p>없는 초대자(탈퇴·닉네임 미설정)는 빈 문자열이 되고, 카드와 제목이 초대자 없는 문구로 접힌다.
     */
    private static String escapeInviterName(String inviterName) {
        if (inviterName == null || inviterName.isBlank()) {
            return "";
        }
        String trimmed = inviterName.strip();
        // 자르기는 이스케이프 <b>전에</b> 한다 — 뒤에 자르면 &quot; 같은 엔티티가 중간에서 잘려 깨진다.
        String cut = truncateToGraphemes(trimmed);
        if (cut.length() == trimmed.length()) {
            return HtmlUtils.htmlEscape(trimmed);
        }
        // 말줄임표는 이스케이프 뒤에 붙인다 — htmlEscape 를 태우면 &hellip; 가 된다(페이지는 UTF-8 이라 그대로 둔다).
        return HtmlUtils.htmlEscape(cut) + "…";
    }

    /**
     * 사용자가 보는 글자(grapheme cluster) 단위로 자른다 — {@code INVITER_NAME_MAX} 개 이하면 원본 그대로.
     *
     * <p>코드포인트 기준으로 자르면 서로게이트 쌍은 살아남지만 <b>사용자가 보는 글자는 깨진다</b>:
     * 결합 악센트가 떨어져 다른 글자가 되고, 피부톤·국기·ZWJ 이모지는 다른 이모지가 되거나
     * 매달린 결합 문자를 남긴다. 경계 판정은 {@link #GRAPHEME} 이 맡는다.
     */
    private static String truncateToGraphemes(String text) {
        Matcher graphemes = GRAPHEME.matcher(text);
        int cut = -1;
        int count = 0;
        while (graphemes.find()) {
            count++;
            if (count == INVITER_NAME_MAX) {
                cut = graphemes.end();
            } else if (count > INVITER_NAME_MAX) {
                // 상한을 넘긴 게 확정된 시점에만 자른다 — 정확히 상한이면 말줄임표 없이 통째로 남긴다.
                return text.substring(0, cut);
            }
        }
        return text;
    }

    /** 미설정 스토어 URL 은 href 자체를 비운다 — 템플릿 JS 의 http(s) 검사도 함께 걸리도록. */
    private String storeHref() {
        return storeUrlUsable ? storeUrl : "";
    }

    /** 템플릿이 CSS 만으로 분기하는 값 — {@code unset} 이면 스토어 버튼 대신 검색 안내를 띄운다. */
    private String storeState() {
        return storeUrlUsable ? "ready" : "unset";
    }

    private static boolean isUsableStoreUrl(String url) {
        if (url == null || url.isBlank()) {
            return false;
        }
        String lower = url.toLowerCase(Locale.ROOT);
        if (!lower.startsWith("https://") && !lower.startsWith("http://")) {
            return false;
        }
        return !PLACEHOLDER_STORE_ID.matcher(url).find();
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
