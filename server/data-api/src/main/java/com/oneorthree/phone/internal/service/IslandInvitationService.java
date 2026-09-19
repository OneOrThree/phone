package com.oneorthree.phone.internal.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.oneorthree.phone.group.exception.GroupErrorCode;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupQueryService;
import com.oneorthree.phone.group.repository.IslandJoinRequestRepository;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.IslandJoinRequest;
import com.oneorthree.phone.group.service.GroupMembershipMutationLocks;
import com.oneorthree.phone.internal.dto.InvitationResolveCommandRequest;
import com.oneorthree.phone.internal.dto.InvitationResolvedView;
import com.oneorthree.phone.internal.dto.IslandInvitationIssuedView;
import com.oneorthree.phone.internal.dto.IslandSummaryView;
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

import java.util.List;
import java.util.Locale;
import java.util.Map;
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
 * <h2>해석은 조언이고 검증은 커밋이다</h2>
 * resolve 는 잠금 없이 지금 상태를 돌려준다 — 그 값을 그대로 믿는 호출은 없어야 하고, 실제
 * 가입·신청 커밋이 발급자 멤버십 잠금 아래에서 다시 대조한다({@code IslandJoinService}).
 */
@Service
@Slf4j
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class IslandInvitationService {

    private static final int MAX_SLUG_ATTEMPTS = 5;

    private final UserQueryService userQueryService;
    private final GroupQueryService groupQueryService;
    private final GroupMembershipMutationLocks membershipLocks;
    private final GroupMemberRepository groupMemberRepository;
    private final IslandJoinRequestRepository joinRequestRepository;
    private final GroupInviteLinkRepository inviteLinkRepository;
    private final IslandMovementGuards movementGuards;
    private final SlugGenerator slugGenerator;
    private final InviteLinkUrls inviteLinkUrls;
    private final PublicCommandService publicCommands;

    // ---------------------------------------------------------------- §3.10 resolve

    /**
     * 초대 코드를 해석해 초대 대상 섬의 공개 요약과 가입용 토큰을 돌려준다 (LLD §3.10).
     *
     * <p>토큰은 코드(slug) 그 자체다 — 코드는 이미 «발급 세대에 묶인» 참조라 별도 서명이 없어도
     * 재발급·세대 변화가 옛 토큰을 자연히 무효화한다. 가입 커밋이 그 참조를 다시 검증한다.
     */
    public InvitationResolvedView resolve(UUID userId, InvitationResolveCommandRequest body) {
        User caller = userQueryService.getCaller(userId);
        String code = normalizeCode(body.code());
        GroupInviteLink link = inviteLinkRepository.findBySlug(code)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.SLUG_NOT_FOUND));
        Group island = groupQueryService.findGroup(link.getGroupId())
                .filter(IslandMovementGuards::isAlive)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED));
        GroupMember issuer = groupMemberRepository
                .findActiveByUserIdAndGroupId(link.getInviterId(), island.getId())
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED));
        if (issuer.getMembershipEpoch() != link.getIssuanceEpoch()) {
            throw new InviteLinkException(InviteLinkErrorCode.INVITATION_EXPIRED);
        }
        return new InvitationResolvedView(summaryFor(caller, island), link.getSlug());
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
                latest == null ? null : latest.getId());
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
