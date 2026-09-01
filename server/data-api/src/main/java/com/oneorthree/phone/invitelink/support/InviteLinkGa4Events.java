package com.oneorthree.phone.invitelink.support;

import com.oneorthree.phone.common.analytics.Ga4MeasurementClient;
import com.oneorthree.phone.invitelink.dto.InviteLinkRef;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 초대 퍼널의 GA4 이벤트 발행 지점 — 이벤트명·파라미터·스트림 선택 규칙을 한 곳에 모은다.
 *
 * <p>세 서비스가 각자 {@code Map} 을 조립하고 앱/웹 스트림을 각자 판단하면, 스펙 §4-3 표와의 대조를
 * 세 군데에서 해야 하고 파라미터 하나가 조용히 어긋나도 드러나지 않는다. 발행 규칙은 여기가 유일 기준이다.
 *
 * <p><b>트랜잭션 밖으로 미룬다</b>: 매치는 비관적 락을 쥔 트랜잭션 안에서 일어난다. 그 안에서 GA4 를
 * 호출하면 (구현이 동기라면) 락 보유 시간이 외부 호출에 묶인다. 커밋 이후로 미루면 락 구간은 DB 왕복만
 * 남고, 롤백된 매치가 이벤트로 새어나가지도 않는다.
 */
@Component
public class InviteLinkGa4Events {

    private final Ga4MeasurementClient ga4Client;
    private final String env;

    /**
     * @param ga4Client 전송 포트. 구현이 없는 환경에서는 no-op 이 주입되므로
     *                  이 클래스는 GA4 배선 여부를 신경 쓰지 않는다
     * @param env 이벤트에 실을 환경 태그. dev·prod 트래픽이 같은 GA4 속성에 섞여 들어오므로
     *            이 값이 없으면 리포트에서 둘을 갈라낼 수 없다
     */
    public InviteLinkGa4Events(
            Ga4MeasurementClient ga4Client,
            @Value("${spring.profiles.active:local}") String env) {
        this.ga4Client = ga4Client;
        this.env = env;
    }

    /**
     * 링크 최초 생성 (스펙 §4-3 #1).
     *
     * <p>스펙 표는 이 이벤트를 앱스트림으로 적었지만 발급 시점의 서버는 {@code app_instance_id} 를
     * 알 수 없다(앱이 아직 아무것도 보내지 않았다). 앱스트림 전송은 그 값이 필수라 웹스트림에
     * 링크 id 를 합성 client_id 로 실어 보낸다 — 이벤트명·파라미터는 계약 그대로다.
     *
     * @param link 방금 만들어진 링크. <b>최초 생성일 때만</b> 호출해야 한다 —
     *             멱등 발급이 기존 링크를 돌려주는 경로에서 부르면 공유 버튼을 누른 횟수만큼
     *             생성 이벤트가 불어나 퍼널의 분모가 무너진다
     */
    public void linkCreated(GroupInviteLink link) {
        Map<String, Object> params = baseParams();
        params.put("slug", link.getSlug());
        params.put("group_id", link.getGroupId().toString());
        publish(() -> ga4Client.sendWebEvent(link.getId().toString(), "invite_link_created", params));
    }

    /**
     * 웹 클릭 (스펙 §4-3 #3). 익명 브라우저라 클릭 id 를 합성 client_id 로 쓴다.
     *
     * @param link 클릭된 링크의 값 사본
     * @param clickId 방금 저장된 클릭 행의 id — 그대로 합성 client_id 가 되므로
     *                클릭 1건이 GA4 에서 유저 1명으로 잡힌다(익명 웹이라 그 이상 알 수 없다)
     * @param os {@code UserAgentClassifier} 가 분류한 값. 매치 fingerprint 와 같은 축이라
     *           여기 값과 매치 쪽 값이 어긋나면 퍼널의 두 단계가 이어지지 않는다
     * @param refererHost 유입 호스트(도메인만). 전체 URL 이 아니라 호스트만 싣는 건
     *                    경로에 딸려 오는 식별자가 GA4 로 새 나가지 않게 하기 위해서다
     */
    public void linkClicked(InviteLinkRef link, UUID clickId, String os, String refererHost) {
        Map<String, Object> params = baseParams();
        params.put("slug", link.slug());
        params.put("group_id", link.groupId().toString());
        params.put("os", os);
        params.put("referer_host", refererHost);
        publish(() -> ga4Client.sendWebEvent(clickId.toString(), "invite_link_clicked", params));
    }

    /**
     * 설치 후 매치 결과 (스펙 §4-3 #5) — 실패({@code matched=false})도 발행한다. 클릭 대비 매치율이
     * 퍼널의 핵심 지표라 성공만 보내면 분모가 사라진다.
     *
     * @param request 기기가 보고한 매치 요청 — {@code appInstanceId} 가 있으면 앱스트림으로,
     *                없으면 웹스트림으로 보낸다. 스트림이 갈리면 같은 유저의 퍼널이 끊기므로
     *                이 값의 유무가 곧 데이터 품질이다
     * @param link 매치된 링크. 실패면 {@code null}
     */
    public void matchResolved(InviteMatchRequest request, GroupInviteLink link) {
        Map<String, Object> params = baseParams();
        params.put("matched", link != null);
        params.put("matched_by", "ip_os_window");
        if (link != null) {
            params.put("slug", link.getSlug());
            params.put("group_id", link.getGroupId().toString());
        }

        String appInstanceId = request.appInstanceId();
        if (appInstanceId != null && !appInstanceId.isBlank()) {
            // 앱스트림으로 보내야 이후 앱 SDK 이벤트와 같은 유저 타임라인으로 결합된다.
            publish(() -> ga4Client.sendAppEvent(appInstanceId, "invite_match_resolved", params));
        } else {
            // app_instance_id 를 못 받은 기기 — 결합은 포기하되 이벤트는 남긴다.
            publish(() -> ga4Client.sendWebEvent(request.deviceId(), "invite_match_resolved", params));
        }
    }

    private Map<String, Object> baseParams() {
        Map<String, Object> params = new HashMap<>();
        // dev 트래픽이 prod 프로퍼티에 섞였을 때 사후 분리할 수 있게 전 이벤트에 환경을 동행시킨다.
        params.put("env", env);
        return params;
    }

    /** 트랜잭션 안이면 커밋 이후로 미루고, 밖이면 즉시 보낸다. */
    private void publish(Runnable send) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            send.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                send.run();
            }
        });
    }
}
