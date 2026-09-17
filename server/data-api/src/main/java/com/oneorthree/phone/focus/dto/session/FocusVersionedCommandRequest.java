package com.oneorthree.phone.focus.dto.session;

/**
 * pause/resume/finish 공용 요청 본문 — expectedVersion 필수(FR-P07).
 *
 * @param expectedVersion 클라가 마지막으로 본 {@code FocusSessionView.version}. 불일치는 409다
 */
public record FocusVersionedCommandRequest(Long expectedVersion) {
}
