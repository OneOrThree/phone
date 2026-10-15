package com.oneorthree.phone.internal.notification.dto;

import java.util.List;

/**
 * 스냅샷 한 페이지.
 *
 * <p>커서는 <b>유저 id</b> 다(오프셋이 아니다). 이관 중에도 가입·탈퇴가 계속 일어나는데 오프셋
 * 페이징은 그 사이 삽입·삭제로 행을 <b>건너뛰거나 두 번</b> 준다 — 건너뛴 유저는 투영에 영원히
 * 없고, 그 사실이 어디에도 드러나지 않는다.
 *
 * @param items      이 페이지의 유저들. 유저 id 오름차순
 * @param nextCursor 다음 페이지의 {@code cursor}. <b>더 없으면 {@code null}</b> — 빈 문자열이
 *                   아니라 {@code null} 이라야 「끝」과 「처음부터」가 구분된다
 */
public record NotificationSnapshotPageResponse(List<NotificationSnapshotItem> items, String nextCursor) {
}
