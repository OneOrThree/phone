package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.construction.repository.domain.ConstructionBuilding;
import com.oneorthree.phone.group.repository.domain.Group;
import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.group.repository.domain.GroupPermissionScope;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 섬 건설 정책 판정의 순수 단위 테스트 (GROMO-1767) — DB 없이 도메인 불변식만 잠근다.
 * 대상: {@link ConstructionBuilding} 의 선형 선행 그래프(정책 C01)·모으는 방식(1829 표)과
 * {@link SharedPurchase} 의 지출 권한(정책 C13).
 */
class ConstructionPolicyTest {

    // ---------------------------------------------------------------- 선형 그래프 (C01)

    @Test
    @DisplayName("건물은 회관→상점 선형 7개이며 각 선행은 바로 앞 건물이다")
    void buildingsFormOneLinearChain() {
        assertThat(ConstructionBuilding.values())
                .extracting(ConstructionBuilding::id)
                .containsExactly("hall", "board", "gram", "library", "mail", "tower", "shop");

        assertThat(ConstructionBuilding.HALL.prerequisite()).isNull();
        assertThat(ConstructionBuilding.BOARD.prerequisite()).isEqualTo(ConstructionBuilding.HALL);
        assertThat(ConstructionBuilding.GRAM.prerequisite()).isEqualTo(ConstructionBuilding.BOARD);
        assertThat(ConstructionBuilding.LIBRARY.prerequisite()).isEqualTo(ConstructionBuilding.GRAM);
        assertThat(ConstructionBuilding.MAIL.prerequisite()).isEqualTo(ConstructionBuilding.LIBRARY);
        assertThat(ConstructionBuilding.TOWER.prerequisite()).isEqualTo(ConstructionBuilding.MAIL);
        assertThat(ConstructionBuilding.SHOP.prerequisite()).isEqualTo(ConstructionBuilding.TOWER);
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

    // ---------------------------------------------------------------- 지출 권한 (C13)

    @Test
    @DisplayName("OWNER_ONLY 기본값에서는 방장만 쓸 수 있다")
    void ownerOnlyAllowsOnlyTheOwner() {
        Group island = Group.builder().name("섬").maxMembers(10).build();
        assertThat(island.getSharedPurchasePermission())
                .as("기본값은 보존적 OWNER_ONLY 다").isEqualTo(GroupPermissionScope.OWNER_ONLY);

        GroupMember owner = member(GroupMemberRole.OWNER);
        GroupMember plain = member(GroupMemberRole.MEMBER);

        assertThat(SharedPurchase.canSpend(island, owner)).isTrue();
        assertThat(SharedPurchase.canSpend(island, plain)).isFalse();
        assertThat(SharedPurchase.canSpend(island, null)).as("비주민은 항상 false").isFalse();
    }

    @Test
    @DisplayName("ALL_MEMBERS 토글이면 활성 주민 전원이 쓸 수 있다")
    void allMembersAllowsEveryMember() {
        Group island = Group.builder().name("섬").maxMembers(10)
                .sharedPurchasePermission(GroupPermissionScope.ALL_MEMBERS).build();

        assertThat(SharedPurchase.canSpend(island, member(GroupMemberRole.MEMBER))).isTrue();
        assertThat(SharedPurchase.canSpend(island, member(GroupMemberRole.OWNER))).isTrue();
        assertThat(SharedPurchase.canSpend(island, null)).isFalse();
    }

    private static GroupMember member(GroupMemberRole role) {
        return GroupMember.builder().role(role).build();
    }
}
