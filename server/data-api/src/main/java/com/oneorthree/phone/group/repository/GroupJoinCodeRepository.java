package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.GroupJoinCode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

/**
 * 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
 * 링크가 groupId 를 직접 담으므로 8자 코드·3시간 만료 개념 자체가 사라졌다.
 * 삭제하지 않는 이유: 삭제 마이그레이션·계약 변경·테스트 수정 비용 &gt; 잔존 비용. 실제 제거는 후속 정리 티켓.
 */
public interface GroupJoinCodeRepository extends JpaRepository<GroupJoinCode, UUID> {

    /**
     * 참가 코드로 그룹을 찾던 조회. 호출부가 없다(그룹 검색의 코드 매칭 분기도 함께 제거됐다).
     *
     * @param code 유저가 입력한 8자 코드 — 컬럼이 unique 라 최대 1건이다
     * @return 코드가 걸린 행. <b>상태·만료를 보지 않는다</b> — ENDED 이거나 만료된 코드도 그대로 나오므로
     *     참여 가능 여부는 호출측이 별도 판정해야 했다
     */
    Optional<GroupJoinCode> findByCode(String code);

    /**
     * 코드 발급·재발급 시 충돌 검사. 호출부가 없다.
     *
     * @param code 새로 뽑은 후보 코드
     * @return 이미 쓰이고 있으면 true. 만료·ENDED 행도 unique 를 점유하므로 true 다 — 재추첨 조건이지
     *     "지금 참여 가능한 코드"라는 뜻이 아니다
     */
    boolean existsByCode(String code);
}
