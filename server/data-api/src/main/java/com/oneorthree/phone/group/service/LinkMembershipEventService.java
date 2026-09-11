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
     * 가입 귀속을 내구 기록한다 (ⓑ′).
     *
     * <p>초대 slug 가 없으면(코드 가입·검색 가입) <b>적지 않는다</b> — 링크 서버가 귀속시킬 대상이
     * 없는 사건을 보내면 그쪽 원장에 의미 없는 행이 쌓이고, 그 행들이 전환 퍼널의 분모를 흐린다.
     *
     * @param groupId      가입한 그룹
     * @param joinedUserId 가입자
     * @param inviterId    초대 링크의 발급자
     * @param slug         초대 링크
     * @param joinMethod   참여 경로 — 계약이 정한 값으로 이미 좁혀진 문자열
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordJoinAttribution(UUID groupId, UUID joinedUserId, UUID inviterId, String slug,
            String joinMethod) {
        if (slug == null || slug.isBlank() || inviterId == null) {
            return;
        }
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", groupId.toString());
        params.put("inviterId", inviterId.toString());
        params.put("joinedUserId", joinedUserId.toString());
        params.put("slug", slug);
        params.put("joinMethod", joinMethod);

        // 봉투의 userId 는 «가입자»다 — 귀속의 주체가 그 사람이고, 링크 서버의 dedup 도 그 축이다.
        appendLinkCommand(EVENT_LINK_JOINED,
                EVENT_LINK_JOINED + ":" + groupId + ":" + joinedUserId,
                joinedUserId, groupId, inviterId, params, ENDPOINT_LINK_JOINED);
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
     * @param group 새 이름이 «이미 반영된» 그룹
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordGroupRenamed(Group group) {
        for (GroupMember member : groupMemberRepository.findByGroup(group)) {
            UUID inviterId = member.getUser().getId();
            long snapshotVersion = outboxCommandPort.allocateVersion(
                    AggregateRef.ofLinkMembership(group.getId(), inviterId));
            member.applyDisplaySnapshot(snapshotVersion);
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
     * @param userId      닉네임이 바뀐 유저
     * @param displayName 새 닉네임
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordDisplayNameChanged(UUID userId, String displayName) {
        for (GroupMember member : groupMemberRepository.findActiveMembershipsByUserId(userId)) {
            UUID groupId = member.getGroup().getId();
            long snapshotVersion =
                    outboxCommandPort.allocateVersion(AggregateRef.ofLinkMembership(groupId, userId));
            member.applyDisplaySnapshot(snapshotVersion);
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
        outboxCommandPort.append(new OutboxAppendCommand(
                eventId,
                SCHEMA_VERSION,
                type,
                userId,
                null,
                groupId + ":" + inviterId,
                AggregateRef.ofLinkMembership(groupId, inviterId),
                null,
                params,
                List.of(OutboxDeliveryRequest.toLink(endpointKey, null))));
    }
}
