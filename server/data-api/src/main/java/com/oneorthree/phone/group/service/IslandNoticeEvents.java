package com.oneorthree.phone.group.service;

import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 공지 한 건의 독립 버전 축 — {@code notice.updated} 의 유일한 발행자다 (GROMO-1771, island-board LLD §4).
 *
 * <p>버전은 별도 컬럼이 아니라 {@code aggregate_versions(NOTICE, noticeId)} 다. 생성이 1, 제목·본문·댓글
 * 변경과 삭제가 하나씩 올린다 — 삭제된 공지도 마지막 version+1 이 이 행에 남는다. 봉투의
 * {@code version} 이 곧 공개 {@code aggregateVersion}·{@code payload.version} 이다.
 *
 * <p><b>정책 B08</b>: legacy {@code /api/v1} 공지 생성·수정·삭제({@link GroupAnnouncementService})도 여기서 같은
 * 축을 올린다. 새 경로만 올리면 legacy 수정이 새 구독자에게 보이지 않는다.
 *
 * <p>params 에 version 을 적지 않는다 — 번호는 append 가 잠금 아래 한 번만 발급한다({@link IslandStateEvents}
 * 와 같다). 공개 payload {@code {noticeId, version}} 은 전달 쪽이 봉투의 version 으로 채운다.
 */
@Service
@RequiredArgsConstructor
@Transactional(propagation = Propagation.MANDATORY)
public class IslandNoticeEvents {

    public static final String AGGREGATE_TYPE = "NOTICE";
    public static final String EVENT_TYPE = "notice.updated";

    private final OutboxCommandPort outbox;

    /**
     * 공지가 생기거나 바뀌거나 지워졌다 — 댓글이 달린 것도 같은 사건이다(B08).
     *
     * @param islandId 공지가 속한 섬 — 전달 대상 토픽 {@code /topic/islands/{islandId}/events} 의 축
     * @param noticeId 순서 축
     * @param actorId  명령 주체. 수신자 권한이 아니다({@link IslandStateEvents} 와 같다)
     * @return 저장된 봉투 — 멱등 명령이 receipt 에 같은 사건을 싣는다
     */
    public EventEnvelope changed(UUID islandId, UUID noticeId, UUID actorId) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("islandId", islandId.toString());
        params.put("noticeId", noticeId.toString());
        return outbox.append(new OutboxAppendCommand(UUID.randomUUID().toString(), 1, EVENT_TYPE,
                actorId, null, noticeId.toString(), new AggregateRef(AGGREGATE_TYPE, noticeId.toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
    }
}
