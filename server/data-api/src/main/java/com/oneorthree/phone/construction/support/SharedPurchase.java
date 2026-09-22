package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.user.repository.domain.User;

/**
 * 섬 공동 재화를 쓰는 두 판정 (정책 C13, GROMO-2000) — 기획 정본이 축을 둘로 갈랐다.
 *
 * <ul>
 *   <li>{@link #canSpend} <b>공동 구매</b>(상점 상품·축음기 음원)는 「주민 누구나 섬 물고기로 상점
 *       상품·축음기 음원을 구매할 수 있다」라 <b>활성 주민 전원</b>이되 게스트는 빠진다(아래).</li>
 *   <li>{@link #canBuild} <b>건설</b>(다음 건물 목표 선택·건설하기)은 「방장이 회관의 다음 건물
 *       선택에서 목표를 정하면」·「방장이 건설하기를 누를 때 필요한 물고기를 섬 잔액에서 차감하고
 *       공사를 시작한다」라 <b>방장만</b>이다.</li>
 * </ul>
 *
 * <p><b>공동 외양</b>(섬·건물 테마)도 「주민 누구나 적용·해제한다」지만 이 클래스를 타지 않는다 —
 * 이미 섬이 «보유한» 것을 적용하는 일이라 재화를 쓰지 않고, 그래서 게스트 축도 없다. 판정은
 * {@code AppearanceService#requireSharedAppearance} 의 활성 주민 확인 하나다.
 *
 * <p>기획 정본이 두 축을 모두 고정했으므로 섬 설정 토글({@code Group.sharedPurchasePermission})은
 * 더 이상 판정 근거가 아니다 — 읽는 곳이 없다. 열 제거는 별도 마이그레이션 몫이다.
 *
 * <p><b>게스트 축</b>: 「친구 추가·편지 보내기·상점 구매를 처음 시도할 때 소셜 로그인을 요청한다」라
 * 게스트는 구매에서 빠진다. 종전에는 토글 기본값 {@code OWNER_ONLY} 가 «우연히» 게스트 주민까지
 * 막고 있었는데, 그 우산을 걷으면서 이 축이 드러났다 — 그래서 {@link #canSpend} 가 계정 상태를
 * 직접 본다. 건설은 이 축을 타지 않는다({@link #canBuild} 가 {@code User} 를 받지 않는 이유):
 * 정본의 로그인 요청 목록에 건설이 없고, 게스트도 섬을 만들어 방장이 될 수 있다.
 */
public final class SharedPurchase {

    private SharedPurchase() {
    }

    /**
     * 공동 구매 — 활성 주민이면 누구나, 단 <b>게스트 계정은 제외</b>한다. 비주민(null)은 false.
     *
     * <p>이 판정은 「할 수 있는가」를 <b>알려 주는</b> 쪽이기도 하다 — 상점 목록의 항목별 사유
     * ({@code ShopService.Snapshot#canSpend})와 구매 명령 거절이 같은 값을 읽어야, 앱이 열어 둔
     * 버튼을 눌렀더니 403 이 나는 어긋남이 생기지 않는다.
     */
    public static boolean canSpend(User caller, GroupMember member) {
        return member != null && caller != null && !caller.isGuest();
    }

    /** 건설(목표 선택·건설하기) — 방장만. 비주민(null)은 false. */
    public static boolean canBuild(GroupMember member) {
        return member != null && member.getRole() == GroupMemberRole.OWNER;
    }
}
