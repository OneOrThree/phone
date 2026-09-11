package com.oneorthree.phone.internal.service;

import com.oneorthree.phone.common.support.InternalCommands;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupStatus;
import com.oneorthree.phone.internal.dto.ClaimIntentItemResponse;
import com.oneorthree.phone.internal.dto.ClaimIntentLeaseResponse;
import com.oneorthree.phone.internal.dto.ClaimIntentPageResponse;
import com.oneorthree.phone.internal.dto.InviteIssueContextResponse;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.InviteClaimConfirmationRepository;
import com.oneorthree.phone.invitelink.repository.InviteClaimIntentRepository;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimConfirmation;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntent;
import com.oneorthree.phone.invitelink.repository.domain.InviteClaimIntentStatus;
import com.oneorthree.phone.invitelink.support.LinkCapability;
import com.oneorthree.phone.invitelink.support.LinkCapabilityVerifier;
import com.oneorthree.phone.outbox.dto.AggregateRef;
import com.oneorthree.phone.outbox.dto.EventEnvelope;
import com.oneorthree.phone.outbox.dto.OutboxAppendCommand;
import com.oneorthree.phone.outbox.dto.OutboxDeliveryRequest;
import com.oneorthree.phone.outbox.service.OutboxCommandPort;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 링크 서버와 코어 사이의 제공자 — 발급 컨텍스트 · claim 의도 큐 · claim 확정 (A22 ㊫ · ⓚ · ㋟ · ㊄).
 *
 * <h2>Data 는 링크를 조회하지 않는다</h2>
 * 그게 ㊫ 이고 이 서비스의 존재 이유다. 링크 서버는 코어를 부를 수 없고(§3 단방향) Data 도 링크를
 * 직접 읽지 않으므로, 「그룹이 살아 있는가 · 이 사람이 활성 멤버인가」는 <b>여기서 판정해 발급 요청에
 * 실어 보낸다</b>. Data 컨트롤러가 링크를 대신 조회하는 임시 우회를 만들면 그 경계가 곧 사라진다.
 *
 * <h2>claim 은 「잠정 → 확정」 두 단계다</h2>
 * {@code claimSeq} 는 링크 서버의 <b>판정 순서</b>일 뿐 기록 순서가 아니다(㋟) — 판정 10 을 받은
 * claim 이 revoke 11 뒤에 기록되면 순서 비교만으로는 살아남는다. 그래서 링크의 기록은 잠정이고,
 * Data 가 <b>멤버십 락 아래</b> 남긴 확정 근거가 와야 유효해진다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class InternalInviteLinkService {

    /** 사건 종류 — 잠정 claim 이 확정됐다. */
    public static final String EVENT_CLAIM_CONFIRMED = "link.claimConfirmed";

    /** 링크 서버의 확정 전달 논리 키. */
    public static final String ENDPOINT_CLAIM_CONFIRMED = "link.claimConfirmed";

    private static final int SCHEMA_VERSION = 1;

    /** 목록 한 페이지의 상한 — 재개 실행자가 과도한 페이지를 요구해 스캔을 길게 잡지 못하게 한다. */
    private static final int MAX_PAGE_SIZE = 200;

    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final UserQueryService userQueryService;
    private final InviteClaimIntentRepository inviteClaimIntentRepository;
    private final InviteClaimConfirmationRepository inviteClaimConfirmationRepository;
    private final LinkCapabilityVerifier linkCapabilityVerifier;
    private final OutboxCommandPort outboxCommandPort;
    private final Clock clock;

    /**
     * 링크 발급에 실을 코어의 사실을 판정한다.
     *
     * <p>판정 순서가 응답을 가른다 — 그룹 생존 → 멤버십. 기존 {@code InviteLinkService.issue} 와 같은
     * 순서·같은 코드({@code GROUP_NOT_FOUND} · {@code NOT_MEMBER})라 앱 분기가 그대로 유지된다.
     *
     * <p><b>{@code linkVersion} 은 발급 시점에 {@code membershipEpoch} 와 같은 값이다</b>. 두 값이
     * 갈리는 것은 폐기 명령뿐이다(ⓑ″: 폐기 대상은 «전이 전» 세대, tombstone 은 «전이 후» 세대).
     * 그래도 필드를 나눠 보내는 이유는 뜻이 다르기 때문이다 — 하나로 합치면 링크 서버가 「어느
     * 의미로 쓸지」를 문맥으로 추측하게 된다.
     *
     * @param groupId   초대 대상 그룹
     * @param inviterId 발급자 — {@code X-User-Id} 다. 쿼리로 받지 않는 이유는 그러면 남을 발급자로
     *                  지정하는 표면이 생기기 때문이다
     * @return 발급 컨텍스트
     * @throws InviteLinkException {@code GROUP_NOT_FOUND}(404) · {@code NOT_MEMBER}(403)
     */
    // ⚠️ readOnly 가 아니다 — 아래 멤버십 조회가 FOR SHARE 인데, Postgres 는 read-only 트랜잭션에서
    //    그 잠금을 거절한다(GROMO-801 계열에서 이미 물린 함정이다). 이 경로는 아무것도 쓰지 않지만,
    //    「판독 직후 커밋된 탈퇴」를 못 보면 죽은 멤버십으로 링크가 발급되므로 잠금은 꼭 필요하다.
    @Transactional
    public InviteIssueContextResponse issueContext(UUID groupId, UUID inviterId) {
        Group group = groupRepository.findById(groupId)
                .filter(InternalInviteLinkService::isAlive)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.GROUP_NOT_FOUND));

        GroupMember membership = groupMemberRepository
                .findActiveByUserIdAndGroupIdForShare(inviterId, groupId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.NOT_MEMBER));

        String inviterDisplayName = userQueryService.findActive(inviterId)
                .map(User::getNickname)
                .orElse(null);

        return new InviteIssueContextResponse(
                true,
                true,
                membership.getMembershipEpoch(),
                membership.getMembershipEpoch(),
                membership.getTransitionSeq(),
                membership.getSnapshotVersion(),
                group.getName(),
                inviterDisplayName,
                groupId,
                inviterId);
    }

    /**
     * claim 의도를 <b>내구 적재</b>한다 — {@code 202} 를 줄 수 있는 유일한 근거 (㊄ · ㊺).
     *
     * <p>같은 {@code (유저, slug)} 로 다시 오면 <b>새 행을 만들지 않는다</b>. 만들면 재개가 같은 귀속을
     * 두 번 밟는다.
     *
     * <p>⚠️ 이 큐를 <b>Data 가 스스로 소비하지 않는다.</b> 링크 조회·claim 실행은 단방향 규칙(§3)과
     * ㋟ 를 동시에 어긴다 — 재개는 Business 쪽 실행자가 같은 조합(링크 잠정 → Data 확정)을 다시 밟는다.
     *
     * @param userId         claim 주체
     * @param slug           초대 링크
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 의도 식별자와 순서 version
     */
    @Transactional
    public ClaimIntentAck enqueueClaimIntent(UUID userId, String slug, String idempotencyKey) {
        String eventId = "link.claimIntent:" + userId + ":" + slug;
        // 빠른 경로 — 이미 적재된 의도는 잠금 없이 그대로 재생한다.
        Optional<InviteClaimIntent> existing = inviteClaimIntentRepository.findByEventId(eventId);
        if (existing.isPresent()) {
            InviteClaimIntent intent = existing.get();
            return new ClaimIntentAck(intent.getId(), intent.getEventId(), intent.getVersion());
        }
        String key = idempotencyKey == null || idempotencyKey.isBlank()
                ? "claim-intent:" + UUID.randomUUID() : idempotencyKey.trim();
        // 순서 version 은 유저 축 잠금 아래 발급한다 — 이 값이 응답 봉투의 version 이다(㉵).
        //
        // 이 잠금이 «검사-후-삽입» 경합도 함께 막는다: 같은 (유저, slug) 로 동시에 들어온 두 요청은
        // 위 조회를 둘 다 비운 채 통과할 수 있고, 그대로 저장하면 뒤선 쪽이 event_id UNIQUE 에 걸려
        // 500 이 된다(적재는 202 의 유일한 근거라, 그 500 은 사용자에게 claim 실패로 보인다).
        // 잠금은 커밋까지 유지되므로 뒤선 트랜잭션은 여기서 «기다리고», 깨어난 뒤 아래에서 다시 본다.
        //
        // ⚠️ 이 경로는 «기존» 의도 행을 잠그지 않는다(아래 재조회도 무락이다). 그게 락 순서를 지키는
        //    방법이다 — 의도 행을 잡은 뒤 aggregate 를 잡는 경로가 하나라도 생기면 확정 경로
        //    (aggregate → 의도 행)와 고리를 이뤄 교착이 된다. 여기서 필요한 직렬화는 이 잠금이 이미 준다.
        long version = outboxCommandPort.allocateVersion(AggregateRef.ofUser(userId));
        // 잠금 «뒤» 재조회 — 먼저 들어온 트랜잭션이 커밋한 행은 이 시점에야 보인다(READ COMMITTED).
        // 제약 위반을 잡아 되돌리는 모양으로 풀지 않는 이유: 예외가 한 번 난 트랜잭션은 rollback-only
        // 가 되어 이어지는 조회·저장이 전부 무의미해진다.
        Optional<InviteClaimIntent> raced = inviteClaimIntentRepository.findByEventId(eventId);
        if (raced.isPresent()) {
            // 경합의 패자다. 발급한 version 한 칸은 버린다 — 응답은 «먼저 커밋된 행»의 값이어야 하고
            // (같은 명령에 두 version 을 주면 앱이 순서를 뒤집어 본다), 번호에 빈칸이 생기는 것은
            // 무해하다(적재는 봉투를 만들지 않으므로 relay 가 기다릴 행이 애초에 없다).
            InviteClaimIntent intent = raced.get();
            return new ClaimIntentAck(intent.getId(), intent.getEventId(), intent.getVersion());
        }
        InviteClaimIntent intent = inviteClaimIntentRepository.save(InviteClaimIntent.builder()
                .userId(userId)
                .slug(slug)
                .status(InviteClaimIntentStatus.PENDING)
                .eventId(eventId)
                .idempotencyKey(key)
                .version(version)
                .nextAttemptAt(clock.instant())
                .build());
        return new ClaimIntentAck(intent.getId(), eventId, version);
    }

    /**
     * 잠정 claim 을 <b>멤버십 락 아래</b> 확정하고 {@code link.claimConfirmed} outbox 를 적는다 (㋟ · ⓚ).
     *
     * <p>락 순서는 그룹 → 멤버십이다. 둘 다 <b>공유 락</b>인 이유는 이 경로가 둘 중 무엇도 바꾸지 않기
     * 때문이다 — 동시 확정끼리 막을 이유가 없고, 막아야 하는 것은 「판독 직후 커밋되는 탈퇴·종료」다.
     * 무락으로 읽으면 {@code GroupMember} 에 {@code @Version} 이 없어 그 커밋을 못 본다.
     *
     * <p><b>세대는 「정확히 같을 때만」 통과한다.</b> 자격에 실린 {@code membershipEpoch} 는 링크가
     * 발급된 시점의 세대다 — 그 사이 탈퇴·강퇴·재가입이 한 번이라도 끼면 같은 초대가 아니다(㋙:
     * 폐기는 그 사이 수락된 claim 까지 되돌린다).
     *
     * @param userId         claim 주체
     * @param claimId        링크가 기록한 잠정 claim
     * @param slug           초대 링크
     * @param capability     링크 서버가 서명한 자격
     * @param idempotencyKey {@code Idempotency-Key}
     * @return 완성된 봉투
     * @throws InviteLinkException {@code CLAIM_CAPABILITY_INVALID} · {@code CLAIM_REVOKED}(409)
     */
    @Transactional
    public ClaimIntentAck confirmClaim(UUID userId, UUID claimId, String slug, String capability,
            String idempotencyKey) {

        // capability는 재시도 때 만료 시각을 갱신하는 자격이다. 명령 식별자는 변하지 않는다.
        return outboxCommandPort.runIdempotent(
                InternalCommands.idempotency(idempotencyKey, userId, "claim-confirmation",
                        claimId, slug),
                ClaimIntentAck.class,
                () -> confirmOnce(userId, claimId, slug, capability)).value();
    }

    private ClaimIntentAck confirmOnce(UUID userId, UUID claimId, String slug, String capability) {
        // 같은 claim 이 «다른 멱등 키»로 다시 오면 여기서 접힌다 — 키는 앱 소유라 원 요청과 재개
        // 실행자가 서로 다른 키를 들 수 있고, 그때 키 단위 멱등만으로는 두 번 확정된다.
        Optional<InviteClaimConfirmation> already = inviteClaimConfirmationRepository.findByClaimId(claimId);
        if (already.isPresent()) {
            InviteClaimConfirmation stored = already.get();
            if (!stored.getUserId().equals(userId)) {
                // 남의 claim id 로 왔다. 저장된 응답을 그대로 돌려주면 그 안의 확정 근거·version 이
                // 새고, 그 자체가 남의 claim id 를 탐색하는 수단이 된다 — 「없는 자격」과 같게 접는다.
                throw new InviteLinkException(InviteLinkErrorCode.CLAIM_CAPABILITY_INVALID);
            }
            return new ClaimIntentAck(stored.getId(), stored.getEventId(), stored.getVersion());
        }

        LinkCapability verified = linkCapabilityVerifier.verify(capability)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_CAPABILITY_INVALID));
        if (!verified.slug().equals(slug)) {
            // 자격은 정상인데 다른 링크의 것이다 — 서명만 보고 통과시키면 한 그룹의 자격으로 다른
            // 그룹 귀속을 만들 수 있다.
            throw new InviteLinkException(InviteLinkErrorCode.CLAIM_CAPABILITY_INVALID);
        }
        if (userId.equals(verified.inviterId())) {
            // 셀프 초대 — 자기 링크를 자기가 타서 귀속·보상을 받는 경로다. 기존
            // {@code InviteLinkClick.claim} 과 {@code GroupService.resolveInviteAttribution} 이
            // 같은 검사를 하고 있었고, 링크 서버도 자격 자체를 내주지 않는다(그쪽 claim 이
            // {@code userId === link.inviter_id} 면 capability 를 null 로 돌려준다).
            //
            // 그래도 여기서 한 번 더 막는 이유: 이 경로의 신뢰 근거는 «서명»이고, 서명은 발급 시점의
            // 사실만 담는다 — 누가 그 자격을 들고 오는지는 담지 않는다. 새 코드를 만들지 않고
            // CLAIM_CAPABILITY_INVALID 로 접는 것은 앱 입장에서 결론이 같기 때문이다(귀속 없음).
            throw new InviteLinkException(InviteLinkErrorCode.CLAIM_CAPABILITY_INVALID);
        }

        Group group = groupRepository.findByIdForShare(verified.groupId())
                .filter(InternalInviteLinkService::isAlive)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_REVOKED));
        GroupMember inviterMembership = groupMemberRepository
                .findActiveByUserIdAndGroupIdForShare(verified.inviterId(), verified.groupId())
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_REVOKED));
        if (inviterMembership.getMembershipEpoch() != verified.membershipEpoch()) {
            // 발급 이후 전이가 있었다. 「최신 세대로 올려 주자」는 안 된다 — 그건 폐기된 초대를
            // 되살리는 것이다.
            throw new InviteLinkException(InviteLinkErrorCode.CLAIM_REVOKED);
        }

        Instant committedAt = clock.instant();
        // 먼저 저장해 PK 를 확정한다 — 그 값이 곧 payload 의 proof.confirmationId 라서, 봉투를 먼저
        // 적으면 근거 id 자리가 빈 채로 전달된다.
        InviteClaimConfirmation confirmation = inviteClaimConfirmationRepository.save(
                InviteClaimConfirmation.builder()
                        .claimId(claimId)
                        .userId(userId)
                        .groupId(verified.groupId())
                        .inviterId(verified.inviterId())
                        .slug(slug)
                        .membershipEpoch(inviterMembership.getMembershipEpoch())
                        .transitionSeq(inviterMembership.getTransitionSeq())
                        .eventId(EVENT_CLAIM_CONFIRMED + ":" + claimId)
                        .version(0L)
                        .committedAt(committedAt)
                        .build());

        Map<String, Object> params = new LinkedHashMap<>();
        params.put("groupId", verified.groupId().toString());
        params.put("inviterId", verified.inviterId().toString());
        params.put("membershipEpoch", inviterMembership.getMembershipEpoch());
        params.put("transitionSeq", inviterMembership.getTransitionSeq());
        params.put("claimId", claimId.toString());
        params.put("slug", slug);
        params.put("claimedUserId", userId.toString());
        Map<String, Object> proof = new LinkedHashMap<>();
        // 근거 id 는 확정 «행»의 id 다 — 링크 서버가 「무엇을 근거로 유효해졌는가」를 자기 원장에 남긴다.
        proof.put("confirmationId", confirmation.getId().toString());
        proof.put("committedAt", committedAt.toString());
        params.put("proof", proof);

        // 전달은 relay 가 한다 — 락을 잡은 채 직접 호출은 §3 위반이고, 락이 풀린 뒤 Business 가
        // 보내면 그 사이 revoke 가 끼어든다(㋟).
        EventEnvelope envelope = outboxCommandPort.append(new OutboxAppendCommand(
                confirmation.getEventId(), SCHEMA_VERSION, EVENT_CLAIM_CONFIRMED, userId, null,
                verified.groupId() + ":" + verified.inviterId(),
                AggregateRef.ofLinkMembership(verified.groupId(), verified.inviterId()),
                null, params,
                List.of(OutboxDeliveryRequest.toLink(ENDPOINT_CLAIM_CONFIRMED, null))));

        // 봉투의 version 을 확정 행에도 박는다 — 같은 claim 이 다른 멱등 키로 다시 왔을 때 «같은»
        // 응답을 재생하기 위한 값이다(㉵).
        confirmation.applyEnvelopeVersion(envelope.version());

        // 이 확정으로 끝난 대기 의도가 있으면 함께 닫는다. 안 닫으면 재개 실행자가 이미 끝난 귀속을
        // 다시 밟고, 그 재시도는 매번 「이미 확정됨」으로 접혀 큐가 영원히 비지 않는다.
        //
        // ⚠️ consume 은 «현재 리스의 토큰»을 완료 토큰으로 물려받는다 — 이 확정을 몰고 온 것이 재개
        //    실행자일 때(lease → 링크 잠정 → 이 확정), 바로 뒤에 오는 그 실행자의 완료 보고가
        //    자기 토큰으로 200 을 받아야 한다. null 로 닫으면 성공한 재개가 409 로 실패로 세어진다.
        //
        // ⚠️ 그래서 «잠근 채» 읽어야 한다. 무락으로 읽으면 물려받는 토큰이 옛 값일 수 있고(그 사이
        //    리스가 만료돼 남이 재선점했다면 완료 토큰이 «이미 죽은» 실행자의 것이 된다), 반대로
        //    그 재선점이 이 종결을 덮어 끝난 의도가 PENDING 으로 되살아난다.
        //    락 순서는 aggregate(append) → 이 행이다 — 뒤집으면 enqueue 와 교착의 고리가 생긴다.
        inviteClaimIntentRepository.findByEventIdForUpdate("link.claimIntent:" + userId + ":" + slug)
                .ifPresent(intent -> intent.consume(committedAt));

        return new ClaimIntentAck(confirmation.getId(), envelope.eventId(), envelope.version());
    }

    /**
     * 확정할 것이 없는 의도를 <b>요청자 자신이</b> 종결한다 — 링크가 「붙일 claim 이 없다」고 답한 경우다.
     *
     * <h2>왜 별도 표면이 필요한가</h2>
     * 확정이 있는 경로는 {@link #confirmClaim} 이 멤버십 락 아래에서 의도까지 닫는다. 그런데 링크가
     * {@code claimId=null} 을 주는 경우(셀프 초대 · 붙일 클릭 없음)에는 <b>확정 자체가 없어</b> 그 닫는
     * 손이 없다 — 그러면 정상 처리된 claim 의 의도가 {@code PENDING} 으로 남아 「미완료 0」 gate 를
     * 영구히 막는다. lease·완료 표시({@code /completed})는 <b>서비스 전용 재개 표면</b>이라 요청 경로가
     * 빌려 쓸 수 없다(그걸 빌리면 요청 경로가 임의 의도를 선점·완료할 권한을 갖는다). 그래서
     * <b>소유자 검사를 조회 조건에 박은</b> 이 최소 권한 표면을 따로 둔다.
     *
     * <p>종결은 {@code ABANDONED} 다 — 확정이 없었으므로 {@code CONSUMED}(「확정까지 끝났다」)로 적으면
     * 원장이 거짓이 된다.
     *
     * <p>이미 종결된 의도에 다시 와도 조용히 성공이다(멱등) — 요청 경로의 이 호출은 실패해도 사용자
     * 요청을 실패시키지 않아야 하고, 409 로 답하면 정상 재시도가 오류로 보고된다.
     *
     * @param userId    {@code X-User-Id} — 의도의 주인이어야 한다
     * @param commandId 의도 식별자
     * @throws InviteLinkException {@code CLAIM_INTENT_NOT_FOUND}(404) — 없거나 남의 것이다. 둘을 한
     *     코드로 접는 이유는 존재 여부가 응답으로 갈리면 그 자체가 남의 의도 id 를 탐색하는 수단이기 때문이다
     */
    @Transactional
    public void abandonClaimIntent(UUID userId, UUID commandId) {
        // 잠근 채 읽는다 — abandon 도 「PENDING 인가」를 보고 쓰는 전이라, 무락이면 그 판정과 쓰기
        // 사이에 끼어든 확정·재선점을 못 본다(abandon 이 물려받는 완료 토큰까지 옛 값이 된다).
        InviteClaimIntent intent = inviteClaimIntentRepository
                .findByIdAndUserIdForUpdate(commandId, userId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_INTENT_NOT_FOUND));
        // 이미 확정·종결된 의도는 덮지 않는다 — abandon 이 스스로 접는다.
        if (intent.abandon(clock.instant())) {
            log.debug("claim 의도 종결 — 붙일 대상이 없었다. commandId={}", commandId);
        }
    }

    /**
     * 재개 대상 목록 — <b>서비스 전용</b>이다({@code X-User-Id} 없음).
     *
     * @param cursor 직전 페이지의 마지막 {@code commandId}. 첫 페이지는 {@code null}
     * @param limit  최대 건수
     * @return 한 페이지와 미완료 전체 수
     */
    @Transactional(readOnly = true)
    public ClaimIntentPageResponse listClaimIntents(String cursor, Integer limit) {
        int pageSize = limit == null || limit <= 0 ? MAX_PAGE_SIZE : Math.min(limit, MAX_PAGE_SIZE);
        List<InviteClaimIntent> rows =
                inviteClaimIntentRepository.findClaimable(cursor, clock.instant(), pageSize);
        List<ClaimIntentItemResponse> items = new ArrayList<>(rows.size());
        for (InviteClaimIntent intent : rows) {
            items.add(new ClaimIntentItemResponse(
                    intent.getId(), intent.getUserId(), intent.getSlug(), intent.getIdempotencyKey(),
                    intent.getAttemptCount(), intent.getLeaseExpiresAt()));
        }
        String nextCursor = rows.size() < pageSize ? null : rows.get(rows.size() - 1).getId().toString();
        // 인플라이트·백오프 대기분까지 포함한 «전체» 미완료 수다. 이 값이 0 이어야 「남은 것이 없다」다.
        long pendingTotal = inviteClaimIntentRepository.countByStatus(InviteClaimIntentStatus.PENDING);
        return new ClaimIntentPageResponse(items, nextCursor, pendingTotal);
    }

    /**
     * 재개 대상을 선점한다.
     *
     * <p>{@code leased=false} 는 오류가 아니다 — 남이 잡고 있거나 이미 끝났다는 사실이다.
     *
     * @param commandId    의도 식별자
     * @param leaseSeconds 리스 기간(초)
     * @return 선점 결과
     * @throws InviteLinkException {@code CLAIM_INTENT_NOT_FOUND}(404)
     */
    @Transactional
    public ClaimIntentLeaseResponse leaseClaimIntent(UUID commandId, int leaseSeconds) {
        // ⚠️ 배타 잠금이 이 메서드의 계약 그 자체다. 무락으로 읽으면 동시에 들어온 두 선점이 «둘 다»
        //    만료된(또는 빈) 리스를 보고 둘 다 leased=true 를 받는다 — 마지막 커밋이 토큰을 이기지만
        //    «응답은 둘 다 성공»이라 재개 실행자 둘이 같은 귀속을 동시에 민다. 뒤선 쪽은 여기서
        //    기다렸다가 «먼저 커밋된» 리스를 보고 leased=false 로 접힌다.
        InviteClaimIntent intent = inviteClaimIntentRepository.findByIdForUpdate(commandId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_INTENT_NOT_FOUND));
        Instant now = clock.instant();
        if (intent.getStatus() != InviteClaimIntentStatus.PENDING) {
            return new ClaimIntentLeaseResponse(false, null, null);
        }
        if (intent.getLeaseExpiresAt() != null && intent.getLeaseExpiresAt().isAfter(now)) {
            return new ClaimIntentLeaseResponse(false, null, intent.getLeaseExpiresAt());
        }
        UUID token = UUID.randomUUID();
        Instant expiresAt = now.plus(Duration.ofSeconds(leaseSeconds));
        intent.lease("business-claim-replay", token, expiresAt);
        return new ClaimIntentLeaseResponse(true, token, expiresAt);
    }

    /**
     * 재개 완료 보고.
     *
     * <p>같은 성공 토큰으로 다시 와도 200 이다(멱등) — 재시도를 오류로 세면 실행자가 정상 완료를
     * 실패로 기록한다. 다른 토큰·낡은 토큰은 409 다 — 그것을 200 으로 접으면 남이 진행 중인 재개가
     * 「끝난 것」으로 덮인다.
     *
     * @param commandId  의도 식별자
     * @param leaseToken 선점 때 받은 펜싱 토큰
     * @throws InviteLinkException {@code CLAIM_INTENT_NOT_FOUND}(404) · {@code CLAIM_INTENT_LEASE_STALE}(409)
     */
    @Transactional
    public void completeClaimIntent(UUID commandId, UUID leaseToken) {
        // ⚠️ 펜싱 판정은 «잠근 뒤» 읽은 값으로만 뜻이 있다. 무락이면 리스 만료 → 재선점과 겹친 낡은
        //    보고가 재선점 «전» 행을 보고 holdsLease 를 통과해, 새 실행자가 아직 일하는 의도를
        //    끝난 것으로 덮는다(lost update). 그 귀속은 아무도 밟지 않은 채 큐에서 사라진다.
        InviteClaimIntent intent = inviteClaimIntentRepository.findByIdForUpdate(commandId)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.CLAIM_INTENT_NOT_FOUND));
        if (intent.getStatus() != InviteClaimIntentStatus.PENDING) {
            // 이미 끝났다. 이 호출이 «그 완료를 만든 토큰»이면 멱등 성공이고, 아니면 낡은 보고다.
            if (leaseToken.equals(intent.getCompletedByLeaseToken())) {
                return;
            }
            throw new InviteLinkException(InviteLinkErrorCode.CLAIM_INTENT_LEASE_STALE);
        }
        if (!intent.holdsLease(leaseToken)) {
            throw new InviteLinkException(InviteLinkErrorCode.CLAIM_INTENT_LEASE_STALE);
        }
        intent.complete(clock.instant(), leaseToken);
    }

    /** 초대 관점에서 살아 있는 그룹 — 소프트삭제뿐 아니라 종료({@code ENDED})도 걸러낸다. */
    private static boolean isAlive(Group group) {
        return group.getDeletedAt() == null && group.getStatus() != GroupStatus.ENDED;
    }

    /**
     * 내구 명령 한 건의 응답 재료.
     *
     * @param commandId 완료 표시 대상
     * @param eventId   불변 사건 식별자
     * @param version   순서 version
     */
    public record ClaimIntentAck(UUID commandId, String eventId, long version) {
    }
}
