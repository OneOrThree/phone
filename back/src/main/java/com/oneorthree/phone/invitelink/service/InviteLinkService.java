package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.analytics.Ga4MeasurementClient;
import com.oneorthree.phone.common.logging.UserActivityEvent;
import com.oneorthree.phone.common.logging.UserActivityEventLogger;
import com.oneorthree.phone.group.repository.GroupMemberRepository;
import com.oneorthree.phone.group.repository.GroupRepository;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.dto.IssueInviteLinkResponse;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.support.SlugGenerator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 초대 링크 발급 — (그룹, 초대자)당 1링크를 만들고 재사용한다.
 *
 * <p><b>왜 {@code @Transactional} 이 없나</b>: 동시 발급이 UNIQUE(group_id, inviter_id) 를 때렸을 때
 * "상대가 먼저 만든 링크를 재조회해 돌려준다" 가 정답인데, 하나의 트랜잭션 안에서 제약 위반이 나면
 * 그 트랜잭션은 rollback-only 로 마킹돼 이어지는 재조회가 커밋 시점에 터진다. 검증·조회·저장을
 * 각자의 트랜잭션(리포지토리 기본)으로 두면 실패한 INSERT 만 롤백되고 재조회는 깨끗한 트랜잭션에서 돈다.
 */
@Service
@Slf4j
public class InviteLinkService {

    /** slug 충돌 재시도 횟수. 31^8 공간이라 실제로 1회 이상 도는 일은 사실상 없다. */
    private static final int MAX_SLUG_ATTEMPTS = 5;

    private final GroupInviteLinkRepository inviteLinkRepository;
    private final GroupRepository groupRepository;
    private final GroupMemberRepository groupMemberRepository;
    private final SlugGenerator slugGenerator;
    private final Ga4MeasurementClient ga4Client;
    private final UserActivityEventLogger userActivityEventLogger;
    private final String baseUrl;
    private final String env;

    public InviteLinkService(
            GroupInviteLinkRepository inviteLinkRepository,
            GroupRepository groupRepository,
            GroupMemberRepository groupMemberRepository,
            SlugGenerator slugGenerator,
            Ga4MeasurementClient ga4Client,
            UserActivityEventLogger userActivityEventLogger,
            @Value("${link.base-url}") String baseUrl,
            @Value("${spring.profiles.active:local}") String env) {
        this.inviteLinkRepository = inviteLinkRepository;
        this.groupRepository = groupRepository;
        this.groupMemberRepository = groupMemberRepository;
        this.slugGenerator = slugGenerator;
        this.ga4Client = ga4Client;
        this.userActivityEventLogger = userActivityEventLogger;
        this.baseUrl = baseUrl;
        this.env = env;
    }

    public IssueInviteLinkResponse issue(UUID groupId, UUID userId) {
        if (!groupRepository.existsById(groupId)) {
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
        sendLinkCreatedEvent(link);
        // Track2(user-activity)는 GA4 와 별개로 서버 이벤트를 전량 병행 기록한다(스펙 §4-3 말미).
        userActivityEventLogger.log(UserActivityEvent.INVITE_LINK_CREATED,
                Map.of("slug", link.getSlug(), "group_id", link.getGroupId().toString()));
        return toResponse(link);
    }

    /** slug 로 링크를 찾는다. 랜딩·매치·claim 이 공유하는 조회 경로다. */
    public Optional<GroupInviteLink> findBySlug(String slug) {
        return inviteLinkRepository.findBySlug(slug);
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

    private void sendLinkCreatedEvent(GroupInviteLink link) {
        // appInstanceId 를 알 수 없는 서버 발화라 합성 client_id(링크 id)로 웹스트림에 보낸다.
        // 이벤트명·파라미터는 스펙 §4-3 표 그대로다.
        Map<String, Object> params = new HashMap<>();
        params.put("slug", link.getSlug());
        params.put("group_id", link.getGroupId().toString());
        params.put("env", env);
        ga4Client.sendWebEvent(link.getId().toString(), "invite_link_created", params);
    }

    private IssueInviteLinkResponse toResponse(GroupInviteLink link) {
        return new IssueInviteLinkResponse(link.getSlug(), buildUrl(link));
    }

    private String buildUrl(GroupInviteLink link) {
        return baseUrl + "/l/" + link.getSlug() + "?g=" + link.getGroupId();
    }
}
