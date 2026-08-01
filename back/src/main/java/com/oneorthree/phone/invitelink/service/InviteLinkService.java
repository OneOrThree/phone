package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.group.domain.Group;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import com.oneorthree.phone.invitelink.dto.LandingView;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.support.InviteLinkGa4Events;
import com.oneorthree.phone.invitelink.support.InviteLinkUrls;
import com.oneorthree.phone.invitelink.support.SlugGenerator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/**
 * 초대 링크 발급·조회 — (그룹, 초대자)당 1링크를 만들고 재사용한다.
 *
 * <p><b>왜 {@code @Transactional} 이 없나</b>: 동시 발급이 UNIQUE(group_id, inviter_id) 를 때렸을 때
 * "상대가 먼저 만든 링크를 재조회해 돌려준다" 가 정답인데, 하나의 트랜잭션 안에서 제약 위반이 나면
 * 그 트랜잭션은 rollback-only 로 마킹돼 이어지는 재조회가 커밋 시점에 터진다. 검증·조회·저장을
 * 각자의 트랜잭션(리포지토리 기본)으로 두면 실패한 INSERT 만 롤백되고 재조회는 깨끗한 트랜잭션에서 돈다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class InviteLinkService {

    /** slug 충돌 재시도 횟수. 31^8 공간이라 실제로 1회 이상 도는 일은 사실상 없다. */
    private static final int MAX_SLUG_ATTEMPTS = 5;

    private final GroupInviteLinkRepository inviteLinkRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final SlugGenerator slugGenerator;
    private final InviteLinkUrls inviteLinkUrls;
    private final InviteLinkGa4Events ga4Events;

    public IssueInviteLinkResponse issue(UUID groupId, UUID userId) {
        // 삭제된 그룹은 없는 그룹과 같게 다룬다 — 랜딩(만료 처리)과 판정 기준을 맞춘다.
        if (findActiveGroup(groupId).isEmpty()) {
            throw new InviteLinkException(InviteLinkErrorCode.GROUP_NOT_FOUND);
        }
        if (!groupMemberRepository.existsByGroupIdAndUserId(groupId, userId)) {
            throw new InviteLinkException(InviteLinkErrorCode.NOT_MEMBER);
        }

        Optional<GroupInviteLink> existing = inviteLinkRepository.findByGroupIdAndInviterId(groupId, userId);
        if (existing.isPresent()) {
            return toResponse(existing.get());
        }

        GroupInviteLink link;
        try {
            link = inviteLinkRepository.save(new GroupInviteLink(generateUniqueSlug(), groupId, userId));
        } catch (DataIntegrityViolationException e) {
            // 동시 발급 레이스 — 상대가 먼저 넣었으면 그 링크가 정답이다(멱등).
            return inviteLinkRepository.findByGroupIdAndInviterId(groupId, userId)
                    .map(this::toResponse)
                    .orElseThrow(() -> e);
        }

        // 최초 생성일 때만 발행한다 — 공유 버튼을 열 번 눌러도 '링크 생성'은 한 번이어야 퍼널이 맞는다.
        ga4Events.linkCreated(link);
        return toResponse(link);
    }

    /**
     * 랜딩에 필요한 것을 한 번에 판정한다 — 없는 slug·사라진 그룹은 모두 "만료"로 접힌다.
     *
     * <p>컨트롤러가 링크·그룹 조회와 삭제 판정을 직접 하지 않도록 여기서 닫는다.
     */
    public LandingView resolveLanding(String slug) {
        Optional<GroupInviteLink> link = inviteLinkRepository.findBySlug(slug);
        if (link.isEmpty()) {
            return LandingView.expired();
        }

        // 링크는 살아 있지만 그룹이 사라진 경우 — 참여시킬 곳이 없으니 만료와 같게 다룬다.
        return findActiveGroup(link.get().getGroupId())
                .map(group -> new LandingView(link.get(), group.getName()))
                .orElseGet(LandingView::expired);
    }

    private Optional<Group> findActiveGroup(UUID groupId) {
        return groupRepository.findById(groupId).filter(group -> group.getDeletedAt() == null);
    }

    private String generateUniqueSlug() {
        for (int attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
            String slug = slugGenerator.generate();
            if (!inviteLinkRepository.existsBySlug(slug)) {
                return slug;
            }
        }
        // 여기 도달하면 난수 생성기나 알파벳 규칙이 깨진 것이다 — 조용히 재시도하지 않고 드러낸다.
        throw new InviteLinkException(InviteLinkErrorCode.SLUG_GENERATION_FAILED);
    }

    private IssueInviteLinkResponse toResponse(GroupInviteLink link) {
        return new IssueInviteLinkResponse(link.getSlug(), inviteLinkUrls.universalLink(link));
    }
}
