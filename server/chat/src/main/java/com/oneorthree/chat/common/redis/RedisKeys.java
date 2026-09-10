package com.oneorthree.chat.common.redis;

import java.util.UUID;

/**
 * 이 서비스가 만지는 Redis 키 전부 — <b>여기 없는 패턴은 만들지 않는다</b>.
 *
 * <p>목표 아키텍처 A19 가 공유 저장소를 네임스페이스 표로 못 박았고, 이 클래스가 그 표의 채팅 쪽 절반이다.
 *
 * <table>
 *   <caption>채팅이 쓰는 네임스페이스</caption>
 *   <tr><th>키</th><th>소유(쓰기)</th><th>이 서비스</th><th>용도</th></tr>
 *   <tr><td>{@code cache:chat:member:{userId}}</td><td>채팅</td><td>읽기·쓰기</td>
 *       <td>유저가 속한 섬(그룹) id 집합. 서비스 내부 캐시라 <b>다른 서비스와 공유하지 않는다</b></td></tr>
 *   <tr><td>{@code chat:fanout}</td><td>채팅</td><td>발행·구독</td>
 *       <td>인스턴스 간 메시지 전파(Pub/Sub). 저장하지 않는 채널이라 영속 데이터가 아니다</td></tr>
 *   <tr><td>{@code presence:focus:{userId}}</td><td><b>Data API</b></td><td><b>읽기 전용</b></td>
 *       <td>집중 세션 리스. 채팅은 존재 여부만 본다 — 쓰지도 지우지도 않는다</td></tr>
 * </table>
 *
 * <p><b>{@code presence:*} 에 쓰지 마라.</b> 소유자는 Data API 이고 채팅은 읽는 쪽이다. 여기서 지우면
 * 집중 중인 유저가 즉시 채팅에 들어올 수 있게 되고, 그 흔적은 어디에도 남지 않는다. 배포 시 Redis ACL
 * 의 채팅 유저에게 이 패턴은 {@code %R~presence:*} (읽기 전용 selector)로만 준다 — A19 가 «읽기 전용
 * 패턴은 반드시 별도 selector 로 분리한다»고 못 박은 이유가 이것이다.
 *
 * <p>키를 문자열 연결로 흩어 쓰지 않고 한 클래스에 모은 이유는 오타 때문이 아니라 <b>감사 때문</b>이다 —
 * 이 파일 하나만 보면 채팅이 남의 네임스페이스를 건드리는지 즉시 판정할 수 있다.
 */
public final class RedisKeys {

    /** 인스턴스 간 팬아웃 채널. 그룹별로 채널을 쪼개지 않는 이유는 {@code fanout} 패키지 설명에 있다. */
    public static final String FANOUT_CHANNEL = "chat:fanout";

    private static final String MEMBER_CACHE_PREFIX = "cache:chat:member:";
    private static final String FOCUS_PRESENCE_PREFIX = "presence:focus:";

    private RedisKeys() {
    }

    /** 유저가 속한 그룹 id 집합(SET). 값은 groupId 의 문자열 표현이다. */
    public static String memberCache(UUID userId) {
        return MEMBER_CACHE_PREFIX + userId;
    }

    /**
     * 집중 세션 리스 — <b>존재 자체가 «집중 중»이라는 뜻</b>이고 값은 보지 않는다.
     *
     * <p>값을 판정에 쓰지 않는 건 의도다. 값을 읽어 해석하기 시작하면 Data API 가 무엇을 담는지가
     * 채팅의 계약이 되어, 그쪽이 포맷을 바꾸는 순간 이쪽이 조용히 오판한다. 존재 여부만 보면 그 결합이
     * 생기지 않는다.
     */
    public static String focusPresence(UUID userId) {
        return FOCUS_PRESENCE_PREFIX + userId;
    }
}
