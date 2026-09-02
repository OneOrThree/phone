package com.oneorthree.phone.group.dto;

import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 전체 인자 생성자를 public 으로 열지 않는다(빌더 전용, private) — CreateGroupRequest 와 같은 이유다.
 * 공개돼 있으면 Jackson 이 그 생성자를 properties creator 로 잡아 필드 바인딩 경로를 벗어난다.
 * 지금은 필드가 전부 String 이라 CreateGroupRequest 가 겪은 400(primitive null coercion)은 나지 않지만,
 * 이 DTO 에 primitive 가 하나라도 추가되는 순간 같은 사고가 재현된다. 관례를 그대로 따라 막아 둔다.
 * password 만 받던 기존 호출부·테스트를 위해 1-arg 생성자만 public 으로 남긴다(변경 전과 같은 모양).
 */
@Getter
@Builder
@NoArgsConstructor
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class JoinGroupRequest {

    private String password;

    /**
     * 참여 경로 — {@code invite} | {@code deferred_invite} | {@code search}.
     * 어트리뷰션 필드 3종은 전부 optional 이다(구버전 앱은 password 만 보낸다).
     */
    private String joinMethod;

    /** 초대 링크 slug. 서버가 slug↔그룹 일치를 검증해 불일치면 버린다(스펙 §6-3). */
    private String inviteSlug;

    /** GA4 app_instance_id — 서버 발행 {@code group_joined} 를 앱스트림 세션에 붙이는 데 쓴다. */
    private String appInstanceId;

    /**
     * 비밀번호만 넘기던 기존 호출부·테스트를 위한 하위호환 생성자.
     *
     * @param password 잠긴 그룹의 입력 비밀번호. 잠기지 않은 그룹이면 검증 자체를 건너뛰므로 null 이어도 된다
     */
    public JoinGroupRequest(String password) {
        this.password = password;
    }
}
