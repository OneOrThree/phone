package com.oneorthree.phone.invitelink.support;

import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

/**
 * User-Agent 로 OS 를 가르고 봇을 걸러낸다.
 *
 * <p>OS 분류는 매치 fingerprint 의 한 축이다(IP해시 + OS 일치). 봇 판정은 그보다 중요한데,
 * 카톡에 링크를 붙이는 순간 사람이 누르기 전에 스크레이퍼가 먼저 랜딩을 때리기 때문이다.
 * 그걸 클릭으로 남기면 클릭 수가 부풀 뿐 아니라 <b>스크레이퍼 IP 로 찍힌 미소진 클릭</b>이
 * 매치 후보로 남아 엉뚱한 설치에 붙을 수 있다.
 *
 * <p>주의: 카톡 <b>인앱브라우저</b>(UA 에 {@code KAKAOTALK})는 봇이 아니다 — 오히려 설계상
 * 주 유입 경로다. 봇은 링크 프리뷰용 스크레이퍼({@code kakaotalk-scrap})쪽이다.
 */
@Component
public class UserAgentClassifier {

    private static final List<String> BOT_MARKERS = List.of(
            "kakaotalk-scrap", "facebookexternalhit", "slackbot", "twitterbot",
            "bot", "crawler", "spider");

    /** 'ios' | 'android' | 'other'. Android 는 이번 범위 밖이지만 값 자체는 구분해 남긴다. */
    public String classify(String userAgent) {
        if (userAgent == null) {
            return "other";
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        if (ua.contains("iphone") || ua.contains("ipad") || ua.contains("ipod")) {
            return "ios";
        }
        if (ua.contains("android")) {
            return "android";
        }
        return "other";
    }

    public boolean isBot(String userAgent) {
        if (userAgent == null) {
            return false;
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        return BOT_MARKERS.stream().anyMatch(ua::contains);
    }
}
