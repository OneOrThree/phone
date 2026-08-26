package com.oneorthree.phone.stats.service;

import com.oneorthree.phone.friend.exception.FriendErrorCode;
import com.oneorthree.phone.friend.exception.FriendException;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.user.domain.StatVisibility;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 통계 열람 권한(친구/PUBLIC 공개범위) 판정 컴포넌트.
 *
 * <p>{@link StatsService} 에 내장돼 있던 열람 자격 결정 로직을 분리한 컴포넌트(GROMO-779 리팩토링).
 * friends 파라미터를 쓰는 모든 stats 엔드포인트가 공통으로 사용한다.
 */
@Component
@RequiredArgsConstructor
public class StatViewPolicy {

    private final UserRepository userRepository;
    private final FriendshipRepository friendshipRepository;

    /**
     * 통계 조회 대상 userId를 결정한다 (GROMO-608, GROMO-623).
     * <p>friends 미지정(null)이거나 호출자 자신의 id 이면 친구 검증 없이 호출자 본인(self)을 반환한다.
     * friends 지정 시 호출자·대상 User 를 로드한 뒤 조회 자격을 판정한다:
     * <ul>
     *   <li>ACCEPTED 친구관계 → 허용 (대상 friends 반환)</li>
     *   <li>친구가 아니어도 대상의 statVisibility 가 <b>PUBLIC</b> 이면 허용 (GROMO-623 — 전체 공개)</li>
     *   <li>그 외(친구 아님 + 대상 statVisibility 가 FRIENDS) → NOT_FRIEND</li>
     * </ul>
     * <p>즉 PUBLIC 은 친구가 아니어도 열람을 허용하고, FRIENDS 는 ACCEPTED 친구에게만 열람을 허용한다.
     * <p>이 판정은 friends 파라미터를 쓰는 <b>모든 stats 엔드포인트에 공통 적용</b>된다(GROMO-624 로
     * by-category 까지 포함).
     *
     * @param callerId 호출자(로그인 유저) UUID
     * @param friends  조회 대상 친구 UUID (null 또는 self 이면 self)
     * @return 실제 통계 집계 대상 userId
     * @throws UserException   대상/호출자 User 미존재 (NOT_FOUND)
     * @throws FriendException 친구도 아니고 대상 공개범위도 PUBLIC 이 아님 (NOT_FRIEND)
     */
    public UUID resolveTargetUserId(UUID callerId, UUID friends) {
        // friends 미지정(null) 또는 자기 자신 조회 → 친구 검증 없이 self.
        // (self 를 friends 로 넘기면 findAcceptedBetween(caller, caller) 매칭이 없어 NOT_FRIEND 404 로 오인됨)
        if (friends == null || friends.equals(callerId)) {
            return callerId;
        }
        User caller = userRepository.findById(callerId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        User friend = userRepository.findById(friends)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
        // ACCEPTED 친구관계면 대상 공개범위와 무관하게 허용
        boolean accepted = friendshipRepository.findAcceptedBetween(caller, friend).isPresent();
        // PUBLIC 은 친구가 아니어도 열람 허용 (GROMO-623). FRIENDS 는 친구에게만.
        if (accepted || friend.getStatVisibility() == StatVisibility.PUBLIC) {
            return friends;
        }
        throw new FriendException(FriendErrorCode.NOT_FRIEND);
    }
}
