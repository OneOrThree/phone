package com.oneorthree.phone.invitelink.support;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * UA 분류는 매치의 정확도(os 일치)와 클릭 수의 신뢰도(봇 제외)를 동시에 좌우한다.
 *
 * <p>특히 봇 판정 — 카톡에 링크를 붙이면 사람이 누르기 전에 스크레이퍼가 먼저 랜딩을 때린다.
 * 이걸 클릭으로 세면 클릭 수가 부풀 뿐 아니라, 스크레이퍼 IP 로 찍힌 미소진 클릭이 매치 후보로
 * 남아 엉뚱한 사람에게 매치될 수 있다.
 */
class UserAgentClassifierTest {

    private final UserAgentClassifier classifier = new UserAgentClassifier();

    @Test
    @DisplayName("iPhone UA 는 ios 로 분류한다")
    void classifiesIphoneAsIos() {
        assertThat(classifier.classify(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"))
                .isEqualTo("ios");
        assertThat(classifier.classify("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).isEqualTo("ios");
    }

    @Test
    @DisplayName("Android UA 는 android, 나머지는 other")
    void classifiesAndroidAndOther() {
        assertThat(classifier.classify("Mozilla/5.0 (Linux; Android 14; SM-S918N)")).isEqualTo("android");
        assertThat(classifier.classify("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).isEqualTo("other");
    }

    @Test
    @DisplayName("카카오톡·페이스북 스크레이퍼는 봇으로 판정한다")
    void detectsScrapers() {
        assertThat(classifier.isBot("facebookexternalhit/1.1; kakaotalk-scrap/1.0;")).isTrue();
        assertThat(classifier.isBot("Slackbot-LinkExpanding 1.0")).isTrue();
        assertThat(classifier.isBot("Twitterbot/1.0")).isTrue();
        assertThat(classifier.isBot("Googlebot/2.1")).isTrue();
        assertThat(classifier.isBot("Mozilla/5.0 (compatible; SomeCrawler/1.0)")).isTrue();
    }

    @Test
    @DisplayName("일반 브라우저·카톡 인앱브라우저는 봇이 아니다")
    void realBrowsersAreNotBots() {
        assertThat(classifier.isBot(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15")).isFalse();
        // 카톡 인앱브라우저는 설계상 주 유입 경로다 — 봇으로 걸러버리면 퍼널이 통째로 사라진다.
        assertThat(classifier.isBot(
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK 10.5.0")).isFalse();
    }

    @Test
    @DisplayName("데스크톱 모드 iPadOS(Macintosh + Mobile 토큰)는 ios 로 정규화한다")
    void classifiesDesktopModeIpadAsIos() {
        // iPadOS 는 '데스크톱 웹사이트 요청' 이 기본이라 UA 에 iPad 대신 Macintosh 가 실린다.
        // other 로 두면 설치 후 앱이 보내는 os=ios 와 어긋나 iPad 유저의 매치가 항상 실패한다.
        assertThat(classifier.classify(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
                        + " (KHTML, like Gecko) Mobile/15E148")).isEqualTo("ios");
        // 진짜 Mac Safari(Mobile 토큰 없음)는 여전히 other 다.
        assertThat(classifier.classify(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
                        + " (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).isEqualTo("other");
    }

    @Test
    @DisplayName("UA 가 없거나 비어 있으면 봇이다 — 실브라우저는 UA 를 반드시 보낸다")
    void missingUserAgentIsBot() {
        assertThat(classifier.isBot(null)).isTrue();
        assertThat(classifier.isBot("  ")).isTrue();
        // classify 는 방어적으로 other 를 유지한다(기록 경로는 isBot 이 먼저 걸러 도달하지 않는다).
        assertThat(classifier.classify(null)).isEqualTo("other");
    }
}
