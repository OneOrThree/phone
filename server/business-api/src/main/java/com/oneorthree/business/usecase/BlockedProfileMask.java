package com.oneorthree.business.usecase;

import com.oneorthree.business.common.exception.UpstreamContractMismatchException;
import com.oneorthree.business.common.http.Deadline;
import com.oneorthree.business.upstream.data.DataFriendClient;
import com.oneorthree.business.upstream.data.dto.BlockedUserRef;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 차단자에게 보내는 주민 표시의 중립 치환 (GROMO-2183, character-report policy RP-차단 · 2026-10-01 확정 범위:
 * {@code GET /islands/{islandId}/members} · {@code /focus-members}).
 *
 * <p>차단해도 같은 섬 소속은 유지되므로 주민 목록·집중 주민 스냅샷에서 상대 <b>행을 빼지 않는다</b> — 빼면 인원수·
 * 공동 목표·자리 배치가 요청자마다 달라진다. 대신 요청자가 차단한 사용자의 닉네임을 {@link #NEUTRAL_NAME} 으로,
 * 프로필(고양이 색·착용 외양)을 기본값으로 바꾼다. {@code userId} 는 앱이 목록 키·실시간 병합 키로 쓰므로 유지한다.
 * 집중 상태·경과 시간은 섬 공동 진행 표시라 유지한다.
 *
 * <p><b>방향은 한쪽이다.</b> 정책은 「차단한 쪽에는」 중립 표시다 — 나를 차단한 사람의 이름은 내게 그대로 보인다.
 * 그래서 Data 의 blocker 관점 차단 목록({@code GET /internal/users/{userId}/blocks})만 읽는다.
 *
 * <p><b>실패는 닫힌다.</b> 차단 목록을 못 읽으면 원 응답을 그대로 내보내지 않고 상류 실패를 올린다 — 차단 대상의
 * 닉네임이 새는 것보다 목록 한 번이 실패하는 편이 낫다. 가릴 대상 후보가 없으면(빈 목록·본인뿐) 호출하지 않는다.
 */
@Component
@RequiredArgsConstructor
public class BlockedProfileMask {

    /**
     * 차단 대상의 중립 표시 이름 — 2026-10-01 확정. 탈퇴 표기(「탈퇴한 사용자」·「알 수 없음」)와 구분되는 문구다.
     */
    public static final String NEUTRAL_NAME = "차단한 주민";

    private final DataFriendClient friends;

    /**
     * 요청자가 차단한 사용자 중 {@code candidates} 에 있는 것만. 후보가 요청자 본인뿐이면 Data 를 부르지 않는다.
     *
     * @param viewerId   요청자 — 차단 목록의 blocker
     * @param candidates 응답에 실릴 사용자 ID
     */
    public Set<UUID> blockedAmong(UUID viewerId, Collection<UUID> candidates, Deadline deadline) {
        Set<UUID> others = new HashSet<>();
        for (UUID candidate : candidates) {
            if (candidate != null && !candidate.equals(viewerId)) {
                others.add(candidate);
            }
        }
        if (others.isEmpty()) {
            return Set.of();
        }
        List<BlockedUserRef> blocks = friends.fetchBlockedUserRefs(viewerId, deadline);
        if (blocks == null) {
            throw new UpstreamContractMismatchException("차단 목록 응답이 없습니다");
        }
        Set<UUID> blocked = new HashSet<>();
        for (BlockedUserRef block : blocks) {
            if (block == null) {
                throw new UpstreamContractMismatchException("차단 목록 항목이 비어 있습니다");
            }
            if (others.contains(block.id())) {
                blocked.add(block.id());
            }
        }
        return blocked;
    }

    /**
     * 문자열 사용자 ID 판정 — 같이 낚시 스냅샷은 ID 를 문자열로 옮긴다. 형식이 틀린 ID 를 「차단 아님」으로 흘리면
     * 치환을 조용히 건너뛰므로 상류 계약 위반으로 닫는다.
     */
    public static UUID parse(String userId) {
        if (userId != null) {
            try {
                return UUID.fromString(userId);
            } catch (IllegalArgumentException e) {
                // 아래에서 계약 위반으로 닫는다.
            }
        }
        throw new UpstreamContractMismatchException("주민 ID 형식이 올바르지 않습니다");
    }
}
