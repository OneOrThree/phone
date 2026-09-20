package com.oneorthree.realtime.event;

import java.util.Arrays;
import java.util.Optional;

/**
 * 보낼 수 있는 응원 5종 — <b>서버가 정본</b>이다 (GROMO-1765, focus-rest-session LLD §2 emote).
 *
 * <p>종전에는 이 목록이 앱 목업({@code Screens.tsx})과 설계 문서에만 있었다. 서버가 알지 못하면
 * 「5종만 허용한다」는 규칙이 <b>어디에서도 강제되지 않아</b> 아무 문자열이나 섬 전체에 방송된다 —
 * 그 문자열은 다른 사용자의 화면에서 이미지 키로 쓰이므로, 목록을 서버에 두는 것이 이 채널의 유일한
 * 입력 검증이다.
 *
 * <p>{@code event} 패키지에 두는 이유는 {@link EventPayloadValidator} 가 봉투를 만들 때 이 목록을
 * 다시 보기 때문이다 — 발신 경로가 하나 더 생겨도 봉투 생성에서 같은 검사가 걸린다.
 */
public enum FocusEmoteType {
    HELLO("hello"),
    CHEER("cheer"),
    SLEEPY("sleepy"),
    LAUGH("laugh"),
    HEARTS("hearts");

    private final String wireName;

    FocusEmoteType(String wireName) {
        this.wireName = wireName;
    }

    public String wireName() {
        return wireName;
    }

    /**
     * @param value 클라이언트가 보낸 문자열. {@code null}·대소문자 차이·공백은 전부 «아님»이다 —
     *              {@code toLowerCase} 로 받아 주면 방송되는 값과 앱이 기대하는 값이 달라진다
     * @return 5종 중 하나, 아니면 비어 있음
     */
    public static Optional<FocusEmoteType> of(String value) {
        return Arrays.stream(values()).filter(type -> type.wireName.equals(value)).findFirst();
    }

    /** {@link EventPayloadValidator} 전용 — 봉투 payload 의 {@code type} 이 5종인지. */
    static boolean isAllowed(String value) {
        return of(value).isPresent();
    }
}
