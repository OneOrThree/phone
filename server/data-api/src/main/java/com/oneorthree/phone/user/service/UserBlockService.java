package com.oneorthree.phone.user.service;

import com.oneorthree.phone.common.id.UuidV7;
import com.oneorthree.phone.user.dto.BlockedUserResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserBlockRepository;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/** 사용자 차단 관계의 유일한 writer·조회 경계 (GROMO-1975). */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class UserBlockService {

    private final UserBlockRepository blocks;
    private final UserQueryService users;

    /**
     * 같은 관계를 다시 넣어도 성공한다 — 멱등은 {@code (blocker, blocked)} 유니크 +
     * {@code ON CONFLICT DO NOTHING} 이 맡는다. 조회 후 save 패턴은 두 요청이 겹치면 한쪽이
     * 유니크 위반으로 500 을 내니 쓰지 않는다. 양쪽 활성 행은 공유 잠금으로 읽어 탈퇴와 직렬화한다.
     */
    @Transactional
    public void block(UUID blockerId, UUID blockedId) {
        if (blockerId.equals(blockedId)) {
            throw new UserException(UserErrorCode.SELF_BLOCK);
        }
        users.getCallerForShare(blockerId);
        users.getTargetForShare(blockedId);
        blocks.insertIgnoreConflict(UuidV7.next(), blockerId, blockedId);
    }

    /**
     * 이미 해제됐어도 성공한다. 대상 User를 읽지 않는 이유는 없는 UUID·탈퇴 정리 뒤 UUID도 0행 삭제로
     * 접어야 DELETE 멱등 계약이 유지되기 때문이다.
     */
    @Transactional
    public void unblock(UUID blockerId, UUID blockedId) {
        users.getCallerForShare(blockerId);
        blocks.deleteByBlockerIdAndBlockedId(blockerId, blockedId);
    }

    public List<BlockedUserResponse> list(UUID blockerId) {
        User blocker = users.getCaller(blockerId);
        return blocks.findAllByBlockerWithBlocked(blocker).stream()
                .map(block -> new BlockedUserResponse(block.getBlocked().getId(), block.getBlocked().getNickname()))
                .toList();
    }

    /** blocker 관점의 화면 필터가 재사용하는 id 집합. */
    public Set<UUID> blockedIds(UUID blockerId) {
        return blocks.findBlockedIdsByBlockerId(blockerId);
    }

    /**
     * 두 유저 사이에 어느 방향이든 차단이 있는가 (GROMO-2179, policy RP-차단 「한쪽이 차단하면 서버가 양방향
     * 편지 발송과 친구 요청을 거절한다」). 직접 연락 게이트가 공통으로 쓴다.
     *
     * @param a 한쪽 유저 id
     * @param b 다른 쪽 유저 id
     * @return {@code a→b} 또는 {@code b→a} 차단이 있으면 true
     */
    public boolean isBlockedEither(UUID a, UUID b) {
        return blocks.existsBetweenEitherWay(a, b);
    }

    /**
     * 친구 요청처럼 «대상 유저»를 지목하는 직접 연락을 차단 관계에서 거절한다 (GROMO-2179).
     *
     * <p>거절 코드는 새로 만들지 않고 {@code TARGET_USER_NOT_FOUND}(404)를 재사용한다 — policy D3
     * 「차단한 사실을 상대에게 따로 알리지 않는다」: 차단당한 쪽이 «차단됐다»는 전용 코드를 받으면 그 자체가
     * 통보다. Business 는 이 코드를 이미 공개 {@code NOT_FOUND}(field=targetUserId)로 옮긴다.
     *
     * @param callerId 연락을 시도하는 유저
     * @param targetId 지목된 유저
     * @throws UserException {@code TARGET_USER_NOT_FOUND}(404) — 어느 방향이든 차단이 있다
     */
    public void requireNotBlockedEither(UUID callerId, UUID targetId) {
        if (isBlockedEither(callerId, targetId)) {
            throw new UserException(UserErrorCode.TARGET_USER_NOT_FOUND);
        }
    }
}
