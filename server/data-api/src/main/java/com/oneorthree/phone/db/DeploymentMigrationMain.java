package com.oneorthree.phone.db;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.configuration.FluentConfiguration;

import java.util.Map;

/** 배포 중 writer를 시작하지 않고 Flyway만 실행하는 별도 진입점. */
public final class DeploymentMigrationMain {
    private DeploymentMigrationMain() {
    }

    public static void main(String[] args) {
        if (args.length != 1) {
            throw new IllegalArgumentException("migration mode는 legacy 또는 current 하나여야 합니다");
        }
        configuration(args[0], System.getenv()).load().migrate();
    }

    static FluentConfiguration configuration(String mode, Map<String, String> environment) {
        if (!"legacy".equals(mode) && !"current".equals(mode)) {
            throw new IllegalArgumentException("지원하지 않는 migration mode");
        }
        FluentConfiguration configuration = Flyway.configure()
                .dataSource(required(environment, "API_DB_URL"), required(environment, "API_DB_USERNAME"),
                        required(environment, "API_DB_PASSWORD"))
                .locations("classpath:db/" + ("legacy".equals(mode) ? "migration" : "v0"))
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .outOfOrder(false)
                .validateMigrationNaming(true)
                .validateOnMigrate(true)
                .group(true)
                .connectRetries(3);
        if ("legacy".equals(mode)) {
            configuration.target("138");
        }
        return configuration;
    }

    private static String required(Map<String, String> environment, String key) {
        String value = environment.get(key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("필수 DB 환경변수 누락: " + key);
        }
        return value;
    }
}
