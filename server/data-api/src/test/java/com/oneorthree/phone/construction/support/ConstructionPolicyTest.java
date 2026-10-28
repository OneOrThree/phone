package com.oneorthree.phone.construction.support;

import com.oneorthree.phone.group.repository.domain.GroupMember;
import com.oneorthree.phone.group.repository.domain.GroupMemberRole;
import com.oneorthree.phone.user.repository.domain.User;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 공동 구매와 건설 권한의 순수 정책 검사. 건물 종류는 DB 통합 테스트에서 검증한다. */
class ConstructionPolicyTest {

    @Test
    @DisplayName("공동 구매는 활성 주민 누구나 하되 게스트는 빠진다")
    void sharedPurchaseIsOpenToEveryResidentButGuests() {
        User member = account(false);
        assertThat(SharedPurchase.canSpend(member, member(GroupMemberRole.MEMBER))).isTrue();
        assertThat(SharedPurchase.canSpend(member, member(GroupMemberRole.OWNER))).isTrue();
        assertThat(SharedPurchase.canSpend(member, null)).isFalse();

        User guest = account(true);
        assertThat(SharedPurchase.canSpend(guest, member(GroupMemberRole.MEMBER))).isFalse();
        assertThat(SharedPurchase.canSpend(guest, member(GroupMemberRole.OWNER))).isFalse();
    }

    @Test
    @DisplayName("건설은 방장만 하고 게스트 축을 타지 않는다")
    void constructionIsOwnerOnly() {
        assertThat(SharedPurchase.canBuild(member(GroupMemberRole.OWNER))).isTrue();
        assertThat(SharedPurchase.canBuild(member(GroupMemberRole.MEMBER))).isFalse();
        assertThat(SharedPurchase.canBuild(null)).isFalse();
    }

    private static User account(boolean guest) {
        return User.builder().nickname("u").isGuest(guest).build();
    }

    private static GroupMember member(GroupMemberRole role) {
        return GroupMember.builder().role(role).build();
    }
}
