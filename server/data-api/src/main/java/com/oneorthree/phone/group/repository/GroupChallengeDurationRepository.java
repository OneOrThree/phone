package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupChallengeDuration;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * {@code type=DURATION} 챌린지 상세(CTI) 조회. PK 가 challenge_id 라 단건은 {@code findById(challengeId)}
 * 로 바로 집는다 — 별도 조회 메서드가 없는 이유다.
 */
public interface GroupChallengeDurationRepository extends JpaRepository<GroupChallengeDuration, UUID> {

    /**
     * 챌린지 카드 목록처럼 여러 챌린지의 상세를 한 번에 붙일 때 쓰는 배치 로드 — 챌린지마다 상세를
     * 따로 읽으면 N+1 이 된다.
     *
     * @param challengeIds 상세를 붙일 챌린지 id 들. {@code DURATION} 이 아닌 id 가 섞여도 무해하다(안 맞으면
     *     결과에서 빠질 뿐)
     * @return 존재하는 상세만. <b>요청 수보다 적을 수 있다</b> — 창형 챌린지이거나 상세가 유실된 구 데이터는
     *     빠지므로, 호출측은 id 로 맵을 만들어 결손을 "판정 불가"로 다뤄야 한다
     */
    List<GroupChallengeDuration> findByChallengeIdIn(Collection<UUID> challengeIds);
}
