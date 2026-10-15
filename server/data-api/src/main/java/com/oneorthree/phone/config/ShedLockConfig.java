package com.oneorthree.phone.config;

import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

/**
 * ShedLock 분산 락 (GROMO-1283, policy §E4) — 챌린지·정산·알림 크론의 멀티 인스턴스 중복 실행
 * 차단. 각 {@code @Scheduled} 진입점에 {@code @SchedulerLock(name = …)} 고유 이름을 달면, 같은
 * 이름의 락을 쥔 인스턴스만 실행되고 나머지는 조용히 건너뛴다. 저장소는 V45 의 {@code shedlock}
 * 테이블(표준 스키마) — 별도 인프라 없이 기존 PostgreSQL 로 충분하다.
 *
 * <p>{@code defaultLockAtMostFor} 10분: 워커가 락 해제 없이 죽어도 이 시간 뒤엔 다른 인스턴스가
 * 잡는다. 크론들이 5·15분 주기라 정상 실행이 10분을 넘기면 그 자체가 장애 신호다(정산 스캔은
 * 건별 트랜잭션이라 중간에 끊겨도 재시도 안전 — 알림 클레임 리스 10분과 같은 원리의 시간이다).
 *
 * <p>{@code usingDbTime()} — 락 만료 판정을 DB 서버 시각으로 통일한다. 인스턴스 간 시계가 어긋나면
 * 락이 조기 만료되거나 영원히 잡혀 있는 것처럼 보인다.
 */
@Configuration
@EnableSchedulerLock(defaultLockAtMostFor = "PT10M")
public class ShedLockConfig {

    /**
     * 락 저장소를 애플리케이션 DB 의 {@code shedlock} 테이블로 지정한다. 별도 Redis·ZooKeeper 없이
     * 기존 PostgreSQL 커넥션 풀을 그대로 쓴다.
     *
     * @param dataSource 애플리케이션 공용 DataSource — 락 판정이 서비스 DB 와 같은 트랜잭션 경계 안에
     *                   있어야 크론이 본 데이터와 락 상태가 어긋나지 않는다
     * @return DB 서버 시각으로 만료를 판정하는({@code usingDbTime}) JDBC 락 프로바이더.
     *         인스턴스 간 시계 어긋남이 락 조기 만료·영구 점유로 보이는 문제를 막는다
     */
    @Bean
    public LockProvider lockProvider(DataSource dataSource) {
        return new JdbcTemplateLockProvider(
                JdbcTemplateLockProvider.Configuration.builder()
                        .withJdbcTemplate(new JdbcTemplate(dataSource))
                        .usingDbTime()
                        .build());
    }
}
