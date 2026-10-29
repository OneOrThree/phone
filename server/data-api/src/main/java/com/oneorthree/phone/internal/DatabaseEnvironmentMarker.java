package com.oneorthree.phone.internal;

import org.springframework.jdbc.core.JdbcTemplate;

/** RDS는 사용자 정의 GUC를 ALTER DATABASE로 설정할 수 없으므로 DB 자체의 설명을 환경 표식으로 사용한다. */
final class DatabaseEnvironmentMarker {
    private DatabaseEnvironmentMarker() {
    }

    static boolean matches(JdbcTemplate jdbc, String expected) {
        var settings = jdbc.queryForList("SELECT split_part(config, '=', 2)"
                + " FROM pg_db_role_setting setting JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND config LIKE 'gromo.environment=%'", String.class);
        if (!settings.isEmpty()) {
            return settings.size() == 1 && expected.equals(settings.get(0));
        }
        String comment = jdbc.queryForObject("SELECT shobj_description(oid, 'pg_database')"
                + " FROM pg_database WHERE datname=current_database()", String.class);
        return ("gromo.environment=" + expected).equals(comment);
    }
}
