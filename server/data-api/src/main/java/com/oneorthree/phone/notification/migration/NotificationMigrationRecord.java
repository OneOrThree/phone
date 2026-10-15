package com.oneorthree.phone.notification.migration;

import java.util.Map;

/**
 * 이관 wire 레코드 하나 — {@code POST /internal/admin/migration/{migrationId}/import} 의 본문 원소.
 *
 * <p>정본은 알림 서버의 {@code MigrationRecords.java} 다. 이 record 는 그 모양을 Data 쪽에서
 * <b>그대로</b> 만들어 내기 위한 것이고, 필드가 하나라도 어긋나면 import 가 통째로 거절된다.
 *
 * <h2>시각은 전부 epoch milliseconds 정수다</h2>
 * 이벤트 봉투의 ISO-8601 과 <b>다른 축</b>이다. 섞으면 import 쪽이 파싱에 실패하거나, 더 나쁘게는
 * 문자열을 그대로 받아 1970년으로 해석한다.
 *
 * @param resource        {@code settings} · {@code device} · {@code delivery} · {@code user} ·
 *                        {@code participation}
 * @param recordKey       자원별 키. 서버도 유도하지만 함께 보내면 대조해 준다 — 보내는 편이 낫다
 *                        (유도값과 다르면 그 자리에서 걸린다)
 * @param data            자원별 본문
 * @param recordChecksum  {@code data} 정규형 JSON 의 SHA-256 hex. wire 에는 싣지 않고 manifest 의
 *                        자원 체크섬을 만드는 데 쓴다
 */
public record NotificationMigrationRecord(
        String resource,
        String recordKey,
        Map<String, Object> data,
        String recordChecksum) {

    /** 자원 이름 — 알림 설정 5필드 + version. */
    public static final String RESOURCE_SETTINGS = "settings";

    /** 자원 이름 — 기기 토큰과 소유권. */
    public static final String RESOURCE_DEVICE = "device";

    /** 자원 이름 — 발송 이력(미발송·종결 모두). */
    public static final String RESOURCE_DELIVERY = "delivery";

    /**
     * 자원 이름 — 유저 투영 <b>bootstrap</b>(승인 계획 ②′ ⓐ). 알림 서버의
     * {@code projections('user.snapshot', userId, '')} 한 행이 된다.
     *
     * <p>이름을 {@code settings} 와 나눠 둔 이유: {@code settings} 는 알림 서버의 <b>정본 테이블</b>
     * ({@code settings})로 가고, 이것은 <b>투영 캐시</b>로 간다. 한 자원으로 합치면 한쪽 보존 규칙
     * (version 비교 대상·탈퇴 tombstone)이 다른 쪽에 새어 들어간다.
     */
    public static final String RESOURCE_USER = "user";

    /**
     * 자원 이름 — 진행 중·미정산 내기 참가 투영 bootstrap(승인 계획 ②′ ⓑ). 알림 서버의
     * {@code projections('participation.updated', userId, sessionId)} 한 행이 된다.
     *
     * <p><b>컬렉션 투영</b>이라 회차({@code sessionId})마다 별도 행이다(A22 ㊂) — 유저 단위로 뭉치면
     * 늦게 도착한 다른 회차가 「오래된 것」으로 거부돼 그 회차의 참가자가 영영 안 생긴다.
     */
    public static final String RESOURCE_PARTICIPATION = "participation";

    /**
     * 체크섬을 계산해 레코드를 만든다.
     *
     * @param resource  자원 이름
     * @param recordKey 자원 키
     * @param data      본문
     * @return 체크섬이 채워진 레코드
     */
    public static NotificationMigrationRecord of(String resource, String recordKey, Map<String, Object> data) {
        return new NotificationMigrationRecord(resource, recordKey, data,
                MigrationCanonicalJson.hash(data));
    }

    /**
     * import 요청 본문에 실을 모양 — {@code recordChecksum} 은 빠진다(그건 manifest 쪽 값이다).
     *
     * @return {@code {resource, recordKey, data}}
     */
    public Map<String, Object> toWire() {
        return Map.of("resource", resource, "recordKey", recordKey, "data", data);
    }
}
