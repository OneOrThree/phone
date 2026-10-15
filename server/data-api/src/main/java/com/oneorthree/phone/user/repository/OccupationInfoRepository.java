package com.oneorthree.phone.user.repository;

import com.oneorthree.phone.user.repository.domain.Occupation;
import com.oneorthree.phone.user.repository.domain.OccupationInfo;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

/**
 * 직군 마스터 — PK 가 {@code Occupation} enum 자체다. 소프트 딜리트라 폐기된 직군도 행은 남는다
 * (그 직군으로 가입한 유저의 값이 깨지면 안 된다).
 */
public interface OccupationInfoRepository extends JpaRepository<OccupationInfo, Occupation> {

    /**
     * 삭제되지 않은 occupation 마스터를 code(enum name) 오름차순으로 조회.
     *
     * @return 선택지로 노출할 직군. 폐기된 직군은 빠지므로 <b>기존 유저가 가진 값이 목록에 없을 수 있다</b>
     */
    List<OccupationInfo> findAllByDeletedAtIsNullOrderByCodeAsc();

    /**
     * 저장 경로 활성 검증용 (GROMO-626, Codex P2) — soft-deleted occupation 저장 차단.
     *
     * @param code 유저가 고른 직군
     * @return 아직 살아 있는 직군이면 true. 폐기된 직군을 새로 저장하려는 요청은 여기서 걸린다
     */
    // 저장 경로 활성 검증용 (GROMO-626, Codex P2) — soft-deleted occupation 저장 차단
    boolean existsByCodeAndDeletedAtIsNull(Occupation code);
}
