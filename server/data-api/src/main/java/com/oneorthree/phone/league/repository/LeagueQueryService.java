package com.oneorthree.phone.league.repository;

import com.oneorthree.phone.league.repository.domain.LeagueTierConfig;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/**
 * 리그 마스터 데이터를 id 로 조회하는 경로를 접는다 (GROMO-1655). 규약은
 * {@code docs/conventions/backend-layering.md} §3.
 *
 * <p><b>PK 가 {@link UUID} 가 아닌 유일한 계층이다.</b> 티어 설정은 유저 데이터가 아니라 티어 등급
 * (1~5)을 키로 하는 마스터 행이라 PK 가 {@code Integer} 다. 그래서 다른 계층의 {@code (UUID id)}
 * 관용구가 여기엔 적용되지 않는다.
 *
 * <p>주차 결과·랭킹 집계는 전부 범위 스캔·프로젝션이라 §3 「옮기지 않는 것」이고, 여기 남는 것은
 * 티어 설정 단건뿐이다.
 *
 * <p><b>트랜잭션을 시작하지 않는다.</b> 호출한 service 의 트랜잭션에 참여한다.
 */
@Service
@RequiredArgsConstructor
public class LeagueQueryService {

    private final LeagueTierConfigRepository leagueTierConfigRepository;

    /**
     * 티어 설정 단건 — <b>부재가 정상</b>.
     *
     * <p>티어 설정은 시드(Flyway {@code V13})로 들어오는 마스터 데이터라 정상 운영에서는 1~5 가 전부
     * 존재한다. 그래도 던지지 않는 이유는 호출부가 <b>배지 표시</b>에만 쓰기 때문이다 — 설정이 없다고
     * 리그 응답 전체를 404 로 만들 이유가 없다.
     *
     * @param tierLevel 티어 등급 (PK)
     * @return 티어 설정. 없으면 빈 값
     */
    public Optional<LeagueTierConfig> findTierConfig(int tierLevel) {
        return leagueTierConfigRepository.findById(tierLevel);
    }
}
