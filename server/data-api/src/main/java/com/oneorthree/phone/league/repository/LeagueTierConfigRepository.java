package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 티어별 승급·강등 경계 설정을 읽는 창구. 키가 티어 레벨(Integer)이라 별도 조회 메서드 없이 기본 CRUD 만 쓴다.
 *
 * <p>설정은 마이그레이션 시드로 들어오므로, 비어 있으면 배치가 승강을 판정할 근거가 없다 —
 * 그래서 배치는 아레나를 만들기 <b>전에</b> 이 설정부터 확인하고 없으면 TIER_CONFIG_NOT_FOUND 로 멈춘다.
 */
public interface LeagueTierConfigRepository extends JpaRepository<LeagueTierConfig, Integer> {
}
