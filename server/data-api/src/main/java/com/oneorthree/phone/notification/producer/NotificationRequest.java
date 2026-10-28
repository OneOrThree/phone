package com.oneorthree.phone.notification.producer;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Data 가 판정한 <b>알림 요청 하나</b> — 수신자 1명 × kind 1종 × 대상 1개.
 *
 * <p>여기에 <b>문구가 없다</b>. 제목·본문·딥링크는 kind × locale 템플릿이 만들고 그 템플릿은 알림
 * 서버가 소유한다(계약 §5). Data 가 완성 문구를 실어 보내면 로케일 추가·문구 수정이 <b>Data 배포</b>를
 * 요구하게 되어 분리한 의미가 사라진다.
 *
 * <p>fan-out 은 <b>이미 펼쳐진 뒤</b>다(㊢) — 봉투에 {@code userId} 가 하나뿐이라 한 건으로 보내면
 * 수신 측이 대상을 알아낼 방법이 없다.
 *
 * @param kind      알림 종류
 * @param userId    수신자 하나
 * @param subjectId 사건 대상 — {@link NotificationKind#subjectKind()} 가 가리키는 것. 대상이 없는
 *                  kind 는 {@code null}
 * @param occurredAtKeyHint 결정적 키의 시간 축에 쓸 원본 발생 시각. 모든 종류에서 필수다
 * @param locale    수신자의 보고된 로케일. <b>모르면 {@code null}</b> — 여기서 {@code ko} 를 박으면
 *                  「보고받은 ko」와 「모름」이 영영 구분되지 않는다
 * @param params    렌더 입력. 값은 JSON 으로 실릴 수 있는 것만
 */
public record NotificationRequest(
        NotificationKind kind,
        UUID userId,
        UUID subjectId,
        Instant occurredAtKeyHint,
        String locale,
        Map<String, Object> params) {

    public NotificationRequest {
        if (kind == null) {
            throw new IllegalArgumentException("kind 는 필수입니다.");
        }
        if (userId == null) {
            throw new IllegalArgumentException("수신자는 필수입니다 — fan-out 은 이미 펼쳐진 뒤다.");
        }
        if (subjectId == null) {
            // 대상이 있는 kind 인데 대상이 비면 결정적 키가 「유저 × kind」로 뭉쳐, 서로 다른 회차의
            // 알림이 한 건으로 접힌다(=두 번째 회차의 결과가 영영 안 나간다).
            throw new IllegalArgumentException(
                    kind + " 는 subjectId 가 필요합니다 — 결정적 키의 대상 축입니다.");
        }
        // Map.copyOf 를 쓰지 않는다 — 순서를 버리고 null 값을 거부한다. params 는 kind 별 자유 입력이라
        // nullable 필드가 정상적으로 들어온다(EventEnvelope 와 같은 이유).
        params = params == null
                ? Map.of()
                : Collections.unmodifiableMap(new LinkedHashMap<>(params));
    }
}
