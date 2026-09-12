package com.oneorthree.phone.notification.migration;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * 이관 export 한 벌 — <b>한 트랜잭션 · 한 스냅샷</b>에서 읽은 전부.
 *
 * <p>다섯 자원(설정 · 기기 · 발송 이력 · 유저 투영 · 참가 투영)과 그 manifest, 그리고 재조립 실패
 * 목록을 함께 담는다.
 * 따로 읽으면 그 사이의 변경 때문에 「토큰은 있는데 설정 행이 없는 유저」 같은 <b>어느 시점에도
 * 존재하지 않았던 상태</b>가 파일에 남고, 그것이 그대로 알림 DB 의 초기 상태가 된다.
 *
 * <h2>실패를 숨기지 않는다</h2>
 * 재조립할 수 없는 행은 {@link #failures} 에 사유와 함께 남고 게이트를 닫는다. 「몇 건은 어쩔 수
 * 없다」로 넘기면 그 몇 건이 영영 나가지 않고, 그 사실이 어디에도 드러나지 않는다.
 *
 * @param exportedAt   추출 시각
 * @param migrationId  이 export 가 겨냥한 이관 id. 운영자 입력
 * @param manifest     verify 에 그대로 실을 manifest
 * @param records      import 에 실을 wire 레코드 전량. 자원 순서대로 이어 붙이며 순서 자체는
 *                     계약이 아니다 — 자원 체크섬이 recordKey 로 다시 정렬해 접는다
 * @param failures     재조립 불가 목록 — 비어 있지 않으면 최종 manifest·개방 금지
 * @param report       사람이 눈으로 대조할 부가 정보(중복 토큰·상태별 집계)
 */
public record NotificationExportDocument(
        Instant exportedAt,
        String migrationId,
        NotificationMigrationManifest manifest,
        List<NotificationMigrationRecord> records,
        List<Failure> failures,
        Report report) {

    /**
     * 재조립 불가 한 건.
     *
     * @param resource  자원 이름
     * @param rowId     원본 행 id
     * @param userId    수신자
     * @param legacyKind 구 {@code kind} 컬럼
     * @param status    구 상태
     * @param reason    사유 코드
     * @param detail    사람이 읽을 한 줄
     */
    public record Failure(
            String resource,
            String rowId,
            String userId,
            String legacyKind,
            String status,
            String reason,
            String detail) {
    }

    /**
     * 검증 보조 정보 — wire 에 실리지 않고 운영자가 읽는다.
     *
     * @param duplicateDeviceTokens 실제 export 기기에서 같은 토큰을 들고 있는 유저 묶음. 토큰은 <b>앞 8자만</b>
     *                              — 여기는 사람이 읽는 자리라 원문을 남길 이유가 없다
     *                              (import 레코드에는 계약상 원문이 필요해 그대로 실린다)
     * @param counts                상태별·자원별 집계
     * @param queueBreakdown        잔여·화물 항목별 실측값. {@code migrationPayload} 는 화물이라
     *                              {@code queueDepth} 합계에서 빠진다
     * @param inflightDrained       운영자가 인플라이트 drain 을 확인했는가. <b>DB 로는 알 수 없는
     *                              사실</b>이라 사람이 말한 것을 그대로 기록한다
     * @param finalEligible         이 문서를 최종 verify 에 쓸 수 있는가 — 정지 창을 닫았고,
     *                              drain 확인이 있고, 재조립 실패·중복 기기 토큰이 없고, 잔여 큐가 0 일 때만 참이다.
     *                              <b>계산해서 적어 둔다</b>: 다섯 조건을 읽는 쪽마다 다시 조합하면
     *                              한 곳이 하나를 빠뜨려도 드러나지 않는다
     */
    public record Report(
            List<DuplicateDeviceToken> duplicateDeviceTokens,
            Map<String, Long> counts,
            Map<String, Long> queueBreakdown,
            boolean inflightDrained,
            boolean finalEligible) {
    }

    /**
     * 같은 기기 토큰을 들고 있는 유저들 — 계정 전환(로그아웃 없이 다른 계정 로그인)에서 생긴다.
     *
     * <p>옮기기 전에 정리하지 않으면 알림 DB 의 「토큰 단위 유일」 제약이 이관 중에 터지거나,
     * 조용히 한쪽을 떨어뜨려 <b>어느 계정의 푸시가 사라졌는지 아무도 모르게</b> 된다.
     *
     * @param deviceTokenPrefix 토큰 앞 8자
     * @param userIds           그 토큰을 들고 있는 유저들
     */
    public record DuplicateDeviceToken(String deviceTokenPrefix, List<String> userIds) {
    }
}
