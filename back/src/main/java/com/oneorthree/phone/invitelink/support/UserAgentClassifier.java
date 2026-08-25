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

    /**
     * 'bot' 이 slackbot·twitterbot·googlebot 등 대부분을 덮지만, 링크 프리뷰 크롤러 중에는 UA 에
     * 'bot' 이 아예 없는 것들이 있어(WhatsApp, 네이버 Yeti, Embedly 등) 따로 적는다.
     * 허용목록(실브라우저 UA만 기록)으로 뒤집지 않는 이유: 인앱브라우저 UA 가 앱·버전마다 제각각이라
     * 허용목록은 진짜 유저를 조용히 떨어뜨린다 — 여기서는 누락(과소 차단)이 오차의 안전한 방향이다.
     */
    private static final List<String> BOT_MARKERS = List.of(
            "kakaotalk-scrap", "facebookexternalhit", "slackbot", "twitterbot",
            "whatsapp", "yeti", "embedly", "pinterest", "skypeuripreview",
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
        // 데스크톱 모드 iPadOS — UA 에 iPad 대신 Macintosh 가 실리지만, 진짜 Mac Safari 와 달리 WebKit
        // 토큰 "Mobile/…" 이 남는다. other 로 두면 설치 후 앱이 보내는 os=ios 와 어긋나 매치가 항상 실패한다.
        // (Mobile 토큰까지 없는 완전 데스크톱형 iPad UA 는 Mac 과 구분 불가 — 그건 other 로 남는 한계다.)
        if (ua.contains("macintosh") && ua.contains("mobile")) {
            return "ios";
        }
        if (ua.contains("android")) {
            return "android";
        }
        return "other";
    }

    public boolean isBot(String userAgent) {
        // UA 를 아예 안 보내는 건 브라우저가 아니다 — 실브라우저·인앱브라우저는 예외 없이 UA 를 보내므로,
        // 봇 취급해도 진짜 유저를 떨어뜨리지 않고 curl 류 스크립트의 유령 클릭만 걸러진다.
        if (userAgent == null || userAgent.isBlank()) {
            return true;
        }
        String ua = userAgent.toLowerCase(Locale.ROOT);
        return BOT_MARKERS.stream().anyMatch(ua::contains);
    }
}
