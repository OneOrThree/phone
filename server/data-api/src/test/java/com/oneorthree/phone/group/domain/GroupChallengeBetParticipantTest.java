package com.oneorthree.phone.group.domain;

import com.oneorthree.phone.group.repository.domain.GroupChallengeBetParticipant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * id 기반 equals/hashCode 계약 — Set·distinct() 사용 시의 함정(리뷰 백로그 LOW) 방지.
 *
 * <p>핵심 불변식: 같은 id 면 같은 엔티티, 저장 전(id null)엔 자기 자신 외 누구와도 같지 않다,
 * 해시는 persist 전후로 변하지 않는다(클래스 상수).
 */
class GroupChallengeBetParticipantTest {

    private static final UUID ID_A = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    private static final UUID ID_B = UUID.fromString("00000000-0000-0000-0000-00000000000b");

    private GroupChallengeBetParticipant participantWithId(UUID id) {
        return GroupChallengeBetParticipant.builder().id(id).build();
    }

    @Test
    @DisplayName("같은 id 의 서로 다른 인스턴스는 동등하다")
    void sameIdEqual() {
        assertThat(participantWithId(ID_A))
                .isEqualTo(participantWithId(ID_A))
                .hasSameHashCodeAs(participantWithId(ID_A));
    }

    @Test
    @DisplayName("다른 id·다른 타입·null 과는 동등하지 않다")
    void differentIdOrTypeNotEqual() {
        GroupChallengeBetParticipant participant = participantWithId(ID_A);

        assertThat(participant).isNotEqualTo(participantWithId(ID_B));
        assertThat(participant).isNotEqualTo(new Object());
        assertThat(participant).isNotEqualTo(null);
    }

    @Test
    @DisplayName("저장 전(id null) 인스턴스는 자기 자신과만 같다")
    void transientInstanceOnlyEqualsItself() {
        GroupChallengeBetParticipant transientOne = participantWithId(null);
        GroupChallengeBetParticipant transientTwo = participantWithId(null);

        assertThat(transientOne).isEqualTo(transientOne);
        assertThat(transientOne).isNotEqualTo(transientTwo);
    }

    @Test
    @DisplayName("해시가 id 에 묶이지 않아 persist(id 부여) 전에 Set 에 넣어도 잃어버리지 않는다")
    void hashCodeStableAcrossIdAssignment() {
        // 저장 전후를 흉내 낸다 — id 유무와 무관하게 해시가 같아야 같은 버킷에서 찾는다.
        assertThat(participantWithId(null).hashCode()).isEqualTo(participantWithId(ID_A).hashCode());

        Set<GroupChallengeBetParticipant> set = new HashSet<>();
        GroupChallengeBetParticipant saved = participantWithId(ID_A);
        set.add(saved);
        assertThat(set).contains(participantWithId(ID_A));
    }
}
