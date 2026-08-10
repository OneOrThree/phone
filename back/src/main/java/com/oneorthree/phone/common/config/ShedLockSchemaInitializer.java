package com.oneorthree.phone.common.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;

/**
 * Flyway 를 쓰지 않는 프로파일의 {@code shedlock} 테이블 생성 (GROMO-1283 · 1417).
 *
 * <p><b>왜 필요한가</b> — {@code shedlock} 은 JPA 엔티티가 아니라 V45 마이그레이션에서만 생긴다.
 * 그런데 {@code local}(템플릿이 {@code flyway.enabled: false} + {@code ddl-auto: update})과
 * {@code ci}({@code create-drop}, GROMO-670)는 스키마를 <b>엔티티에서</b> 만들므로 이 테이블이
 * 없다. 그러면 {@code @SchedulerLock} 이 걸린 <b>모든</b> 크론이 첫 락 쿼리에서
 * {@code relation "shedlock" does not exist} 로 실패해 정산·환불·회차 개설이 통째로 안 돈다 —
 * 로컬에서 크론을 확인할 수 없다는 뜻이라 개발 중 눈에 잘 띄지도 않는다.
 *
 * <p>dev·prod 는 Flyway 가 V45 로 같은 테이블을 만든다 — 그래서 이 빈은 두 프로파일에만 붙는다.
 * DDL 은 {@code shedlock-provider-jdbc-template} 표준 스키마이고 V45 와 동일해야 한다.
 *
 * <p>{@code @PostConstruct} 로 컨텍스트 refresh 중에 깐다 — {@code @Scheduled} 등록은
 * refresh 마지막(ContextRefreshedEvent)이라 첫 크론이 돌기 전에 테이블이 존재한다.
 */
@Slf4j
@Configuration
@Profile({"local", "ci"})
public class ShedLockSchemaInitializer {

    /** V45 와 같은 표준 스키마 — 한쪽만 바뀌면 로컬과 운영의 락 동작이 갈린다. */
    static final String SHEDLOCK_DDL = "CREATE TABLE IF NOT EXISTS shedlock ("
            + "name varchar(64) NOT NULL, "
            + "lock_until timestamp NOT NULL, "
            + "locked_at timestamp NOT NULL, "
            + "locked_by varchar(255) NOT NULL, "
            + "CONSTRAINT shedlock_pkey PRIMARY KEY (name))";

    private final DataSource dataSource;

    public ShedLockSchemaInitializer(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    @PostConstruct
    void createShedlockTableIfAbsent() {
        new JdbcTemplate(dataSource).execute(SHEDLOCK_DDL);
        log.info("shedlock 테이블 확인·생성 완료 — Flyway 미사용 프로파일");
    }
}
