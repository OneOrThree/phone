package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 건설 정책 판정의 순수 단위 테스트 (GROMO-1767·1999·2000) — DB 없이 도메인 불변식만 잠근다.
 * 대상: {@link ConstructionBuilding} 의 선행 그래프(정책 C01)·모으는 방식(1829 표)과
 * {@link SharedPurchase} 의 구매·건설 권한(정책 C13).
 */
class ConstructionPolicyTest {

    // ---------------------------------------------------------------- 선행 그래프 (C01)

    @Test
    @DisplayName("회관→게시판만 고정이고 그 뒤 넷은 자유 순서이며 상점만 넷 전부를 요구한다")
    void prerequisitesFreeTheMiddleFourAndGateTheShop() {
        assertThat(ConstructionBuilding.values())
                .extracting(ConstructionBuilding::id)
                .containsExactly("hall", "board", "gram", "library", "mail", "tower", "shop");

        assertThat(ConstructionBuilding.HALL.prerequisites()).isEmpty();
        assertThat(ConstructionBuilding.BOARD.prerequisites())
                .containsExactly(ConstructionBuilding.HALL);
        // 자유 순서 — 넷 모두 선행은 게시판 하나뿐이라 서로를 기다리지 않는다.
        assertThat(ConstructionBuilding.GRAM.prerequisites())
                .containsExactly(ConstructionBuilding.BOARD);
        assertThat(ConstructionBuilding.LIBRARY.prerequisites())
                .containsExactly(ConstructionBuilding.BOARD);
        assertThat(ConstructionBuilding.MAIL.prerequisites())
                .containsExactly(ConstructionBuilding.BOARD);
        assertThat(ConstructionBuilding.TOWER.prerequisites())
                .containsExactly(ConstructionBuilding.BOARD);
        // 상점은 마지막 — 「다른 모든 건물 공사 완료 후 선택한다」.
        assertThat(ConstructionBuilding.SHOP.prerequisites())
                .containsExactlyInAnyOrder(ConstructionBuilding.GRAM, ConstructionBuilding.LIBRARY,
                        ConstructionBuilding.MAIL, ConstructionBuilding.TOWER);
    }

    @Test
    @DisplayName("모으는 방식은 회관·게시판만 섬 통장 합산이고 축음기부터는 각자 몫 n빵이다")
    void fundingModesMatchThe1829Table() {
        assertThat(ConstructionBuilding.HALL.funding())
                .isEqualTo(ConstructionBuilding.Funding.WALLET_TOTAL);
        assertThat(ConstructionBuilding.BOARD.funding())
                .isEqualTo(ConstructionBuilding.Funding.WALLET_TOTAL);
        assertThat(ConstructionBuilding.GRAM.funding())
                .isEqualTo(ConstructionBuilding.Funding.RESIDENT_SPLIT);
        assertThat(ConstructionBuilding.SHOP.funding())
                .isEqualTo(ConstructionBuilding.Funding.RESIDENT_SPLIT);
    }

    @Test
    @DisplayName("계약 식별자로 건물을 찾고 없는 ID 는 빈 값이다")
    void byIdResolvesContractIds() {
        assertThat(ConstructionBuilding.byId("gram")).contains(ConstructionBuilding.GRAM);
        assertThat(ConstructionBuilding.byId("hall")).contains(ConstructionBuilding.HALL);
        assertThat(ConstructionBuilding.byId("fountain")).isEmpty();
        assertThat(ConstructionBuilding.byId("HALL")).as("계약 ID 는 소문자다").isEmpty();
    }

    // ---------------------------------------------------------------- 권한 (C13, GROMO-2000)

    @Test
    @DisplayName("공동 구매·공동 외양은 활성 주민 누구나 한다")
    void sharedPurchaseIsOpenToEveryResident() {
        assertThat(SharedPurchase.canSpend(member(GroupMemberRole.MEMBER))).isTrue();
        assertThat(SharedPurchase.canSpend(member(GroupMemberRole.OWNER))).isTrue();
        assertThat(SharedPurchase.canSpend(null)).as("비주민은 항상 false").isFalse();
    }

    @Test
    @DisplayName("건설(목표 선택·건설하기)은 방장만 한다")
    void constructionIsOwnerOnly() {
        assertThat(SharedPurchase.canBuild(member(GroupMemberRole.OWNER))).isTrue();
        assertThat(SharedPurchase.canBuild(member(GroupMemberRole.MEMBER))).isFalse();
        assertThat(SharedPurchase.canBuild(null)).as("비주민은 항상 false").isFalse();
    }

    private static GroupMember member(GroupMemberRole role) {
        return GroupMember.builder().role(role).build();
    }
}
