package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.regex.Pattern;

/** 콘솔 행위자 판별과 감사 기록. 읽기·쓰기 «양쪽» 모두 남긴다. */
@Component
class AdminAudit {

    /** 콘솔 계정은 member-1..3 셋뿐이다. 느슨하게 받으면 감사 actor 가 자유 입력이 된다. */
    private static final Pattern ACTOR = Pattern.compile("member-[1-3]");
    private final Store store;

    AdminAudit(Store store) {
        this.store = store;
    }

    static String actor(HttpServletRequest request) {
        String value = request.getHeader("X-Console-Actor");
        if (value == null || !ACTOR.matcher(value).matches()) {
            throw new NotificationFailure(403, "CONSOLE_ACTOR_REQUIRED");
        }
        return value;
    }

    /** request 에는 FCM 토큰·앱 표시 문구 같은 원문을 넣지 않는다. 호출부가 요약만 넘긴다. */
    void record(String actor, String action, String resourceId, Map<String, Object> request) {
        store.update("INSERT INTO admin_audit(actor,action,resource_id,request) VALUES(?,?,?,?::jsonb)",
                actor, action, resourceId, Json.write(request == null ? Map.of() : request));
    }
}
