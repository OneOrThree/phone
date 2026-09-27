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
        lockDirectContactPair(blockerId, blockedId);
        users.getCallerForShare(blockerId);
        users.getTargetForShare(blockedId);
        blocks.insertIgnoreConflict(UuidV7.next(), blockerId, blockedId);
    }

    /**
     * 친구 요청·편지 발송과 차단 등록이 엇갈려도 둘 중 먼저 pair lock 을 잡은 의도만 진행한다.
     * 조회만 하는 것처럼 보여도 PostgreSQL transaction advisory lock 을 잡으므로 readOnly 로 두지 않는다.
     */
    @Transactional
    public boolean directContactBlocked(UUID first, UUID second) {
        lockDirectContactPair(first, second);
        return blocks.existsInEitherDirection(first, second);
    }

    private void lockDirectContactPair(UUID first, UUID second) {
        String a = first.toString();
        String b = second.toString();
        blocks.lockDirectContactPair(a.compareTo(b) <= 0 ? a + ":" + b : b + ":" + a);
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
}
