package com.oneorthree.phone.internal.notification.dto;

import java.time.Instant;
import java.time.LocalTime;
import java.util.UUID;

/**
 * 알림 서버가 자기 투영을 세우는 데 필요한 <b>유저 한 명분 정본</b> (A22 · 조회 3종의 첫 번째).
 *
 * <h2>왜 이 필드들인가</h2>
 * 알림 서버는 코어 DB 를 읽지 않는다(계약 §2). 그런데 발송 여부를 가르는 축 넷 — <b>탈퇴</b>,
 * <b>세대</b>, <b>로케일</b>, <b>설정 5필드</b> — 의 정본이 이관 전까지 코어에 있다. 이관 창에서
 * 이 셋을 못 읽으면 알림 서버는 탈퇴자에게 보내고, 로그아웃한 기기에 보내고, 조용한 시간을 어긴다.
 *
 * <h2>{@code version} 은 순서 축이다</h2>
 * 스냅샷은 한 번에 다 읽히지 않는다(커서 페이징). 읽는 도중 바뀐 유저는 <b>이벤트로도</b> 오는데,
 * 그때 스냅샷 행이 나중에 도착하면 새 상태를 옛것으로 덮는다. 그래서 유저 축의 현재 outbox
 * {@code version} 을 함께 준다 — 알림 서버는 「이미 적용한 version 보다 낮으면 버린다」로 닫는다.
 * {@code settingsUpdatedAt} 은 그 자리를 대신하지 못한다(시각은 커밋 순서를 보장하지 않는다, ㊸).
 *
 * <h2>설정 행이 없을 수 있다</h2>
 * {@code user_notification_settings} 는 <b>지연 생성</b>이다 — 한 번도 설정을 만진 적 없는 유저는
 * 행이 없고, 그 상태의 의미는 「기본값(알림 on · 사운드 on · 심야 off)」이다. 그래서
 * {@code settingsPresent} 를 따로 준다 — 기본값을 서버가 미리 채워 보내면 알림 서버가 「사용자가
 * 직접 켠 것」과 구분하지 못하고, 나중에 기본값이 바뀌어도 옛 값이 박제된다.
 *
 * @param userId            유저
 * @param withdrawn         탈퇴했는가. 탈퇴자도 스냅샷에 <b>포함한다</b> — 그 기기의 토큰을 지워야
 *                          이전 계정 푸시가 그 기기로 가지 않는다
 * @param authGeneration    유저 축 세대(㊼ — 탈퇴·전 기기 로그아웃에만 증가)
 * @param displayName       표시 닉네임({@code users.nickname}). 미설정은 {@code null}. <b>additive</b> 로
 *                          넣는다 — 승인 계획 ②′ ⓐ 가 「표시명·언어·설정」을 요구하는데 이 자리가
 *                          비어 있었다. 지금 템플릿은 이 값을 쓰지 않지만, 쓰기 시작하는 순간
 *                          <b>개명한 적 없는 유저 전원이 빈 이름으로 렌더된다</b> — 제공자를 먼저
 *                          배포해 둔다(A22 ㉹)
 * @param locale            보고된 표시 언어. 미보고는 {@code null}(수신 측이 ko 폴백)
 * @param hasDeviceToken    코어가 아는 기기 토큰이 있는가 — 이관 검증용 대조값이지
 *                          <b>발송 판정 근거가 아니다</b>(토큰 정본은 이관 후 알림 DB 다)
 * @param settingsPresent   설정 행이 실재하는가. {@code false} 면 아래 5필드는 전부 {@code null}
 * @param notificationEnabled 알림 on/off
 * @param soundEnabled      소리 on/off
 * @param nightModeEnabled  사용자 지정 조용한 시간 사용 여부
 * @param nightStartTime    조용한 시간 시작. 미설정이면 {@code null}
 * @param nightEndTime      조용한 시간 종료. 미설정이면 {@code null}
 * @param settingsUpdatedAt 설정 최종 변경 시각. 감사·대조용이며 순서 판정에 쓰지 않는다
 * @param version           유저 축의 현재 outbox version. 아직 사건이 없으면 0
 */
public record NotificationSnapshotItem(
        UUID userId,
        boolean withdrawn,
        long authGeneration,
        String displayName,
        String locale,
        boolean hasDeviceToken,
        boolean settingsPresent,
        Boolean notificationEnabled,
        Boolean soundEnabled,
        Boolean nightModeEnabled,
        LocalTime nightStartTime,
        LocalTime nightEndTime,
        Instant settingsUpdatedAt,
        long version) {
}
