package com.oneorthree.notification;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 정지·백업 후에만 명시 실행하는 V9.1 선택 릴리스의 정규 V15 이행 CLI. Spring은 기동하지 않는다. */
public final class NotificationReleaseBridge {
    private static final String ROOT = "/db/release-bridge/";
    private static final String BRIDGE = "V9_1__backoffice_publications.sql";
    private static final long LOCK = 2592002595L;
    private static final String ADMIN = "ADMIN_ANNOUNCEMENT";

    private NotificationReleaseBridge() { }

    /** 비밀은 환경변수로만 받으며 JDBC URL이나 자격은 출력하지 않는다. */
    public static void main(String[] args) throws Exception {
        Map<String, String> options = new LinkedHashMap<>();
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--writers-stopped") || args[i].equals("--apply")) {
                options.put(args[i], "true");
            } else if (i + 1 < args.length) {
                options.put(args[i], args[++i]);
            } else {
                throw new IllegalArgumentException("이행 인자가 잘못됐습니다.");
            }
        }
        if (!"true".equals(options.get("--writers-stopped")) || !"true".equals(options.get("--apply"))) {
            throw new IllegalArgumentException("--writers-stopped --apply 확인이 필요합니다.");
        }
        Path backup = Path.of(required(options, "--backup"));
        String backupHash = required(options, "--backup-sha256");
        verifyBackup(backup, backupHash);
        try (Connection connection = DriverManager.getConnection(requiredEnv("NOTI_DB_URL"),
                requiredEnv("NOTI_DB_USERNAME"), requiredEnv("NOTI_DB_PASSWORD"))) {
            migrate(connection, required(options, "--database"), required(options, "--environment"),
                    required(options, "--fcm-project"), backupHash);
        }
        System.out.println("Notification V9.1 → V15 이행 검증 완료");
    }

    static void verifyBackup(Path backup, String hash) throws IOException {
        if (!hash.matches("[a-f0-9]{64}") || !Files.isRegularFile(backup) || Files.size(backup) < 5) {
            throw new IllegalArgumentException("백업 파일과 SHA256이 필요합니다.");
        }
        byte[] header;
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
        try (var stream = Files.newInputStream(backup)) {
            header = stream.readNBytes(5);
            digest.update(header);
            byte[] buffer = new byte[65536];
            int count;
            while ((count = stream.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
            }
        }
        if (!new String(header, StandardCharsets.US_ASCII).equals("PGDMP")
                || !HexFormat.of().formatHex(digest.digest()).equals(hash)) {
            throw new IllegalArgumentException("pg_dump custom 백업 헤더 또는 SHA256 불일치");
        }
    }

    static void migrate(Connection connection, String database, String environment, String project, String backupHash)
            throws SQLException, IOException {
        if (!List.of("dev", "prod").contains(environment) || project.isBlank()
                || !backupHash.matches("[a-f0-9]{64}") || !connection.getAutoCommit()) {
            throw new IllegalArgumentException("DB 정체성·백업 증거·독립 연결이 필요합니다.");
        }
        Map<String, Migration> manifest = manifest();
        connection.setAutoCommit(false);
        try {
            execute(connection, "SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'");
            execute(connection, "SELECT pg_advisory_xact_lock(" + LOCK + ")");
            verifyIdentity(connection, database, environment, project);
            if (!scalar(connection, "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
                    + " AND pid<>pg_backend_pid() AND backend_type='client backend'").equals("0")) {
                throw new IllegalStateException("다른 DB 연결이 남아 있습니다. 모든 서비스를 정지하세요.");
            }
            for (String table : rows(connection, "SELECT quote_ident(tablename) FROM pg_tables"
                    + " WHERE schemaname='public' ORDER BY tablename")) {
                execute(connection, "LOCK TABLE public." + table + " IN ACCESS EXCLUSIVE MODE");
            }
            if (scalar(connection, "SELECT to_regclass('notification_release_bridge.receipt') IS NOT NULL")
                    .equals("t")) {
                verifyHistory(connection, manifest, false);
                verifySchema(connection, "target-schema.txt");
                try (PreparedStatement statement = connection.prepareStatement("SELECT count(*) FROM"
                        + " notification_release_bridge.receipt WHERE id=1 AND database_name=?"
                        + " AND environment=? AND fcm_project=? AND backup_sha256=? AND source_checksum=?")) {
                    statement.setString(1, database);
                    statement.setString(2, environment);
                    statement.setString(3, project);
                    statement.setString(4, backupHash);
                    statement.setInt(5, manifest.get(BRIDGE).checksum());
                    try (ResultSet result = statement.executeQuery()) {
                        result.next();
                        if (result.getInt(1) != 1) {
                            throw new IllegalStateException("기존 이행 증거가 요청과 다릅니다.");
                        }
                    }
                }
                connection.commit();
                return;
            }
            verifyHistory(connection, manifest, true);
            verifySchema(connection, "source-schema.txt");
            execute(connection, "CREATE SCHEMA notification_release_bridge");
            execute(connection, "CREATE TABLE notification_release_bridge.receipt (id integer PRIMARY KEY"
                    + " CHECK(id=1), database_name text NOT NULL, environment text NOT NULL, fcm_project text NOT NULL,"
                    + " backup_sha256 text NOT NULL, source_checksum integer NOT NULL, source_history jsonb NOT NULL,"
                    + " completed_at timestamptz NOT NULL DEFAULT now())");
            try (PreparedStatement statement = connection.prepareStatement("INSERT INTO"
                    + " notification_release_bridge.receipt VALUES(1,?,?,?,?,?,"
                    + "(SELECT jsonb_agg(to_jsonb(h) ORDER BY installed_rank) FROM flyway_schema_history h),now())")) {
                statement.setString(1, database);
                statement.setString(2, environment);
                statement.setString(3, project);
                statement.setString(4, backupHash);
                statement.setInt(5, manifest.get(BRIDGE).checksum());
                statement.executeUpdate();
            }
            execute(connection, "CREATE TEMP TABLE bridge_admin_kind ON COMMIT DROP AS SELECT * FROM kinds"
                    + " WHERE id='" + ADMIN + "'; CREATE TEMP TABLE bridge_admin_templates ON COMMIT DROP AS"
                    + " SELECT id,enabled FROM templates WHERE kind='" + ADMIN + "';"
                    + " CREATE TEMP TABLE bridge_admin_deliveries ON COMMIT DROP AS SELECT"
                    + " id,status,last_error,lease_token,lease_expires_at FROM deliveries WHERE kind='" + ADMIN + "'");
            if (!scalar(connection, "SELECT count(*) FROM bridge_admin_kind").equals("1")) {
                throw new IllegalStateException("승인 공지 종류가 없습니다.");
            }
            for (int version = 10; version <= 13; version++) {
                Migration migration = numbered(manifest, version);
                execute(connection, resource("/db/migration/" + migration.script()));
                insertHistory(connection, migration, version);
            }
            execute(connection, "UPDATE kinds k SET enabled=b.enabled,silent=b.silent,quiet_policy=b.quiet_policy,"
                    + "eligibility_required=b.eligibility_required,cooldown_seconds=b.cooldown_seconds"
                    + " FROM bridge_admin_kind b WHERE k.id=b.id;"
                    + " UPDATE templates t SET enabled=b.enabled FROM bridge_admin_templates b WHERE t.id=b.id;"
                    + " UPDATE deliveries d SET status=b.status,last_error=b.last_error,lease_token=b.lease_token,"
                    + "lease_expires_at=b.lease_expires_at FROM bridge_admin_deliveries b WHERE d.id=b.id");
            // V9.1은 정규 V14+V15와 같은 DDL임을 전체 public 구조로 확인한 뒤에만 이력을 옮긴다.
            verifySchema(connection, "target-schema.txt");
            execute(connection, "DELETE FROM flyway_schema_history WHERE version='9.1'");
            insertHistory(connection, numbered(manifest, 14), 14);
            insertHistory(connection, numbered(manifest, 15), 15);
            verifyHistory(connection, manifest, false);
            connection.commit();
        } catch (SQLException | IOException | RuntimeException failure) {
            connection.rollback();
            throw failure;
        } finally {
            connection.setAutoCommit(true);
        }
    }

    private static void verifyIdentity(Connection connection, String database, String environment, String project)
            throws SQLException {
        if (!scalar(connection, "SELECT current_database()").equals(database)
                || !scalar(connection, "SHOW server_version_num").startsWith("16")) {
            throw new IllegalStateException("대상 DB 이름 또는 PostgreSQL 16 버전이 다릅니다.");
        }
        List<String> markers = rows(connection, "SELECT config FROM pg_db_role_setting setting"
                + " JOIN pg_database db ON db.oid=setting.setdatabase"
                + " CROSS JOIN LATERAL unnest(setting.setconfig) config"
                + " WHERE db.datname=current_database() AND setting.setrole=0"
                + " AND (config LIKE 'gromo.environment=%' OR config LIKE 'gromo.fcm_project_id=%') ORDER BY config");
        if (!markers.equals(List.of("gromo.environment=" + environment, "gromo.fcm_project_id=" + project))) {
            throw new IllegalStateException("DB 환경·FCM 프로젝트 표식이 다릅니다.");
        }
    }

    private static void verifyHistory(Connection connection, Map<String, Migration> manifest, boolean source)
            throws SQLException {
        List<String> actual = rows(connection, "SELECT installed_rank||'|'||version||'|'||description"
                + "||'|'||type||'|'||script||'|'"
                + "||checksum||'|'||success FROM flyway_schema_history ORDER BY installed_rank");
        List<String> expected = new ArrayList<>();
        for (int version = 1; version <= (source ? 9 : 15); version++) {
            expected.add((version >= 10 ? version + 1 : version) + "|" + numbered(manifest, version).history());
        }
        if (source) {
            expected.add("10|" + manifest.get(BRIDGE).history());
        }
        if (!actual.equals(expected)) {
            throw new IllegalStateException("알려진 정확한 Flyway 이력과 일치하지 않습니다.");
        }
    }

    private static void insertHistory(Connection connection, Migration migration, int rank) throws SQLException {
        // 기존 V1–V9의 rank·installed_by·시각은 보존하고 새 이력만 추가한다.
        try (PreparedStatement statement = connection.prepareStatement("INSERT INTO flyway_schema_history"
                + " (installed_rank,version,description,type,script,checksum,installed_by,execution_time,success)"
                + " VALUES(?,?,?,'SQL',?,?,current_user,0,true)")) {
            statement.setInt(1, rank + 1);
            statement.setString(2, migration.version());
            statement.setString(3, migration.description());
            statement.setString(4, migration.script());
            statement.setInt(5, migration.checksum());
            statement.executeUpdate();
        }
    }

    private static void verifySchema(Connection connection, String file) throws SQLException, IOException {
        if (!schema(connection).equals(resource(ROOT + file))) {
            throw new IllegalStateException("알려진 public 스키마 구조와 일치하지 않습니다: " + file);
        }
    }

    static String schema(Connection connection) throws SQLException {
        return String.join("\n", rows(connection, resourceSql())) + "\n";
    }

    private static String resourceSql() {
        try {
            return resource(ROOT + "schema-fingerprint.sql");
        } catch (IOException failure) {
            throw new IllegalStateException("스키마 검사 리소스 누락", failure);
        }
    }

    private static Map<String, Migration> manifest() throws IOException {
        Map<String, Migration> result = new LinkedHashMap<>();
        for (String line : resource(ROOT + "migrations.txt").lines().toList()) {
            String[] fields = line.split("\\|");
            String location = fields[0].equals(BRIDGE) ? ROOT : "/db/migration/";
            if (!sha256(resource(location + fields[0]).getBytes(StandardCharsets.UTF_8)).equals(fields[2])) {
                throw new IllegalStateException("고정된 원본 마이그레이션 SHA256 불일치");
            }
            result.put(fields[0], new Migration(fields[0], Integer.parseInt(fields[1])));
        }
        return result;
    }

    private static Migration numbered(Map<String, Migration> manifest, int version) {
        return manifest.values().stream().filter(m -> m.version().equals(Integer.toString(version)))
                .findFirst().orElseThrow();
    }

    private record Migration(String script, int checksum) {
        String version() {
            return script.substring(1, script.indexOf("__")).replace('_', '.');
        }

        String description() {
            return script.substring(script.indexOf("__") + 2, script.length() - 4).replace('_', ' ');
        }

        String history() {
            return version() + "|" + description() + "|SQL|" + script + "|" + checksum + "|true";
        }
    }

    static String resource(String name) throws IOException {
        try (var stream = NotificationReleaseBridge.class.getResourceAsStream(name)) {
            if (stream == null) {
                throw new IOException("리소스 누락: " + name);
            }
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static List<String> rows(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            List<String> rows = new ArrayList<>();
            while (result.next()) {
                rows.add(result.getString(1));
            }
            return rows;
        }
    }

    private static String scalar(Connection connection, String sql) throws SQLException {
        return rows(connection, sql).get(0);
    }

    private static void execute(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String required(Map<String, String> options, String key) {
        String value = options.get(key);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("필수 인자: " + key);
        }
        return value;
    }

    private static String requiredEnv(String key) {
        return required(System.getenv(), key);
    }
}
