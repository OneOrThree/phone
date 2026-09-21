package com.oneorthree.realtime.event;

import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.Set;
import java.util.UUID;

/**
 * 전달 골격의 버전·자산 소유 안전 불변식. 전체 도메인 스키마 검증은 생산자 활성화의 선행 조건이다.
 *
 * <p><b>활성화된 3종은 도메인 필드까지 본다</b>(GROMO-1765) — {@code focus.emote}·
 * {@code focus.member.updated}·{@code rest.member.updated}. 나머지 11종은 전달 어댑터가 없어
 * 공통 불변식만 본다(realtime-events LLD §8 「validator 없는 타입의 활성화 금지」의 대우다:
 * 활성화한 타입에는 validator 가 있어야 한다).
 *
 * <p>emote 는 생산자가 <b>앱의 STOMP 프레임</b>이라 당연하지만, 주민 사건 둘도 마찬가지로 검사한다 —
 * 서비스 토큰이 증명하는 것은 <b>「Data 가 보냈다」이지 「내용이 계약을 지킨다」가 아니다</b>. 생산자가
 * 필드를 빠뜨리거나 상태값을 바꾸면 그 malformed 사건이 <b>유효한 봉투로</b> 앱에 방송된다.
 *
 * <p><b>지갑은 섬 하나다</b>(GROMO-1989/2044). 종전에는 {@code islandId == null} 이면 개인 지갑
 * ({@code ownerType:user}·{@code currency:fish})으로 받는 분기가 있었지만, Data 의 유일한
 * {@code wallet.updated} 발행자가 섬 지갑만 내보내 도달할 수 없었다. 남겨 두면 다음 사람이 개인 지갑이
 * 아직 살아 있다고 읽으므로 걷어냈다 — 지금은 섬 없는 {@code wallet.updated} 가 봉투에서 거절된다.
 */
final class EventPayloadValidator {

    private static final String STATUS_PAUSED = "paused";

    /** {@code FocusSessionView.STATUS_ACTIVE}·{@code STATUS_PAUSED} 와 {@code FocusMemberEvents.STATUS_COMPLETED}. */
    private static final Set<String> MEMBER_STATUSES = Set.of("active", STATUS_PAUSED, "completed");

    private EventPayloadValidator() {
    }

