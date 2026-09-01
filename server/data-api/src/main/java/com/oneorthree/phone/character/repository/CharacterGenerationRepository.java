package com.oneorthree.phone.character.repository;

import com.oneorthree.phone.character.repository.domain.CharacterGeneration;
import com.oneorthree.phone.user.repository.domain.User;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 누끼 생성 이력 원장. append-only 라 수정·삭제가 없고, 쿼터 판정은 전부 이 이력을
 * 롤링 윈도우로 세는 것으로 이뤄진다.
 */
public interface CharacterGenerationRepository extends JpaRepository<CharacterGeneration, UUID> {

    /**
     * 롤링 윈도우(from 이후) 내 유저의 생성 건수 — remaining 계산용.
     *
     * @param user 대상 유저
     * @param from 윈도우 시작 시각(포함) — 보통 now-7일
     * @return 창 안의 생성 건수. 무제한 구간에 쌓인 이력 때문에 한도(3)를 넘는 값이 나올 수 있다
     */
    long countByUserAndCreatedAtGreaterThanEqual(User user, Instant from);

    /**
     * 롤링 윈도우(from 이후) 내 생성 시각을 오래된 순으로 조회 — resetAt(슬롯이 비는 시각) 계산용.
     *
     * <p>창에 한도(ROLLING_LIMIT) 초과 행이 있을 수 있어(무제한 grace spillover·경쟁) 가장 오래된 행이 아니라
     * "실제로 슬롯을 여는" (count - limit) 오프셋 행을 집어야 한다. 서비스가 {@code PageRequest.of(offset, 1)} 로
     * OFFSET :offset LIMIT 1 을 지정해 해당 행을 가져온다.
     *
     * @param user     대상 유저
     * @param from     윈도우 시작 시각(포함)
     * @param pageable 슬롯을 여는 행만 집어내기 위한 오프셋·크기 — 서비스가 {@code PageRequest.of(offset, 1)} 로 넘긴다
     * @return 조건에 맞는 생성 시각들. 오프셋이 창 밖이면 빈 목록이고, 이때 resetAt 은 계산하지 않는다
     */
    @Query("SELECT g.createdAt FROM CharacterGeneration g"
            + " WHERE g.user = :user AND g.createdAt >= :from"
            + " ORDER BY g.createdAt ASC")
    List<Instant> findCreatedAtInWindowOrderByCreatedAtAsc(User user, Instant from, Pageable pageable);

    /**
     * 멱등키 중복 확인 — 같은 (user, clientGenerationId) 기록이 이미 있으면 재기록을 no-op 처리(③).
     *
     * @param user               대상 유저
     * @param clientGenerationId 앱이 만든 멱등키
     * @return 이미 기록된 키면 true — 호출측은 insert 를 건너뛰어 슬롯 중복 소비를 막는다
     */
    boolean existsByUserAndClientGenerationId(User user, UUID clientGenerationId);
}
