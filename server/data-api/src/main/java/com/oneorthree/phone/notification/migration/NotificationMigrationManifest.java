package com.oneorthree.phone.notification.migration;

import java.util.Map;

/**
 * {@code POST /internal/admin/migration/{migrationId}/verify} 의 manifest.
 *
 * <p>「무엇을 몇 개 보냈고 그 내용이 무엇이었는가」를 <b>한 벌</b>로 못 박는다. 개수만으로는
 * 같은 개수의 다른 내용을 구분하지 못하고, 체크섬만으로는 자원 하나를 통째로 빠뜨린 것을 잡지 못한다.
 *
 * @param version    manifest 스키마 버전 — 현재 1
 * @param snapshot   export 한 벌의 식별자. 모든 import 청크와 verify/open에서 같은 값을 사용한다
 * @param resources  자원별 {@code {count, checksum}}
 * @param stopWindow 정지 창 증거
 */
public record NotificationMigrationManifest(
        int version,
        String snapshot,
        Map<String, ResourceDigest> resources,
        StopWindow stopWindow) {

    /** 현재 manifest 스키마 버전. */
    public static final int VERSION = 1;

    /**
     * 자원 하나의 개수와 체크섬.
     *
     * @param count    레코드 수
     * @param checksum {@code "<resource>:<recordKey>=<recordChecksum>\n"} 을 키 오름차순으로 이어
     *                 붙인 문자열의 SHA-256 hex. 빈 자원도 {@code SHA256("")} 로 채운다
     */
    public record ResourceDigest(long count, String checksum) {
    }

    /**
     * 정지 창 증거 — <b>이 셋이 전부 실측이어야 한다</b>.
     *
     * <h2>{@code queueDepth} 를 0 으로 하드코딩하지 않는다</h2>
     * 이 값은 「원본에 아직 나가지 않은 일이 남아 있는가」다. 0 을 적어 넣으면 <b>남은 일을 두고
     * 게이트를 여는</b> 것이고, 그 순간 그 일은 어느 쪽에서도 처리되지 않는다(구 경로는 정지했고
     * 신 경로는 그것을 모른다). 그래서 DB 에서 실제로 세고, 0 이 아니면 최종 manifest 를 만들지 않는다.
     *
     * <h2>{@code cursor} 에 시각을 적지 않는다</h2>
     * 「지금」은 단조 커서가 아니다 — 시각은 발급 순서일 뿐 커밋 순서가 아니라서(㊸), 그 시각
     * 이전이라고 해서 모두 커밋됐다는 뜻이 되지 않는다. 대신 같은 스냅샷의 {@code aggregate_versions}
     * <b>전 축 벡터를 해시</b>해 싣는다 — 그것은 실제로 커밋된 상태의 지문이다.
     *
     * @param closedAt   쓰기·구 발송·리스너·크론을 멈추고 인플라이트를 drain 한 시각(운영자 입력,
     *                   epoch millis). <b>Data 가 지어내지 않는다</b> — 우리는 그 사실을 모른다
     * @param cursor     커밋된 상태의 지문. {@code "av:<축 수>:<sha256>"} 형태
     * @param queueDepth 원본에 남은 미처리 건수 — <b>실측</b>
     * @param source     언제나 {@code "data-api"}
     */
    public record StopWindow(Long closedAt, String cursor, long queueDepth, String source) {

        /** 원본 이름 — 이 manifest 를 만든 쪽. */
        public static final String SOURCE = "data-api";
    }
}
