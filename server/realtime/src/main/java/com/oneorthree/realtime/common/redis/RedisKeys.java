package com.oneorthree.realtime.common.redis;

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
 *   <tr><td>{@code chat:events:v1}</td><td>실시간</td><td>발행·구독</td>
 *       <td>인스턴스 간 <b>섬 사건</b> 전파(Pub/Sub). 채팅 wire 와 섞지 않는 별도 채널이다(realtime-events LLD §3.1)</td></tr>
 *   <tr><td>{@code lock:chat:emote:{islandId}:{userId}}</td><td>실시간</td><td>읽기·쓰기</td>
 *       <td>응원 <b>성공</b> 창. 값은 보지 않고 «있으면 이미 보냈다»로만 쓴다</td></tr>
 *   <tr><td>{@code lock:chat:emote:try:{userId}}</td><td>실시간</td><td>읽기·쓰기</td>
 *       <td>응원 <b>발신</b> 시도 창 — 거절된 요청도 여기를 소모해 상류 조회 수를 누른다</td></tr>
 *   <tr><td>{@code lock:chat:emote:sub:{userId}}</td><td>실시간</td><td>읽기·쓰기</td>
 *       <td>응원 <b>구독</b> 시도 창 — SUBSCRIBE 도 상류 조회를 부르므로 같은 상한을 건다</td></tr>
 *   <tr><td>{@code presence:focus:{userId}}</td><td><b>Data API</b></td><td><b>읽기 전용</b></td>
 *       <td>집중 세션 리스. 채팅은 존재 여부만 본다 — 쓰지도 지우지도 않는다</td></tr>
 * </table>
 *
 * <p><b>{@code presence:*} 에 쓰지 마라.</b> 소유자는 Data API 이고 채팅은 읽는 쪽이다. 여기서 지우면
 * 집중 중인 유저가 즉시 채팅에 들어올 수 있게 되고, 그 흔적은 어디에도 남지 않는다.
 *
 * <p><b>⚠️ 그리고 지금 그걸 막아 주는 것은 이 주석뿐이다.</b> A19 는 채팅 Redis 유저에게 이 패턴을
 * {@code %R~presence:*}(읽기 전용 selector)로만 주라고 못 박았지만, <b>그 ACL 을 적용하는 배포가 아직
 * 없다</b> — dev 오버레이의 redis 는 ACL 파일도 비밀번호도 없는 기본 이미지이고, 두 서비스가 모든
 * 명령·모든 키에 접근하는 기본 유저를 공유한다(GROMO-1744). 그래서 여기서 실수하면 「집중 중엔 채팅
 * 불가」가 <b>조용히</b> 풀린다 — 저장소가 막아 주지 않는다.
 *
 * <p>키를 문자열 연결로 흩어 쓰지 않고 한 클래스에 모은 이유는 오타 때문이 아니라 <b>감사 때문</b>이다 —
 * 이 파일 하나만 보면 채팅이 남의 네임스페이스를 건드리는지 즉시 판정할 수 있다.
 */
public final class RedisKeys {

    /** 인스턴스 간 팬아웃 채널. 그룹별로 채널을 쪼개지 않는 이유는 {@code fanout} 패키지 설명에 있다. */
    public static final String FANOUT_CHANNEL = "chat:fanout";

    /**
     * 섬 사건({@code focus.member.updated}·{@code rest.member.updated}·{@code focus.emote})의 인스턴스 간 채널.
     *
     * <p>{@link #FANOUT_CHANNEL} 과 <b>일부러 나눠 뒀다</b>. 채팅 wire 는 {@code ChatFanoutEvent} 로 고정된
     * 호환 대상이라(realtime-events LLD §7) 다른 모양을 같은 채널에 섞으면 구독자가 매 건 역직렬화를 두 번
     * 시도하거나 조용히 버리게 된다. 채널 이름은 LLD §3.1 이 정한 {@code chat:events:v1} 그대로다.
     */
    public static final String EVENT_FANOUT_CHANNEL = "chat:events:v1";

    private static final String MEMBER_CACHE_PREFIX = "cache:chat:member:";
    private static final String FOCUS_PRESENCE_PREFIX = "presence:focus:";
    private static final String EMOTE_RATE_PREFIX = "lock:chat:emote:";
    private static final String EMOTE_ATTEMPT_PREFIX = "lock:chat:emote:try:";
    private static final String EMOTE_SUBSCRIBE_PREFIX = "lock:chat:emote:sub:";

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

    /**
     * 응원 빈도 제한 창 — <b>키의 존재 자체가 「이 창에서 이미 보냈다」</b>이고 값은 보지 않는다.
     *
     * <p>세는 대신 {@code SET key value NX EX ttl} 한 명령으로 «있으면 거절»한다. INCR 로 세면 수명을
     * 거는 EXPIRE 가 별도 명령이라, 그 사이에 끊기면 수명 없는 카운터가 남아 그 사람이 영영 응원을 못
     * 보낸다 — {@code MembershipService} 가 SET 대신 문자열 하나를 쓰는 것과 같은 이유다.
     */
    public static String emoteRateLimit(UUID islandId, UUID userId) {
        return EMOTE_RATE_PREFIX + islandId + ":" + userId;
    }

    /**
     * 응원 <b>시도</b> 창 — 성공 창({@link #emoteRateLimit})과 <b>키도 축도 다르다</b>.
     *
     * <h2>왜 섬이 키에 없는가</h2>
     * 막으려는 것이 「<b>임의의 섬 UUID</b> 로 보내는 거절 요청」이기 때문이다. 섬을 키에 넣으면
     * 공격자가 매번 새 UUID 를 써서 제한을 통째로 비켜 가고, 거절 하나하나가 Data 정본 조회 한 번을
     * 부른다 — 인가가 거절해도 <b>비용은 이미 치른 뒤</b>다. 사용자 축이어야 그 창이 닫힌다.
     *
     * <h2>왜 성공 창과 나누는가</h2>
     * 한 키로 합치면 잘못된 type 한 번이 정상 응원의 창까지 먹는다. 나눠 두면 거절은 시도 창만
     * 소모하고 성공 창은 온전히 남는다.
     */
    public static String emoteAttempt(UUID userId) {
        return EMOTE_ATTEMPT_PREFIX + userId;
    }

    /**
     * 응원 <b>구독</b> 시도 창 — 발신 창({@link #emoteAttempt})과 <b>키를 나눈다</b>.
     *
     * <p>SUBSCRIBE 도 Data 정본 조회를 한 번 부른다. 같은 목적지에 {@code subscription id} 만 바꿔
     * 반복 SUBSCRIBE 하면 프레임마다 동기 HTTP 가 나가 인바운드 채널과 Data API 가 고갈된다 —
     * 발신만 막고 구독을 열어 두면 상한이 반쪽이다.
     *
     * <p>발신 창과 합치지 않는 이유는 정상 사용을 막기 때문이다: 응원을 보낸 직후 재구독하는
     * (재연결 직후가 그렇다) 클라이언트가 자기 발신 때문에 구독을 거절당한다.
     */
    public static String emoteSubscribeAttempt(UUID userId) {
        return EMOTE_SUBSCRIBE_PREFIX + userId;
    }
}
