package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.domain.GroupJoinCode;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

// 미사용 — 초대 링크(groupId) 방식 전환으로 폐기(2026-07-31).
// 링크가 groupId 를 직접 담으므로 8자 코드·3시간 만료 개념 자체가 사라졌다.
// 삭제하지 않는 이유: 삭제 마이그레이션·계약 변경·테스트 수정 비용 > 잔존 비용. 실제 제거는 후속 정리 티켓.
public interface GroupJoinCodeRepository extends JpaRepository<GroupJoinCode, UUID> {

    Optional<GroupJoinCode> findByCode(String code);

    boolean existsByCode(String code);
}
