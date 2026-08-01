package com.oneorthree.phone.group.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@NoArgsConstructor
@AllArgsConstructor
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

    /** 비밀번호만 넘기던 기존 호출부·테스트를 위한 하위호환 생성자. */
    public JoinGroupRequest(String password) {
        this.password = password;
    }
}
