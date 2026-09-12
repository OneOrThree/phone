package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

/**
 * {@code deviceBootstrap} 이 가리키는 로그인 세션이 아직 살아 있는가 + fencing 값 (A22 ㋤ · ㋨).
 *
 * <p><b>동기 확인이 기본이다.</b> 개별 기기 로그아웃은 유저 세대를 올리지 않으므로(㊼), 비동기 폐기
 * relay 만 두면 그 지연 사이에 도착한 지연 등록이 「미사용 1회용 자격」으로 통과해 소유권이 되돌아간다.
 *
 * <p><b>확인만으로는 TOCTOU 가 남는다</b> — 그래서 Data 가 그 세션의 단조 {@code sessionEpoch} 를 함께
 * 주고, 알림 서버가 자기 세션 tombstone 과 <b>원자 대조</b>한 뒤에만 소유권을 바꾼다. 확인과 mutation
 * 이 같은 순서 경계에 들어간다.
 *
 * @param active       그 세션이 아직 활성인가
 * @param sessionEpoch 원자 대조에 쓸 fencing 값. 알림 서버가 이 값보다 오래된 소유권 변경을 거부한다
 */
public record DeviceSessionCheck(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) boolean active,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) long sessionEpoch) {
}
