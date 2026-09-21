package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;

/**
 * 섬 공동 재화를 쓰는 두 판정 (정책 C13, GROMO-2000) — 기획 정본이 축을 둘로 갈랐다.
 *
 * <ul>
 *   <li>{@link #canSpend} <b>공동 구매</b>(상점 상품·축음기 음원)와 <b>공동 외양</b>(섬·건물 테마)은
 *       「주민 누구나 섬 물고기로 상점 상품·축음기 음원을 구매할 수 있다」·「공동 섬·건물 테마도
 *       주민 누구나 적용·해제한다」라 <b>활성 주민 전원</b>이다.</li>
 *   <li>{@link #canBuild} <b>건설</b>(다음 건물 목표 선택·건설하기)은 「방장이 회관의 다음 건물
 *       선택에서 목표를 정하면」·「방장이 건설하기를 누를 때 필요한 물고기를 섬 잔액에서 차감하고
 *       공사를 시작한다」라 <b>방장만</b>이다.</li>
 * </ul>
 *
 * <p>기획 정본이 두 축을 모두 고정했으므로 섬 설정 토글({@code Group.sharedPurchasePermission})은
 * 더 이상 판정 근거가 아니다 — 읽는 곳이 없다. 열 제거는 별도 마이그레이션 몫이다.
 *
 * <p>게스트 계정 제한(GROMO-1992)은 이 판정과 <b>다른 축</b>이다 — 여기서 지우지 말고 더한다.
 */
public final class SharedPurchase {

    private SharedPurchase() {
    }

    /** 공동 구매·공동 외양 — 활성 주민이면 누구나. 비주민(null)은 false. */
    public static boolean canSpend(GroupMember member) {
        return member != null;
    }

    /** 건설(목표 선택·건설하기) — 방장만. 비주민(null)은 false. */
    public static boolean canBuild(GroupMember member) {
        return member != null && member.getRole() == GroupMemberRole.OWNER;
    }
}
