package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandArrivalRepository;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequestStatus;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.group.service.UserIslandContextLockService;
import com.oneorthree.phone.internal.dto.InvitationResolveCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolvedView;
import com.oneorthree.phone.internal.dto.IslandInvitationIssuedView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
import com.oneorthree.phone.internal.dto.JoinIslandCommandRequest;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.support.InviteLinkUrls;
import com.oneorthree.phone.invitelink.support.SlugGenerator;
import com.oneorthree.phone.outbox.dto.PublicCommandRequest;
import com.oneorthree.phone.outbox.dto.PublicCommandResult;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 섬 초대 코드 해석·발급 (GROMO-1760 · 섬 소속 LLD §3.10~§3.11).
 *
 * <h2>코드는 재사용되고, 폐기는 세대다</h2>
 * 발급자당 활성 코드는 하나다 — 같은 (섬, 발급자) 행을 재사용해 어트리뷰션이 한 줄기로 모인다.
 * TTL 은 없다. «폐기»는 발급자의 멤버십 세대 변화(이탈·강퇴·재가입)로만 일어나고, 그때의 판정은
 * {@code group_invite_links.issuance_epoch} 와 현재 세대의 대조다 — DB 에 지워지는 행이 없어도
 * 세대가 어긋난 코드는 영구히 410 이다.
 *
 * <h2>해석은 미리보기이고, 도착은 opt-in 이며, 초대 검증은 가입 커밋이 다시 한다</h2>
 * resolve 는 기본이 잠금·쓰기 없는 미리보기다. {@code arrive=true} 일 때만 그 섬에 항해 없이 도착을 남기고, 누구나 가입
 * 섬이면 가입까지 이어간다(GROMO-2264). 승인제 섬은 도착만이다 — 가입 신청은 방문자가 직접 한다. 해석의 초대 검증은
 * 사전 판정일 뿐이고, 실제 가입·신청 커밋이 발급자 멤버십 잠금 아래에서 다시 대조한다({@code IslandJoinService}).
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandInvitationService {

    private static final int MAX_SLUG_ATTEMPTS = 5;
    /** 초대 도착이 가입·신청을 하지 않은 사유 (GROMO-2264, 섬 외부 계약 §4). */
    private static final String REASON_ISLAND_LIMIT = "ISLAND_LIMIT";
    private static final String REASON_KICKED = "KICKED";

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final UserIslandContextLockService userIslandContextLockService;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final IslandArrivalRepository arrivals;
    private final GroupInviteLinkRepository inviteLinkRepository;
    private final IslandMovementGuards movementGuards;
    private final SlugGenerator slugGenerator;
    private final InviteLinkUrls inviteLinkUrls;
    private final PublicCommandService publicCommands;
    private final IslandJoinService joins;
    /** 도착 시각을 찍는 시계 (GROMO-2264). */
    private final Clock clock;

    // ---------------------------------------------------------------- §3.10 resolve

    /**
     * 초대 코드를 해석한다 (LLD §3.10). {@code arrive=true} 면 그 섬에 항해 없이 도착까지 한다 (GROMO-2264, 섬 외부 계약 §4).
     *
     * <p>토큰은 코드(slug) 그 자체다 — 코드는 이미 «발급 세대에 묶인» 참조라 별도 서명이 없어도
     * 재발급·세대 변화가 옛 토큰을 자연히 무효화한다. 가입 커밋이 그 참조를 다시 검증한다.
     *
     * <p><b>도착은 명시적 opt-in 이다.</b> 지금 앱은 해석을 읽기 전용 미리보기로 쓰고, 미리보기를 닫으면 아무것도 보내지
     * 않는다 — 해석이 저절로 가입·이동하면 구 앱은 서버만 옮겨진 채 섬 없는 화면에 남는다. 그래서 {@code arrive} 가 없거나
     * false 면 종전 그대로 잠금·쓰기 없이 지금 상태만 돌려준다({@code arrival=null}). 시스템 편지({@code ?kind=system})·
     * 나가기·강퇴({@code include=nextLocation})와 같은 혼합 버전 규칙이다.
     *
     * <p><b>도착</b>은 그 섬 1곳에만 남는다(비주민도 = 방문 도착). 그래서 승인제 섬이 나중에 승인돼도 처음 한 번의
     * 항해 없이 즉시 이동 대상이다. 누구나 가입 섬은 이어서 가입한다 — {@link #arriveByInvitation} 참고. 계약에 사유가
     * 없는 가입 거절(만원·진행 중 집중 등)은 그대로 전파하고 도착도 함께 롤백된다.
     *
     * <p><b>멱등</b>: 명령 키가 없다. 다시 불러도 도착은 upsert 이고 «이미 주민» 판정이 같은 상태를 돌려준다 —
     * 멤버십은 1건이고, 가입 신청은 해석이 만들지 않는다.
     */
    @Transactional
    public InvitationResolvedView resolve(UUID userId, InvitationResolveCommandRequest body) {
        if (!body.arriving()) {
            // 미리보기(기본) — 종전 그대로다. 잠금도 쓰기도 없다.
            User caller = userQueryService.getCaller(userId);
            GroupInviteLink link = findLink(body.code());
            return new InvitationResolvedView(summaryFor(caller, requireLiveInvitation(link)), link.getSlug(), null);
        }
        // 잠금 순서는 가입과 같다(users → context → groups) — 도착이 가입으로 이어지고 가입이 같은 행을 다시 잠근다.
        User caller = userQueryService.getCallerForUpdate(userId);
        GroupInviteLink link = findLink(body.code());
        userIslandContextLockService.lock(caller);
        membershipLocks.lockGroup(link.getGroupId());
        Group island = requireLiveInvitation(link);
        InvitationResolvedView.Arrival arrival = arriveByInvitation(caller, island, link.getSlug());
        // 요약은 도착·가입 «뒤» 의 본인 기준 값이다 — arrival 과 같은 membershipStatus 를 말한다.
        return new InvitationResolvedView(summaryFor(caller, island), link.getSlug(), arrival);
    }

    /** 코드로 초대 링크를 찾는다 — 형식 오류는 422, 없는 코드는 404 다. */
    private GroupInviteLink findLink(String rawCode) {
        return inviteLinkRepository.findBySlug(normalizeCode(rawCode))
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.SLUG_NOT_FOUND));
    }

    /** 초대가 가리키는 섬 — 섬이 살아 있고 발급자가 발급 세대 그대로 주민이어야 한다. 아니면 410 이다. */
    private Group requireLiveInvitation(GroupInviteLink link) {
        Group island = groupQueryService.findGroup(link.getGroupId())
                .filter(IslandMovementGuards::isAlive)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED));
        GroupMember issuer = groupMemberRepository
                .findActiveByUserIdAndGroupId(link.getInviterId(), island.getId())
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED));
        if (issuer.getMembershipEpoch() != link.getIssuanceEpoch()) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED);
        }
        return island;
    }

    /**
     * 초대 도착 (GROMO-2264) — 그 섬에 도착을 남기고, 누구나 가입 섬이면 가입한다.
     *
     * <p>판정 순서는 {@link IslandJoinService#join} 과 같다(이미 주민 → 강퇴 → 열린 신청 → 소속 상한). 이미 주민이면
     * 도착만, 열린 신청이 있으면 그대로다. 강퇴·상한은 가입이 던질 거절을 <b>미리</b> 걸러 사유로 바꾼다 — 가입 안에서
     * 던져진 예외는 이 트랜잭션을 롤백 전용으로 만들어 잡아서 바꿀 수 없다. 그다음 누구나 가입 섬은 가입(origin=visit)을
     * 그대로 써서 가입·이동·도착한다. <b>승인제 섬은 도착만</b>이다(기획 정본 «항해 단축 티켓») — 승인 전까지 방문자이고
     * [가입 신청] 은 방문자가 직접 누른다. 링크 하나가 오픈채팅에 퍼져도 섬장의 신청 목록이 저절로 차지 않는다.
     */
    private InvitationResolvedView.Arrival arriveByInvitation(User caller, Group island, String token) {
        UUID userId = caller.getId();
        UUID islandId = island.getId();
        Optional<GroupMember> prior = groupMemberRepository.findAnyByUserAndGroup(caller, island);
        String status = IslandSummaries.STATUS_NONE;
        String reason = null;
        if (prior.isPresent() && !prior.get().isLeft()) {
            status = IslandSummaries.STATUS_ACTIVE;
        } else if (prior.isPresent() && prior.get().isKicked()) {
            reason = REASON_KICKED;
        } else if (joinRequestRepository.findByIslandIdAndApplicantIdAndStatus(
                islandId, userId, IslandJoinRequestStatus.PENDING).isPresent()) {
            status = IslandSummaries.STATUS_PENDING;
        } else if (movementGuards.atJoinedIslandLimit(caller)) {
            reason = REASON_ISLAND_LIMIT;
        } else if (!island.isApprovalRequired()) {
            // 해석에는 명령 키가 없어 이번 호출용 키를 만든다 — 재시도 멱등은 receipt 가 아니라 위의 판정이 준다.
            status = joins.join(userId, islandId, new JoinIslandCommandRequest(token), UUID.randomUUID()).status();
        }
        // 즉시 가입은 가입이 이미 도착을 남겼다 — 다시 남겨도 같은 행의 last 만 갱신된다.
        arrivals.recordArrival(userId, islandId, clock.instant());
        return new InvitationResolvedView.Arrival(islandId, true, status, reason);
    }

    // ---------------------------------------------------------------- §3.11 invite

    /**
     * 그 섬의 활성 초대 코드를 돌려준다 — 없으면 만들고, 세대가 어긋났으면 새 버전으로 교체한다.
     *
     * <p>이미 유효한 코드가 있으면 <b>같은 값</b>을 돌려준다(발급자당 활성 코드 1개). 발급자의
     * 세대가 발급 이후 바뀌었다면 옛 슬러그는 폐기이므로 새 슬러그로 갱신해 새 버전을 만든다.
     */
    @Transactional
    public IslandInvitationIssuedView issue(UUID userId, UUID islandId, UUID idempotencyKey) {
        PublicCommandRequest command = new PublicCommandRequest(userId,
                "POST:/islands/" + islandId + "/invitations:" + userId,
                idempotencyKey, InternalJson.tree(Map.of()));
        JsonNode data = publicCommands.run(command,
                () -> userQueryService.getCallerForUpdate(userId),
                ignored -> userQueryService.getCallerForUpdate(userId),
                () -> {
                    userQueryService.getCallerForUpdate(userId);
                    membershipLocks.lockGroup(islandId);
                    Group island = groupQueryService.getGroup(islandId);
                    IslandMovementGuards.requireAlive(island);
                    GroupMember issuer = groupMemberRepository
                            .findActiveByUserIdAndGroupId(userId, islandId)
                            .orElseThrow(() -> new GroupException(GroupErrorCode.MEMBER_ONLY));
                    GroupInviteLink link = inviteLinkRepository
                            .findByGroupIdAndInviterId(islandId, userId)
                            .orElse(null);
                    if (link == null) {
                        link = inviteLinkRepository.save(new GroupInviteLink(
                                uniqueSlug(), islandId, userId, issuer.getMembershipEpoch()));
                    } else if (link.getIssuanceEpoch() != issuer.getMembershipEpoch()) {
                        // 발급자의 세대가 바뀐 뒤라 옛 슬러그는 폐기 — 같은 행을 새 버전으로 교체한다.
                        // 그룹 락 밖의 레거시 발급(InviteLinkService)과도 겹칠 수 있어 조건부 UPDATE 로
                        // 수렴시키고, 이긴 쪽 슬러그로 관리 엔티티를 맞춘다(같은 값이라 flush 는 무해하다).
                        inviteLinkRepository.reissueIfStale(
                                link.getId(), uniqueSlug(), issuer.getMembershipEpoch());
                        link.reissue(inviteLinkRepository.findSlugById(link.getId()),
                                issuer.getMembershipEpoch());
                    }
                    return new PublicCommandResult(200, InternalJson.tree(
                            new IslandInvitationIssuedView(
                                    link.getSlug(), inviteLinkUrls.universalLink(link), null)),
                            InternalJson.tree(List.of()));
                }).value().data();
        return InternalJson.decode(data, IslandInvitationIssuedView.class);
    }

    // ---------------------------------------------------------------- 내부

    /** 형식 오류는 422 — 코드가 «존재하지 않는다»와 «코드 모양이 아니다»는 다른 계약이다(§4 에러 표). */
    private static String normalizeCode(String raw) {
        String code = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (!SlugGenerator.FORMAT.matcher(code).matches()) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_CODE_INVALID);
        }
        return code;
    }

    private IslandSummaryView summaryFor(User caller, Group island) {
        int memberCount = groupMemberRepository.countByGroupIdIn(List.of(island.getId())).stream()
                .mapToInt(row -> (int) row.getMemberCount())
                .sum();
        boolean mine = groupMemberRepository.findByUserAndGroup(caller, island).isPresent();
        IslandJoinRequest latest = joinRequestRepository
                .findLatestByIslandIdAndApplicantId(
                        island.getId(), caller.getId(), PageRequest.of(0, 1))
                .stream().findFirst().orElse(null);
        String status = mine ? IslandSummaries.STATUS_ACTIVE
                : latest != null && latest.isPending()
                        ? IslandSummaries.STATUS_PENDING : IslandSummaries.STATUS_NONE;
        return IslandSummaries.of(island, memberCount, status,
                latest == null ? null : latest.getId(),
                arrivals.existsByUserIdAndIslandId(caller.getId(), island.getId()));
    }

    private String uniqueSlug() {
        for (int attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
            String slug = slugGenerator.generate();
            if (!inviteLinkRepository.existsBySlug(slug)) {
                return slug;
            }
        }
        // 여기 도달하면 난수 생성기나 알파벳 규칙이 깨진 것이다 — 조용히 재시도하지 않고 드러낸다.
        throw new InviteLinkException(InviteLinkErrorCode.SLUG_GENERATION_FAILED);
    }
}
