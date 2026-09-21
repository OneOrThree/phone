package com.oneorthree.phone.common.port;

/**
 * 프레즌스에 싣는 <b>절대 상태</b> (GROMO-2003, focus-rest-session LLD §6).
 *
 * <p>종전에는 리스 값이 순번 하나뿐이라 「집중 중인가」만 표현했고, 휴식(paused)은 집중과 구분되지
 * 않았다. LLD §6 이 「FR-D04 결정에 따라 active/paused 를 채팅 차단 투영으로 매핑한다」고 적어 둔
 * 그 매핑을 하려면 값이 먼저 둘을 구분해야 한다 — 결정은 아직 미결이므로 <b>지금은 둘 다 차단</b>이고,
 * 그 판정은 읽는 쪽이 여전히 <b>키의 존재</b>로만 한다({@code realtime}의 {@code FocusPresenceReader}).
 * 즉 이 값이 생겨도 채팅 판정 결과는 바뀌지 않는다.
 *
 * <p>「끝났다」는 여기 없다 — 종료는 상태가 아니라 <b>키의 삭제</b>다. 읽는 쪽이 존재 여부로 판정하는
 * 한, 종료를 값으로 표현하면 「값은 ended 인데 키는 살아 있다」가 곧 차단 상태가 되어 버린다.
 */
public enum FocusPresenceState {

    /** 집중 중. */
    ACTIVE("active"),

    /** 휴식 중 — 세션은 살아 있다. */
    PAUSED("paused");

    private final String wireValue;

    FocusPresenceState(String wireValue) {
        this.wireValue = wireValue;
    }

    /** 공유 저장소에 싣는 문자열. 소문자인 것은 {@code FocusSessionView.status} 와 같은 축이기 때문이다. */
    public String wireValue() {
        return wireValue;
    }
}
