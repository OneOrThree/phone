package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 랜딩 렌더러 단위 테스트 — 설정값에 따라 갈리는 분기를 통합 테스트 없이 잠근다.
 *
 * <p>특히 <b>스토어 URL 미설정</b> 경로는 통합 테스트로 덮을 수 없다. ci 프로파일의
 * {@code link.store-ios-url} 은 실제 출시 링크로 고정돼 있어야 하고(랜딩 통합 테스트가 그 값을 단정한다),
 * 미설정 상황은 렌더러를 직접 세워야만 재현된다.
 */
class LandingRendererTest {

    private static final String BASE_URL = "https://link.test";
    private static final String REAL_STORE_URL = "https://apps.apple.com/kr/app/gromo-grow-motivation/id6774498679";
    private static final String PLACEHOLDER_STORE_URL = "https://apps.apple.com/kr/app/id0000000000";
    private static final String SCHEME_URL = "gromo://join?g=abc&s=slug1234";

    @Test
    @DisplayName("정상 설정이면 스토어 CTA 를 그대로 띄운다")
    void rendersStoreCtaWhenConfigured() {
        String html = renderer(REAL_STORE_URL).render("스터디", "김초대", SCHEME_URL);

        assertThat(html).contains("data-store=\"ready\"");
        assertThat(html).contains("href=\"" + REAL_STORE_URL + "\"");
    }

    @Test
    @DisplayName("플레이스홀더 App ID 는 미설정으로 본다 — 열리긴 하지만 '사용할 수 없는 앱'이 뜬다")
    void treatsPlaceholderAppIdAsUnset() {
        String html = renderer(PLACEHOLDER_STORE_URL).render("스터디", "김초대", SCHEME_URL);

        assertThat(html).contains("data-store=\"unset\"");
        // 깨진 링크를 CTA 로 내보내지 않는다
        assertThat(html).doesNotContain("id0000000000");
        assertThat(html).contains("id=\"cta-store\" href=\"\"");
    }

    @Test
    @DisplayName("빈 값·http(s) 아닌 값도 미설정이다")
    void treatsBlankOrNonHttpUrlAsUnset() {
        assertThat(renderer("").render("스터디", "김초대", SCHEME_URL)).contains("data-store=\"unset\"");
        assertThat(renderer("javascript:alert(1)").render("스터디", "김초대", SCHEME_URL))
                .contains("data-store=\"unset\"");
    }

    @Test
    @DisplayName("미설정이어도 만료 변형에 다음 행동 안내가 남는다 — 스토어 CTA 가 유일한 액션인 화면이다")
    void expiredKeepsGuidanceWhenStoreUnset() {
        String html = renderer(PLACEHOLDER_STORE_URL).renderExpired();

        assertThat(html).contains("data-store=\"unset\"");
        // 버튼을 감추는 대신 다음에 할 일을 남긴다(막다른 화면 금지)
        assertThat(html).contains("App Store에서 <b>gromo</b>를 검색해 설치해 주세요");
    }

    @Test
    @DisplayName("만료 변형은 초대자를 싣지 않는다")
    void expiredHasNoInviter() {
        String html = renderer(REAL_STORE_URL).renderExpired();

        assertThat(html).contains("data-inviter=\"false\"");
        assertThat(html).contains("<title>gromo 그룹 「그로모 그룹」에 초대했어요</title>");
    }

    @Test
    @DisplayName("초대자를 모르면 제목에서 초대자 절을 뺀다 — '님이'만 남으면 안 된다")
    void omitsInviterClauseWhenUnknown() {
        String html = renderer(REAL_STORE_URL).render("스터디", null, SCHEME_URL);

        assertThat(html).contains("data-inviter=\"false\"");
        assertThat(html).contains("<title>gromo 그룹 「스터디」에 초대했어요</title>");
        assertThat(html).doesNotContain("님이 gromo 그룹");
    }

    @Test
    @DisplayName("공백뿐인 닉네임도 없는 것으로 다룬다")
    void treatsBlankInviterAsUnknown() {
        assertThat(renderer(REAL_STORE_URL).render("스터디", "   ", SCHEME_URL))
                .contains("data-inviter=\"false\"");
    }

    @Test
    @DisplayName("긴 닉네임은 잘라 싣는다 — 미리보기 한 줄에서 초대자가 그룹명을 밀어내면 안 된다")
    void truncatesLongInviterName() {
        String html = renderer(REAL_STORE_URL).render("스터디", "가".repeat(25), SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "가".repeat(20) + "…</span>");
    }

    @Test
    @DisplayName("상한과 같은 길이는 자르지 않는다 — 경계에서 멀쩡한 이름에 말줄임표가 붙으면 안 된다")
    void keepsNameAtExactLimit() {
        String html = renderer(REAL_STORE_URL).render("스터디", "가".repeat(20), SCHEME_URL);

        // 말줄임표가 붙지 않는 게 요점 — 템플릿 주석에도 … 가 있어서 전역 doesNotContain 은 못 쓴다
        assertThat(html).contains("<span class=\"name\">" + "가".repeat(20) + "</span>");
        assertThat(html).contains("<title>" + "가".repeat(20) + "님이 gromo 그룹 「스터디」에 초대했어요</title>");
    }

