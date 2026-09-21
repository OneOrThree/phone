package com.oneorthree.phone.friend.service.search;

import com.oneorthree.phone.user.service.UserTierLookup;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 닉네임 <b>전체 일치</b> 검색 전략 — 대소문자는 구분하지 않는다 (GROMO-1996).
 *
 * <p>정책(policy-2026-09-14): 「친구 검색은 대소문자를 구분하지 않고 <b>정확히 일치할 때만</b> 결과를
 * 보여 주며 본인과 탈퇴한 사용자는 제외한다.」
 *
 * <p>종전에는 pg_trgm 유사도({@code searchByNicknameTrgm})로 오타·부분 입력까지 잡았다. 그 편의의
 * 대가가 「닉네임 두 글자를 넣고 이 앱을 누가 쓰는지 훑어본다」였다 — 친구 추가는 상대의 닉네임을 이미
 * 아는 사람만 하면 되는 일이라 그 대가를 치를 이유가 없다. 닉네임이 대소문자 무시로 유일하므로
 * (V89 {@code uq_users_nickname_lower}) 결과는 <b>최대 한 건</b>이다 — 상한을 따로 둘 필요가 없어졌다.
 *
 * <p>본인 제외는 여기가 아니라 {@code FriendService.search} 다 — 관계 배지 판정과 같은 자리라야
 * 두 필터가 갈라지지 않는다. 탈퇴자 제외는 쿼리 안에 있다.
 */
@Component
@RequiredArgsConstructor
public class NicknameSearchStrategy implements FriendSearchStrategy {

    private final UserRepository userRepository;
    private final UserTierLookup userTierLookup;

    @Override
    public SearchType type() {
        return SearchType.NICKNAME;
    }

    /**
     * 닉네임 전체 일치(대소문자 무시) 원시 결과 반환. 자기자신(me) 제외·relation 표기는 FriendService 후처리.
     */
    @Override
    public List<FriendSearchResult> search(UUID me, String query) {
        // 저장이 trim 이라 앞뒤 공백은 검색어에서도 의미가 없다 — 붙여 보내도 찾히게 한다.
        String nickname = query == null ? "" : query.strip();
        User matched = userRepository.findActiveByNicknameIgnoreCase(nickname).orElse(null);
        if (matched == null) {
            return List.of();
        }
        // 결과가 한 건뿐이라 배치의 실익은 사라졌지만, 티어 도출을 league_arena_users 한 곳으로 모아 둔
        // 계약(GROMO-671·710)은 유지한다 — User.tierLevel 을 직접 읽으면 그 단일 출처가 다시 갈라진다.
        Map<UUID, Integer> tierLevels = userTierLookup.tierLevelsByUserId(List.of(matched.getId()));
        return List.of(FriendSearchResult.builder()
                .userId(matched.getId())
                .nickname(matched.getNickname())
                .occupation(matched.getOccupation() != null ? matched.getOccupation().name() : null)
                .tierLevel(tierLevels.get(matched.getId()))
                .build());
    }
}
