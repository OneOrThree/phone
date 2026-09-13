package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import java.util.Map;

/** 콘솔 행위자 판별과 감사 기록. 읽기·쓰기 «양쪽» 모두 남긴다. */
@Component
class AdminAudit {

    private final Store store;

    AdminAudit(Store store) {
        this.store = store;
    }

    /**
     * 이 요청의 행위자 — <b>인증된 신원이지 요청자가 고른 이름이 아니다.</b>
     *
     * <p>예전에는 {@code X-Console-Actor} 헤더를 정규식으로만 검사했다. 그런데 콘솔 사용자가 모두
     * 같은 {@code SVC_TOKEN_CONSOLE_TO_NOTI} 로 인증하므로, 그 토큰을 가진 {@code member-1} 이 헤더에
     * {@code member-2} 를 적으면 템플릿 수정·시험 발송·재전송이 전부 <b>남의 행위로</b> 기록됐다 —
     * 감사 원장이 「누가 했는가」를 말하지 못하면 그 원장은 없는 것과 같다.
     *
     * <p>이제 {@code ServiceAuth} 가 <b>어느 토큰으로 인증했는지</b>에서 행위자를 도출해 요청 속성에
     * 넣는다. 헤더는 더 이상 신원의 근거가 아니고, 다른 이름을 말하면 그 자리에서 거절된다.
     *
     * @param request 인증을 통과한 요청
     * @return 인증된 콘솔 행위자
     */
    static String actor(HttpServletRequest request) {
        if (request.getAttribute("notification.actor") instanceof String actor) {
            return actor;
        }
        throw new NotificationFailure(403, "CONSOLE_ACTOR_REQUIRED");
    }

    /** request 에는 FCM 토큰·앱 표시 문구 같은 원문을 넣지 않는다. 호출부가 요약만 넘긴다. */
    void record(String actor, String action, String resourceId, Map<String, Object> request) {
        store.update("INSERT INTO admin_audit(actor,action,resource_id,request) VALUES(?,?,?,?::jsonb)",
                actor, action, resourceId, Json.write(request == null ? Map.of() : request));
    }
}