    @Test
    @DisplayName("상한을 하나 넘기면 그때부터 자른다")
    void truncatesOnePastLimit() {
        String html = renderer(REAL_STORE_URL).render("스터디", "가".repeat(21), SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "가".repeat(20) + "…</span>");
    }

    @Test
    @DisplayName("이모지 닉네임을 잘라도 서로게이트 쌍이 쪼개지지 않는다")
    void truncatesWithoutSplittingSurrogatePairs() {
        String html = renderer(REAL_STORE_URL).render("스터디", "🙂".repeat(25), SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "🙂".repeat(20) + "…</span>");
    }

    @Test
    @DisplayName("결합 문자는 사용자가 보는 글자 단위로 센다 — 악센트만 떨어져 나가면 다른 이름이 된다")
    void truncatesAtGraphemeBoundary() {
        // 19자 + 결합 악센트가 붙은 e. 코드포인트로 세면 20번째가 'e' 라 악센트가 잘려 나간다.
        String name = "a".repeat(19) + "e\u0301" + "zzzzz";

        String html = renderer(REAL_STORE_URL).render("스터디", name, SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "a".repeat(19) + "e\u0301" + "…</span>");
    }

    @Test
    @DisplayName("ZWJ 로 이어진 이모지는 한 글자로 남는다 — 매달린 조인자를 남기지 않는다")
    void keepsZwjEmojiWhole() {
        String family = "\uD83D\uDC69\u200D\uD83D\uDC69";
        String html = renderer(REAL_STORE_URL).render("스터디", "a".repeat(18) + family + "zzzzz", SCHEME_URL);

        // 19번째 글자가 가족 이모지, 20번째가 z 라 여기서 잘린다.
        // htmlEscape 가 ZWJ 를 &zwj; 엔티티로 바꾸므로 출력에는 엔티티로 남는다(렌더 결과는 동일).
        String escapedFamily = "\uD83D\uDC69&zwj;\uD83D\uDC69";
        assertThat(html).contains("<span class=\"name\">" + "a".repeat(18) + escapedFamily + "z…</span>");
        // 결합 상대를 잃은 조인자로 끝나면 뒤 글자와 엉뚱하게 붙어 보인다
        assertThat(html).doesNotContain("&zwj;…");
    }

    @Test
    @DisplayName("피부톤 모디파이어는 앞 이모지에 붙어 있다 — 떼면 다른 이모지가 된다")
    void keepsEmojiSkinToneModifier() {
        String thumbsUp = "\uD83D\uDC4D\uD83C\uDFFD";
        String html = renderer(REAL_STORE_URL).render("스터디", "a".repeat(19) + thumbsUp + "zzz", SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "a".repeat(19) + thumbsUp + "…</span>");
    }

    @Test
    @DisplayName("국기 이모지는 지역 표시자 쌍을 함께 남긴다 — 반쪽만 남으면 글자 하나가 된다")
    void keepsRegionalIndicatorPair() {
        String flag = "\uD83C\uDDF0\uD83C\uDDF7";
        String html = renderer(REAL_STORE_URL).render("스터디", "a".repeat(19) + flag + "zzz", SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">" + "a".repeat(19) + flag + "…</span>");
    }

    @Test
    @DisplayName("닉네임의 큰따옴표는 엔티티로 남는다 — content=\"…\" 속성 주입을 막는다")
    void escapesInviterNameForAttribute() {
        String html = renderer(REAL_STORE_URL).render("스터디", "a\"><b onload=x", SCHEME_URL);

        assertThat(html).doesNotContain("a\"><b onload=x");
        assertThat(html).contains("&quot;");
        assertThat(html).contains("&lt;b");
    }

    @Test
    @DisplayName("치환은 단일 패스다 — 그룹명에 든 자리표시자가 다시 치환되지 않는다")
    void substitutesInSinglePass() {
        String html = renderer(REAL_STORE_URL).render("{{storeUrl}}", "김초대", SCHEME_URL);

        assertThat(html).contains("<span class=\"bracket\">「</span>{{storeUrl}}");
    }

    @Test
    @DisplayName("초대자 닉네임에 든 자리표시자도 다시 치환되지 않는다 — 닉네임은 사용자 입력이다")
    void substitutesInviterNameInSinglePass() {
        String html = renderer(REAL_STORE_URL).render("스터디", "{{storeUrl}}", SCHEME_URL);

        assertThat(html).contains("<span class=\"name\">{{storeUrl}}</span>님이 초대했어요");
        // 닉네임을 거쳐 서버가 완성하는 pageTitle 도 같은 불변식을 지켜야 한다
        assertThat(html).contains("<title>{{storeUrl}}님이 gromo 그룹 「스터디」에 초대했어요</title>");
        assertThat(html).contains(REAL_STORE_URL);
    }

    private static LandingRenderer renderer(String storeUrl) {
        return new LandingRenderer(storeUrl, BASE_URL);
    }
}
