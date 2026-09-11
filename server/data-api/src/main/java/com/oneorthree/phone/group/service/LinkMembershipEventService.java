package com.oneorthree.phone.group.service;

import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * 멤버십 전이·표시정보 변경을 <b>링크 서버로 가는 내구 명령</b>으로 적는다 (A22 ⓑ · ⓑ′ · ⓑ″ · ㋢ · ㋡).
 *
 * <h2>왜 도메인 트랜잭션 안이어야 하는가</h2>
 * 현행 {@code GroupService.publishJoinAttribution} 은 <b>커밋 후 fire-and-forget</b> 이라 응답 유실·
 * 프로세스 종료 시 보낼 주체가 사라진다(ⓑ′). 폐기는 더 나쁘다 — 링크가 안 지워지면 예전 slug 가 살아
 * <b>비공개 그룹 무단 가입</b>이 된다(ⓑ). 그래서 멤버십을 바꾸는 그 트랜잭션에서 봉투를 적고, 전달은
 * relay 가 재시도한다.
 *
 * <h2>세대 둘을 함께 싣는다</h2>
 * 폐기 명령은 <b>대상 {@code linkVersion}(전이 «전» 세대)</b> 과 <b>전이 후 {@code membershipEpoch}</b> 를
 * 함께 싣는다(ⓑ″ · ㋑). 새 값만 실으면 「정확히 일치」 조건 때문에 옛 세대로 발급된 링크를 못 지우고,
 * 옛 값만 실으면 「최대값보다 오래된 명령 거부」에 걸려 지연 발급을 못 막는다.
 *
 * <h2>순서 축은 {@code (groupId, inviterId)} 다</h2>
 * V51 의 직렬화는 같은 {@code userId} 단위인데, claim 사용자와 발급자는 서로 다른 유저다(㋥).
 * 그래서 링크 대상 봉투는 {@link AggregateRef#ofLinkMembership} 축에 적는다.
 *
 * <p><b>예외가 하나 있다 — {@code link.joined}.</b> 그 사건의 주체는 «가입자»이고, 새 링크 서버가
 * 발급한 slug 는 코어가 발급자를 알 수 없다(그 원장이 여기 없다). 발급자를 모르면 발급자 축을 만들
 * 수조차 없으므로 그 사건만 {@link AggregateRef#ofUser} 가입자 축에 적는다 — 같은 트랜잭션의 재가입
 * 전이와도 같은 축이라 순서가 갈리지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class LinkMembershipEventService {

    /** 발급자의 멤버십이 끝났다 — 그 (그룹, 발급자) 링크를 폐기하라. */
    public static final String EVENT_LINK_REVOKED = "link.revoked";

    /** 이 그룹에 누가 들어왔다 — 귀속 집계의 근거(ⓑ′). */
    public static final String EVENT_LINK_JOINED = "link.joined";

    /** 그룹이 삭제·종료됐다(㋢) — {@code link.revoked} 와 <b>별개 사건</b>이다. */
    public static final String EVENT_GROUP_CLOSED = "group.closed";

    /** 그룹명이 바뀌었다(㋡). */
    public static final String EVENT_GROUP_RENAMED = "group.renamed";

    /** 발급자 닉네임이 바뀌었다(㋡) — 그룹명 변경과 <b>다른 축</b>이라 키를 나눈다. */
    public static final String EVENT_DISPLAY_NAME_CHANGED = "user.displayNameChanged";

    /** 링크 서버의 폐기 명령 논리 키. */
    public static final String ENDPOINT_LINK_REVOKED = "link.revoked";

    /** 링크 서버의 가입 귀속 논리 키. */
    public static final String ENDPOINT_LINK_JOINED = "link.joined";

    /** 링크 서버의 그룹 종료 논리 키. */
    public static final String ENDPOINT_GROUP_CLOSED = "link.groupClosed";

    /** 링크 서버의 그룹명 변경 논리 키. */
    public static final String ENDPOINT_GROUP_RENAMED = "link.groupRenamed";

    /** 링크 서버의 발급자 닉네임 변경 논리 키. */
    public static final String ENDPOINT_DISPLAY_NAME_CHANGED = "link.displayNameChanged";

    private static final int SCHEMA_VERSION = 1;

    /**
     * 링크 서버가 받아들이는 slug 형식({@code text(params.slug, 12)} 과 랜딩·이관 계약의 공통 규칙).
     * 요청 DTO 에는 제약이 없어 여기서 거른다 — 형식이 어긋난 값은 재시도해도 영원히 400 이다.
     */
    private static final Pattern LINK_SLUG = Pattern.compile("^[a-z0-9]{1,12}$");

    private final OutboxCommandPort outboxCommandPort;
    private final GroupMemberRepository groupMemberRepository;

    /**
     * 멤버십 전이(탈퇴·강퇴)를 기록하고 폐기 명령을 적는다.
     *
     * <p><b>{@code leave()}·{@code kick()} 호출과 같은 트랜잭션에서</b> 불러야 한다. 세대를 올리는 것과
     * 이탈 마킹이 갈라지면, 그 사이에 발급된 링크가 새 세대를 못 받아 살아남는다.
     *
     * @param member 이탈 마킹이 «이미 끝난» 멤버십 행
     * @return 전이 후 세대
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRevoked(GroupMember member) {
        UUID groupId = member.getGroup().getId();
        UUID inviterId = member.getUser().getId();
        long transitionSeq = outboxCommandPort.allocateVersion(AggregateRef.ofLinkMembership(groupId, inviterId));
        long previousEpoch = member.applyMembershipTransition(transitionSeq);

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", groupId.toString());
        params.put("inviterId", inviterId.toString());
        // 폐기 대상은 «전이 전» 세대로 발급된 링크다. 전이 후 세대는 tombstone 갱신용이다(ⓑ″).
        params.put("linkVersion", previousEpoch);
        params.put("membershipEpoch", member.getMembershipEpoch());
        params.put("transitionSeq", transitionSeq);
        params.put("reason", member.getLeftReason() == null ? null : member.getLeftReason().name());

        appendLinkCommand(EVENT_LINK_REVOKED,
                EVENT_LINK_REVOKED + ":" + groupId + ":" + inviterId + ":" + transitionSeq,
                inviterId, groupId, inviterId, params, ENDPOINT_LINK_REVOKED);
        return member.getMembershipEpoch();
    }

    /**
     * 재가입 전이를 기록한다 — <b>세대는 여기서도 오른다</b>(ⓚ: 탈퇴·강퇴·<b>재가입</b>).
     *
     * <p>재가입에서 세대를 올리지 않으면, 탈퇴 전에 공유된 옛 링크가 재가입 후 그대로 되살아난다.
     *
     * @param member {@code rejoin()} 이 «이미 끝난» 멤버십 행
     * @return 전이 후 세대
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public long recordMembershipRejoined(GroupMember member) {
        UUID groupId = member.getGroup().getId();
        UUID inviterId = member.getUser().getId();
        long transitionSeq = outboxCommandPort.allocateVersion(AggregateRef.ofLinkMembership(groupId, inviterId));
        long previousEpoch = member.applyMembershipTransition(transitionSeq);

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", groupId.toString());
        params.put("inviterId", inviterId.toString());
        params.put("linkVersion", previousEpoch);
        params.put("membershipEpoch", member.getMembershipEpoch());
        params.put("transitionSeq", transitionSeq);
        params.put("reason", "REJOIN");

        appendLinkCommand(EVENT_LINK_REVOKED,
                EVENT_LINK_REVOKED + ":" + groupId + ":" + inviterId + ":" + transitionSeq,
                inviterId, groupId, inviterId, params, ENDPOINT_LINK_REVOKED);
        return member.getMembershipEpoch();
    }

    /**
     * 가입 <b>사실</b>을 내구 기록한다 (ⓑ′) — 귀속 판정은 <b>slug 원장을 가진 링크 서버</b>가 한다.
     *
     * <h2>왜 Data 가 발급자를 정하지 않는가</h2>
     * 발급이 Business·Link 로 넘어가면 새 slug 는 링크 원장에만 생기고 {@code group_invite_links} 에는
     * 행이 없다. 그런데 이미 로그인한 사용자가 링크를 직접 눌러 들어오는 경로({@code GroupInviteSheet}
     * → {@code joinGroup({inviteSlug})})에는 claim 도 선행하지 않는다 — claim 은 로그인 직후 1회만
     * 나가고, 클릭 후보가 없으면 링크가 {@code claimId=null} 로 정상 완료한다. 그래서 Data 가 아는 것은
     * <b>앱이 보낸 slug 문자열</b>뿐이고, 그걸로 발급자를 «추정»하면 검증되지 않은 입력이 초대 보상의
     * 근거가 된다.
     *
     * <p>그래서 여기서는 「이 사용자가 이 slug 를 들고 이 그룹에 들어왔다」는 <b>사실</b>만 적는다.
     * 링크 서버가 자기 원장에서 slug → 링크를 찾아 <b>그룹 일치·셀프 초대 배제</b>를 판정하고, 어긋나면
     * 귀속하지 않는다. 판정 주체가 원장 소유자여야 코어가 미검증 입력을 신뢰하지 않는다.
     *
     * <h2>축과 키</h2>
     * 순서 축은 <b>가입자의 유저 축</b>이다. 발급자 축({@code (groupId, inviterId)})은 발급자를 모르면
     * 만들 수조차 없고, 이 사건의 주체는 가입자다. {@code subjectId} 는 들어간 그룹이다.
     *
     * <p>사건 키에 <b>가입 회차</b>가 들어간다. 자진 탈퇴 후 다시 초대로 들어오면 같은
     * {@code (groupId, joinedUserId)} 가 두 번 생기는데, 그 둘로만 키를 만들면
     * {@code uq_event_outbox_event_id} 위반으로 <b>재가입 트랜잭션 전체가 롤백</b>된다. 「이미 있으면
     * 건너뛴다」로 접지 않는 이유는 재가입이 <b>다른 발급자의 다른 링크</b>로 들어오는 경우가 흔하고,
     * 그때 건너뛰면 그 초대가 아무 귀속도 남기지 못하기 때문이다. 링크 원장의 {@code joined_events} 는
     * {@code event_id} PK 라 회차별 행을 그대로 받는다.
     *
     * <h2>형식이 맞는 slug 만 적는다</h2>
     * {@code inviteSlug} 는 앱이 보낸 임의 문자열이고 요청 DTO 에 길이 제약이 없다. 링크 서버의 계약은
     * {@code ^[a-z0-9]{1,12}$} 라, 형식이 어긋난 값을 실어 보내면 재시도해도 영원히 400 인 명령이 relay
     * 큐에 남는다. 형식 미달은 <b>선택 어트리뷰션을 버릴 뿐</b> 가입 자체는 그대로 성공시킨다.
     *
     * @param groupId      가입한 그룹
     * @param joinedUserId 가입자 — 이 사건의 주체이자 순서 축
     * @param slug         앱이 보낸 초대 slug. 형식이 어긋나거나 비면 적지 않는다
     * @param joinMethod   참여 경로 — 계약이 정한 값으로 이미 좁혀진 문자열
     * @param joinEpoch    가입 «직후» 가입자의 멤버십 세대 — 최초 가입은 1, 전이마다 커진다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordJoinAttribution(UUID groupId, UUID joinedUserId, String slug, String joinMethod,
            long joinEpoch) {
        if (slug == null || !LINK_SLUG.matcher(slug).matches()) {
            return;
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", groupId.toString());
        params.put("joinedUserId", joinedUserId.toString());
        params.put("slug", slug);
        params.put("joinMethod", joinMethod);
        params.put("joinEpoch", joinEpoch);

        appendCommand(EVENT_LINK_JOINED,
                EVENT_LINK_JOINED + ":" + groupId + ":" + joinedUserId + ":" + joinEpoch,
                joinedUserId, groupId.toString(), AggregateRef.ofUser(joinedUserId),
                params, ENDPOINT_LINK_JOINED);
    }

    /**
     * 그룹 종료·삭제를 전달한다 (㋢).
     *
     * <p>{@code link.revoked} 와 <b>별개 사건</b>이다 — 현행 {@code resolveLanding}·
     * {@code InviteLinkMatchService} 가 <b>양쪽 다</b> {@code findActiveGroup} 으로 실시간 판정하므로,
     * 안 보내면 죽은 그룹의 slug 가 계속 랜딩·매치에 성공한다.
     *
     * <p>활성 멤버별로 펼친다(㊢). 링크 원장은 {@code (groupId, inviterId)} 단위이고 순서도 그 축이라,
     * 한 건으로 보내면 어느 축에 적용할지 정할 수 없다.
     *
     * @param group 종료된 그룹 — {@code close()} 가 «이미 끝난» 상태여야 한다
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordGroupClosed(Group group) {
        for (GroupMember member : groupMemberRepository.findByGroup(group)) {
            UUID inviterId = member.getUser().getId();
            long transitionSeq = outboxCommandPort.allocateVersion(
                    AggregateRef.ofLinkMembership(group.getId(), inviterId));
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("groupId", group.getId().toString());
            params.put("inviterId", inviterId.toString());
            params.put("membershipEpoch", member.getMembershipEpoch());
            params.put("transitionSeq", transitionSeq);
            appendLinkCommand(EVENT_GROUP_CLOSED,
                    EVENT_GROUP_CLOSED + ":" + group.getId() + ":" + inviterId + ":" + transitionSeq,
                    inviterId, group.getId(), inviterId, params, ENDPOINT_GROUP_CLOSED);
        }
    }

    /**
     * 그룹명 변경을 전달한다 (㋡) — <b>세대는 건드리지 않는다</b>.
     *
     * <p>이름이 바뀌었다고 멤버십 세대가 오르면 그 순간 공유된 링크가 전부 무효가 된다. 표시정보는
     * 별도 {@code snapshotVersion} 으로만 전진한다.
     *
     * <h2>멤버십 행을 엔티티로 고쳐 쓰지 않는다</h2>
     * 대상 목록은 <b>잠금 없이</b> 뜬다. 그 뒤 링크 멤버십 aggregate 잠금을 기다리는 동안 그 멤버의
     * 탈퇴·강퇴가 먼저 커밋될 수 있는데, 이미 로드된 엔티티에는 그 사실이 반영되지 않는다.
     * 동적 더티 갱신은 변경하지 않은 컬럼의 보존만 보장하므로, 활성 판정은 별도로 필요하다.
     * 이 경로는 유저 PK만 읽고 멤버 행을 잠근 뒤 표시 버전의 조건부 UPDATE로 활성 여부와
     * 실제 갱신 행 수를 함께 확인한다.
     *
     * <p>그 UPDATE 가 0행이면 그 사이 이탈이다 — 명령도 적지 않는다. 폐기된 링크의 표시정보를
     * 갱신할 이유가 없고, 그 시점엔 {@code link.revoked} 가 이미 같은 축에 적혀 있다. 이때 발급받은
     * version 은 쓰이지 않고 <b>번호에 구멍</b>이 남는데, relay 는 축별 「가장 낮은 «미전달 행»」을
     * 고르지 번호의 연속성을 요구하지 않으므로 그 구멍은 아무것도 막지 않는다(A21 ①).
     *
     * @param group 새 이름이 «이미 반영된» 그룹
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordGroupRenamed(Group group) {
        for (UUID inviterId : groupMemberRepository.findActiveMemberUserIdsByGroupId(group.getId())) {
            if (groupMemberRepository.lockActiveMembershipId(group.getId(), inviterId).isEmpty()) {
                continue;
            }
            long snapshotVersion = outboxCommandPort.allocateVersion(
                    AggregateRef.ofLinkMembership(group.getId(), inviterId));
            if (groupMemberRepository.advanceSnapshotVersion(group.getId(), inviterId, snapshotVersion) == 0) {
                continue;
            }
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("groupId", group.getId().toString());
            params.put("inviterId", inviterId.toString());
            params.put("groupName", group.getName());
            params.put("snapshotVersion", snapshotVersion);
            appendLinkCommand(EVENT_GROUP_RENAMED,
                    EVENT_GROUP_RENAMED + ":" + group.getId() + ":" + inviterId + ":" + snapshotVersion,
                    inviterId, group.getId(), inviterId, params, ENDPOINT_GROUP_RENAMED);
        }
    }

    /**
     * 발급자 닉네임 변경을 전달한다 (㋡) — 그 유저가 발급자인 <b>모든</b> 그룹으로.
     *
     * <p>그룹명 변경과 키를 나눈 이유는 축이 다르기 때문이다. 한 키로 합치면 링크 서버가 「무엇이
     * 바뀌었는가」를 payload 의 null 여부로 추측하게 되고, 그러면 「이름을 지웠다」와 「안 바뀌었다」가
     * 구분되지 않는다.
     *
     * <p>그룹명 변경과 같은 이유로 멤버십 행은 <b>엔티티로 고쳐 쓰지 않는다</b> — 근거는
     * {@link #recordGroupRenamed} 에 적어 두었다(표시 버전 갱신이 탈퇴를 되살리는 문제).
     *
     * @param userId      닉네임이 바뀐 유저
     * @param displayName 새 닉네임
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordDisplayNameChanged(UUID userId, String displayName) {
        for (UUID groupId : groupMemberRepository.findActiveGroupIdsByUserId(userId)) {
            if (groupMemberRepository.lockActiveMembershipId(groupId, userId).isEmpty()) {
                continue;
            }
            long snapshotVersion =
                    outboxCommandPort.allocateVersion(AggregateRef.ofLinkMembership(groupId, userId));
            if (groupMemberRepository.advanceSnapshotVersion(groupId, userId, snapshotVersion) == 0) {
                continue;
            }
            Map<String, Object> params = new LinkedHashMap<>();
            params.put("groupId", groupId.toString());
            params.put("inviterId", userId.toString());
            params.put("inviterDisplayName", displayName);
            params.put("snapshotVersion", snapshotVersion);
            appendLinkCommand(EVENT_DISPLAY_NAME_CHANGED,
                    EVENT_DISPLAY_NAME_CHANGED + ":" + groupId + ":" + userId + ":" + snapshotVersion,
                    userId, groupId, userId, params, ENDPOINT_DISPLAY_NAME_CHANGED);
        }
    }

    private void appendLinkCommand(String type, String eventId, UUID userId, UUID groupId, UUID inviterId,
            Map<String, Object> params, String endpointKey) {
        appendCommand(type, eventId, userId, groupId + ":" + inviterId,
                AggregateRef.ofLinkMembership(groupId, inviterId), params, endpointKey);
    }

    private void appendCommand(String type, String eventId, UUID userId, String subjectId,
            AggregateRef aggregate, Map<String, Object> params, String endpointKey) {
        outboxCommandPort.append(new OutboxAppendCommand(
                eventId,
                SCHEMA_VERSION,
                type,
                userId,
                null,
                subjectId,
                aggregate,
                null,
                params,
                List.of(OutboxDeliveryRequest.toLink(endpointKey, null))));
    }
}
