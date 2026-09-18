package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.construction.service.IslandFacilityQueryService;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.MailboxViewerResponse;
import com.oneorthree.phone.internal.dto.MessageAuthorsResponse;
import com.oneorthree.phone.internal.dto.MessageCreatedRequest;
import com.oneorthree.phone.internal.dto.MessageCreatedResponse;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.repository.EventOutboxRepository;
import com.oneorthree.phone.outbox.repository.domain.EventOutbox;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.UserRepository;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 우체통 편지방이 Data 에 묻는 세 가지 (GROMO-1775, island-mailbox LLD §1·§3·§5) — 주민 인가, 작성자
 * 표시 projection, {@code message.created} outbox 적재. 메시지 정본은 여기 없다({@code gromo_chat}, M02).
 *
 * <h2>인가 술어는 {@link #requireResident} 하나다</h2>
 * 「활성 사용자 · 살아 있는 섬 · 활성 주민 · 우체통 해금」을 한 자리에서 판정한다. 세 입구가 같은 술어를
 * 타므로 나중에 시설 해금이 실제 판정으로 바뀔 때 고칠 곳이 한 곳이다. {@code islandId} 는 곧
 * {@code groupId} 다 — 별도 섬 테이블이 없다.
 *
 * <h2>표시 projection 은 {@code name} 뿐이다</h2>
 * 원본 계약의 {@code catColor} 는 <b>싣지 않는다</b> — 그 값을 가진 컬럼이 어느 서비스에도 없다
 * (2026-09-18 실측: users 는 {@code nickname} 뿐). 외양 도메인(1783 계열)이 생기면 그 계약이 붙는다.
 * {@code null} 로 대체하지 않는 이유는 LLD §2 에서 {@code null} 이 이미 「탈퇴·비노출」이라는 뜻이기
 * 때문이다 — 전원 null 은 활성 작성자를 탈퇴자로 그리는 거짓이 된다(재영님 결정 2026-09-18).
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InternalIslandMailboxService {

    /** {@code message.created} — 14종 이벤트 표(realtime {@code RealtimeEventType}) 의 wire 이름과 같다. */
    public static final String EVENT_TYPE = "message.created";

    /** 순서 축 — 메시지는 불변이라 축마다 버전이 1 하나뿐이다(LLD §5 「aggregateVersion=1, key=(message,id)」). */
    public static final String AGGREGATE_TYPE = "MESSAGE";

    private final UserQueryService users;
    private final UserRepository userRepository;
    private final GroupQueryService groups;
    private final GroupMemberRepository members;
    private final OutboxCommandPort outbox;
    private final EventOutboxRepository events;
    private final IslandFacilityQueryService islandFacilityQueryService;

    /** 주민 인가 + 요청자 본인의 표시 projection(POST 응답의 {@code name} 이 된다). */
    @Transactional(readOnly = true)
    public MailboxViewerResponse access(UUID islandId, UUID userId) {
        User viewer = requireResident(islandId, userId);
        return new MailboxViewerResponse(viewer.getId(), viewer.getNickname());
    }

    /**
     * 작성자 표시 projection — <b>요청자가 그 섬의 주민일 때만</b>, 요청한 id 에 한해.
     *
     * <p>임의 프로필 조회 창구가 아니다(LLD §5): 호출자는 Business 뿐이고, Business 는 방금 읽은 페이지의
     * 실제 sender 집합만 넘긴다. 계정이 없는 id 는 결과에서 빠지고(가짜 프로필을 만들지 않는다),
     * 탈퇴 계정은 {@code name=null} 로 돌아간다 — 그 null 이 곧 「알 수 없음」이다. 섬을 떠난 활성 계정은
     * 이름을 준다: 현재 주민 목록에 없다고 삭제된 계정이라고 추정하지 않는다(LLD §2). 요청 순서를
     * 유지하고 중복 id 는 한 번만 답한다.
     */
    @Transactional(readOnly = true)
    public MessageAuthorsResponse authors(UUID islandId, UUID userId, List<UUID> authorIds) {
        requireResident(islandId, userId);
        LinkedHashSet<UUID> distinct = new LinkedHashSet<>(authorIds);
        Map<UUID, User> found = userRepository.findAllById(distinct).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        List<MailboxViewerResponse> authors = new ArrayList<>(distinct.size());
        for (UUID id : distinct) {
            User user = found.get(id);
            if (user != null) {
                authors.add(new MailboxViewerResponse(id, user.isDeleted() ? null : user.getNickname()));
            }
        }
        return new MessageAuthorsResponse(authors);
    }

    /**
     * {@code message.created} 를 outbox 에 적는다 — <b>메시지 저장 뒤</b>, Business 가 부른다.
     *
     * <h2>두 서비스 사이에 원자성이 없다</h2>
     * 메시지 행은 realtime 의 {@code gromo_chat} 에 이미 커밋돼 있고 이 봉투는 Data 의 {@code gromo} 에
     * 적힌다 — 다른 DB, 다른 트랜잭션이다. 「저장은 됐는데 적재는 실패」가 가능하고 그 반대는 없다(적재는
     * 저장 성공을 본 뒤에만 부른다). 실패 시 동작은 호출자({@code IslandMailboxUseCase})가 정한다: 요청은
     * 성공으로 끝내고 이 사건은 <b>유실</b>된다. 지금 그 유실이 무해한 이유는 REALTIME 전달 자체가 꺼져
     * 있어서다 — relay 에 REALTIME transport 가 등록돼 있지 않고({@code OutboxRelayService}), realtime 의
     * {@code DisabledRealtimeDelivery} 는 항상 예외를 던진다. 봉투는 내구 보류될 뿐 아무 데도 가지 않는다.
     * ponytail: 저장/적재 원자성 없음 — 전달을 켜기 전에 적재를 저장 쪽으로 옮기거나 보상 재시도. 지금은 전달이 꺼져 있어 무해.
     * 전달을 켜기 전 게이트: 이 적재를 저장과 같은 쪽으로 옮기거나 보상 재시도를 붙인다(1764 가 같은 자리를
     * 「전달이 꺼져 있어 페이로드 검증 불가」로 게이트에 올린 것과 같은 정직함이다).
     *
     * <p><b>멱등이다.</b> eventId 가 메시지 id 로 결정되므로 같은 메시지의 재시도는 «이미 있는 봉투»를
     * 그대로 돌려준다. 같은 messageId 의 적재 둘이 <i>동시에</i> 오면 뒤의 것이 {@code event_id} UNIQUE 에
     * 걸려 실패한다 — 사건은 이미 남아 있으므로 호출자 쪽 로그 한 줄로 끝난다.
     * <span>ponytail: 동시 적재 경쟁은 UNIQUE 에 맡긴다. 그 경쟁이 실제로 보이면 findByEventId 를
     * FOR UPDATE 로 바꾼다.</span>
     *
     * <p>params 에 본문은 <b>싣지 않는다</b> — M02(메시지 정본은 gromo_chat, Data 복제 금지). 전달 소비자
     * (realtime fan-out)는 자기 DB 에 본문을 이미 갖고 있어 {@code messageId} 로 읽는다. 다섯 필드뿐이다:
     * messageId · islandId · senderId · sentAt · clientMessageId (LLD §5).
     */
    @Transactional
    public MessageCreatedResponse recordMessageCreated(UUID islandId, UUID authorId, MessageCreatedRequest request) {
        String eventId = EVENT_TYPE + ":" + request.messageId();
        Optional<EventOutbox> existing = events.findByEventId(eventId);
        if (existing.isPresent()) {
            return new MessageCreatedResponse(eventId, existing.get().getVersion());
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("messageId", request.messageId().toString());
        params.put("islandId", islandId.toString());
        params.put("senderId", authorId.toString());
        params.put("sentAt", request.sentAt().toString());
        params.put("clientMessageId", request.clientMessageId().toString());
        // userId 는 인증된 명령 주체(작성자) 참조다 — 수신자 권한이나 fan-out 근거가 아니다(IslandMembershipEvents 와 같다).
        EventEnvelope envelope = outbox.append(new OutboxAppendCommand(eventId, 1, EVENT_TYPE, authorId, null,
                request.messageId().toString(), new AggregateRef(AGGREGATE_TYPE, request.messageId().toString()),
                null, params, List.of(OutboxDeliveryRequest.toRealtime(EVENT_TYPE, null))));
        return new MessageCreatedResponse(envelope.eventId(), envelope.version());
    }

    /**
     * 우체통에 들어올 수 있는가 — 세 입구의 유일한 인가 술어.
     *
     * @throws UserException {@code USER_NOT_FOUND} — 요청자 본인의 활성 계정이 없다(404, 처방은 재로그인)
     * @throws GroupException {@code MEMBER_ONLY} — 섬이 없거나·끝났거나·활성 주민이 아니다. 셋을 한 코드로
     *     합치는 것은 의도다: 갈라 주면 임의 islandId 로 «그런 섬이 있는가»가 샌다(realtime 의 NOT_A_MEMBER
     *     와 같은 이유). {@code MAILBOX_LOCKED} — 우체통 미완공(아래 참고, 지금은 나가지 않는다)
     */
    private User requireResident(UUID islandId, UUID userId) {
        User user = users.findActive(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.USER_NOT_FOUND));
        Group island = groups.findGroup(islandId)
                .filter(group -> group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED)
                .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
        if (!members.existsByGroupIdAndUserId(island.getId(), user.getId())) {
            throw new GroupException(GroupErrorCode.MEMBER_ONLY);
        }
        requireMailboxUnlocked(island.getId());
        return user;
    }

    /**
     * 섬의 우체통이 완공됐는지 — 건설 도메인(GROMO-1767)의 {@code island_facilities} 행으로 판정한다.
     * 우체통이 COMPLETED 가 아니면 403 {@code MAILBOX_LOCKED} → Business 의 {@code FACILITY_LOCKED} 다.
     */
    private void requireMailboxUnlocked(UUID islandId) {
        if (!islandFacilityQueryService.hasMailbox(islandId)) {
            throw new GroupException(GroupErrorCode.MAILBOX_LOCKED);
        }
    }
}