    static void validate(RealtimeEventType type, UUID islandId, Long version, JsonNode payload) {
        if (payload.has("destination")) {
            throw new IllegalArgumentException("이벤트 payload에 전달 경로를 지정할 수 없습니다.");
        }
        boolean versionRequired = switch (type) {
            case FOCUS_MEMBER_UPDATED, REST_MEMBER_UPDATED, FOCUS_EMOTE, MESSAGE_CREATED,
                 GOLDEN_FISH_CAUGHT -> false;
            default -> true;
        };
        JsonNode payloadVersion = payload.get("version");
        if (versionRequired || payloadVersion != null) {
            if (payloadVersion == null || !payloadVersion.isIntegralNumber()
                    || !payloadVersion.canConvertToLong() || version == null || payloadVersion.longValue() != version) {
                throw new IllegalArgumentException("payload 버전과 자원 버전이 일치하지 않습니다.");
            }
        }
        if (type == RealtimeEventType.MESSAGE_CREATED && version != 1L) {
            throw new IllegalArgumentException("불변 메시지의 최초 버전은 1입니다.");
        }
        if (type == RealtimeEventType.ISLAND_UPDATED || type == RealtimeEventType.ISLAND_MEMBERS_UPDATED) {
            if (!islandId.equals(uuidField(payload, "islandId"))) {
                throw new IllegalArgumentException("payload의 섬이 일치하지 않습니다.");
            }
        }
        if (type == RealtimeEventType.FOCUS_EMOTE) {
            validateEmote(payload);
        }
        if (type == RealtimeEventType.GOLDEN_FISH_CAUGHT) {
            validateGoldenFish(islandId, payload);
        }
        if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED || type == RealtimeEventType.REST_MEMBER_UPDATED) {
            validateMember(type, payload);
        }
        if (type == RealtimeEventType.WALLET_UPDATED || type == RealtimeEventType.INVENTORY_UPDATED) {
            UUID ownerId = ownerId(payload);
            // 여기서 islandId 가 null 일 수 있는 것은 inventory 뿐이다 — 봉투가 지갑의 개인 축을 막는다.
            String expectedOwner = islandId == null ? "user" : "island";
            if (!expectedOwner.equals(textField(payload, "ownerType"))
                    || islandId != null && !islandId.equals(ownerId)) {
                throw new IllegalArgumentException("자산 소유 범위가 일치하지 않습니다.");
            }
            if (type == RealtimeEventType.WALLET_UPDATED
                    && !"village_points".equals(textField(payload, "currency"))) {
                throw new IllegalArgumentException("자산 소유자와 재화가 일치하지 않습니다.");
            }
        }
    }

    /**
     * 응원 봉투의 도메인 불변식 — 5종·발신자·세션·만료.
     *
     * <p>{@code userId}·{@code expiresAt} 는 <b>서버가 만든다</b>(LLD §2 「클라이언트가 지정할 수 없다」).
     * 여기서 «있는지»만 보는 이유는 그 강제가 {@code FocusEmoteService} 에 있기 때문이다 — 이 클래스는
     * 어느 발신 경로로 왔든 봉투가 계약을 만족하는지만 판정한다.
     */
    private static void validateEmote(JsonNode payload) {
        uuidField(payload, "userId");
        uuidField(payload, "sessionId");
        if (!FocusEmoteType.isAllowed(textField(payload, "type"))) {
            throw new IllegalArgumentException("보낼 수 없는 응원 종류입니다.");
        }
        try {
            Instant.parse(textField(payload, "expiresAt"));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("응원 만료 시각이 올바르지 않습니다.");
        }
    }

    /**
     * 황금 물고기 봉투의 도메인 불변식 (GROMO-1956) — 섬·배분량·함께 낚은 주민.
     *
     * <p>{@code members} 를 «있는지»만 보지 않고 <b>2명 이상</b>을 요구한다. 「혼자 집중할 때는 나타나지
     * 않는다」가 기획 정본이므로, 1명짜리 봉투는 생산자 결함이고 그대로 방송하면 앱이 «혼자 낚은 황금
     * 물고기» 컷신을 재생한다. 배분량도 검사한다 — {@code reward ÷ 인원}(내림)이 계약이라, 어긋난 값은
     * 앱이 보여 줄 「내 몫」이 서버 기록과 달라진다.
     *
     * <p>{@code version} 은 요구하지 않는다(위 exempt 목록) — 이 사건은 스냅샷을 되맞출 상태가 없는
     * 일회성 연출 신호다. 대신 {@code drawnAt} 이 추첨 분이라 앱이 중복 재생을 걸러낼 수 있다.
     */
    private static void validateGoldenFish(UUID islandId, JsonNode payload) {
        if (!islandId.equals(uuidField(payload, "islandId"))) {
            throw new IllegalArgumentException("payload의 섬이 일치하지 않습니다.");
        }
        instantField(payload, "drawnAt", false);
        long reward = longField(payload, "reward", false);
        long share = longField(payload, "sharePerMember", false);
        JsonNode members = payload.get("members");
        if (members == null || !members.isArray() || members.size() < 2) {
            throw new IllegalArgumentException("황금 물고기는 함께 낚은 주민이 2명 이상이어야 합니다.");
        }
        for (JsonNode member : members) {
            uuidField(member, "userId");
            uuidField(member, "sessionId");
        }
        if (reward <= 0 || share < 0 || share != reward / members.size()) {
            throw new IllegalArgumentException("황금 물고기 배분량이 계약과 다릅니다.");
        }
    }

    /**
     * 주민 사건 둘의 도메인 불변식 — {@code FocusMemberEvents} 가 내보내는 모양 그대로다.
     *
     * <p><b>nullable 필드는 키를 유지한다</b>(LLD §6): {@code rest.member.updated} 의 active/completed
     * 전이는 {@code restStartedAt}·{@code restSeat} 를 <b>명시적 null</b> 로 실어 「이 사용자를 rest
     * 목록에서 지운다」를 나타낸다. 그래서 「키가 없다」는 거절하고 「키가 있고 값이 null」은 받는다 —
     * 둘을 합치면 필드를 빠뜨린 생산자와 정상적인 삭제 신호를 구분하지 못한다.
     *
     * <p><b>그리고 상태와의 «조합»까지 본다.</b> 필드를 따로따로만 검사하면 {@code paused} 인데 두 값이
     * null 인 사건과 {@code active}/{@code completed} 인데 값이 남은 사건이 둘 다 통과한다. 앞은 클라이언트가
     * 휴식 행을 <b>추가하지 못하고</b>(자리 번호도 시작 시각도 없다), 뒤는 <b>제거하지 못한다</b>(지우라는
     * 신호가 값에 묻힌다). 그래서 {@code paused} 면 둘 다 있어야 하고, 나머지 상태면 둘 다 null 이어야 한다.
     *
     * <p>{@code status} 는 셋 뿐이다({@code active}·{@code paused}·{@code completed}). 목록을 열거하는
     * 이유는 오타 때문이 아니라, 생산자가 새 상태값을 추가하면 앱이 모르는 값을 받기 때문이다 —
     * 여기서 거절하면 앱은 스냅샷 재조회로 복구하지만, 통과시키면 화면이 조용히 어긋난다.
     */
    private static void validateMember(RealtimeEventType type, JsonNode payload) {
        uuidField(payload, "userId");
        uuidField(payload, "sessionId");
        String status = textField(payload, "status");
        if (!MEMBER_STATUSES.contains(status)) {
            throw new IllegalArgumentException("주민 사건 상태값이 계약 밖입니다.");
        }
        instantField(payload, "serverNow", false);
        longField(payload, "sessionVersion", false);
        if (type == RealtimeEventType.FOCUS_MEMBER_UPDATED) {
            textField(payload, "subject");
            long activeSeconds = longField(payload, "activeSeconds", false);
            if (activeSeconds < 0) {
                throw new IllegalArgumentException("집중 경과 초는 음수일 수 없습니다.");
            }
            return;
        }
        boolean resting = STATUS_PAUSED.equals(status);
        instantField(payload, "restStartedAt", !resting);
        longField(payload, "restSeat", !resting);
        if (resting != (!payload.get("restStartedAt").isNull() && !payload.get("restSeat").isNull())) {
            throw new IllegalArgumentException("휴식 상태와 휴식 필드가 어긋납니다.");
        }
        if (resting && longField(payload, "restSeat", false) < 1) {
            throw new IllegalArgumentException("휴식 자리 번호가 올바르지 않습니다.");
        }
    }

    /**
     * @param nullable {@code true} 면 «키는 있고 값이 null» 을 허용한다(키 자체의 부재는 여전히 거절).
     *                 {@code false} 면 값까지 있어야 한다 — 상태와의 조합을 강제하는 데 쓴다
     */
    private static void instantField(JsonNode payload, String name, boolean nullable) {
        JsonNode value = payload.get(name);
        if (value == null) {
            throw new IllegalArgumentException("이벤트 필수 시각 키가 없습니다.");
        }
        if (value.isNull()) {
            if (nullable) {
                return;
            }
            throw new IllegalArgumentException("이벤트 시각은 null 일 수 없습니다.");
        }
        try {
            Instant.parse(textField(payload, name));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("이벤트 시각 형식이 올바르지 않습니다.");
        }
    }

    /**
     * @param nullable {@code true} 면 «키는 있고 값이 null» 을 허용한다. 반환값은 null 일 때 0 이다
     */
    private static long longField(JsonNode payload, String name, boolean nullable) {
        JsonNode value = payload.get(name);
        if (value == null) {
            throw new IllegalArgumentException("이벤트 필수 정수 키가 없습니다.");
        }
        if (value.isNull()) {
            if (nullable) {
                return 0L;
            }
            throw new IllegalArgumentException("이벤트 정수는 null 일 수 없습니다.");
        }
        if (!value.isIntegralNumber() || !value.canConvertToLong()) {
            throw new IllegalArgumentException("이벤트 정수 필드가 올바르지 않습니다.");
        }
        return value.longValue();
    }

    static UUID ownerId(JsonNode payload) {
        return uuidField(payload, "ownerId");
    }

    private static UUID uuidField(JsonNode payload, String name) {
        String value = textField(payload, name);
        UUID id = UUID.fromString(value);
        if (!id.toString().equals(value)) {
            throw new IllegalArgumentException("식별자는 소문자 UUID여야 합니다.");
        }
        return id;
    }

    private static String textField(JsonNode payload, String name) {
        JsonNode value = payload.get(name);
        if (value == null || !value.isString()) {
            throw new IllegalArgumentException("이벤트 필수 문자열이 없습니다.");
        }
        return value.stringValue();
    }
}
