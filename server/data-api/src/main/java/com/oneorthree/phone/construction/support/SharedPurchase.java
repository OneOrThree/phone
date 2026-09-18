package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;

/**
 * 섬 물고기 지출 권한 판정 (정책 C13, 2026-09-18 D2) — 판정 이름은 {@code SHARED_PURCHASE} 다.
 * 섬 설정의 방장 토글({@code Group.sharedPurchasePermission})을 읽는 유일한 곳이다.
 *
 * <p>GET options 도 같은 판정으로 항목별 FORBIDDEN 사유를 계산하고(C08), PUT/POST 실행은
 * 이 판정을 TX 안에서 다시 강제한다. 토글 변경 API 는 이번 범위 밖이다.
 */
public final class SharedPurchase {

    private SharedPurchase() {
    }

    /**
     * 이 주민이 섬 물고기를 쓸 수 있는가 — 비주민(null)은 항상 false.
     * {@code OWNER_ONLY} 면 방장만, {@code ALL_MEMBERS} 면 활성 주민 전원이다.
     */
    public static boolean canSpend(Group island, GroupMember member) {
        if (member == null) {
            return false;
        }
        return switch (island.getSharedPurchasePermission()) {
            case OWNER_ONLY -> member.getRole() == GroupMemberRole.OWNER;
            case ALL_MEMBERS -> true;
        };
    }
}
