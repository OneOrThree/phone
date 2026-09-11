package com.oneorthree.phone.notification.migration;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Set;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 이관 CLI — <b>같은 배포본 · 같은 DB 커넥션</b>으로 도는 로컬 실행 진입점 (계약 §5 · §8).
 *
 * <h2>왜 별도 스크립트가 아닌가</h2>
 * export 의 핵심은 「구 행이 받을 사건 키가 producer 가 만들 키와 <b>한 글자도 다르지 않다</b>」는
 * 것이다. 별도 스크립트로 키 조립을 다시 쓰면 그 보장이 «두 구현이 같기를 바라는 것»으로 내려앉는다.
 * 여기서는 {@code NotificationEventKey} 라는 <b>같은 함수</b>를 부른다.
 *
 * <p>덤으로 엔티티·리포지터리·트랜잭션 격리를 그대로 쓰므로 「48시간 밖 참조도 붙인다」 같은
 * 요구가 SQL 재작성이 아니라 평범한 조회가 된다.
 *
 * <h2>기본은 꺼짐</h2>
 * {@code --notification.migration.enabled=true} 없이는 이 빈이 아예 만들어지지 않는다. 켜진 채로
 * 들어가면 <b>매 기동마다</b> 전수 조회가 돌고, 재생 인자가 붙어 있으면 알림까지 다시 나간다.
 *
 * <h2>사용</h2>
 * <pre>{@code
 * # 최초 탐색 export (정지 창 없이. 무엇이 안 되는지만 본다)
 * SPRING_PROFILES_ACTIVE=local ./gradlew bootRun --args='\
 *   --notification.migration.enabled=true \
 *   --notification.migration.id=2026-09-11-cutover \
 *   --notification.migration.lenient=true \
 *   --notification.migration.export-to=/tmp/noti/export.json'
 *
 * # 최종 export (정지 창을 닫고 drain 을 확인한 뒤.
 * #  재조립 실패·잔여 outbox·drain 미확인이면 0 이 아닌 코드로 죽는다)
 * SPRING_PROFILES_ACTIVE=local ./gradlew bootRun --args='\
 *   --notification.migration.enabled=true \
 *   --notification.migration.id=2026-09-11-cutover \
 *   --notification.migration.closed-at=1757577600000 \
 *   --notification.migration.inflight-drained=true \
 *   --notification.migration.export-to=/tmp/noti/export.json'
 * # → export.json (전체) · export.import-0000.json… (500건씩) · export.verify.json (manifest)
 *
 * # 놓친 크론 재생 (놓친 «슬롯 시각»을 준다 — 지금 시각이 아니다)
 * ... --notification.migration.replay=notification-league-weekly-results@2026-09-08T22:00:00Z
 * }</pre>
 */
@Slf4j
@Component
@ConditionalOnProperty(prefix = "notification.migration", name = "enabled", havingValue = "true")
@RequiredArgsConstructor
public class NotificationMigrationCliRunner implements ApplicationRunner {

    /** export 파일 경로 인자. */
    static final String ARG_EXPORT_TO = "notification.migration.export-to";

    /** 재조립 실패가 있어도 죽이지 않는 사전 점검 모드 — <b>컷오버에는 쓰지 않는다</b>. */
    static final String ARG_LENIENT = "notification.migration.lenient";

    /** 이관 id — manifest 와 짝지어 운영자가 추적한다. */
    static final String ARG_MIGRATION_ID = "notification.migration.id";

    /**
     * 정지 창을 닫은 시각(epoch millis) — <b>운영자 입력</b>이다.
     *
     * <p>Data 는 「쓰기·구 발송·리스너·크론을 멈추고 인플라이트를 drain 했다」는 사실을 알 수 없다.
     * 그건 운영자가 한 일이고, 그 시각을 우리가 지어내면 verify 의 {@code verifiedAt > closedAt}
     * 검사가 <b>아무것도 검사하지 않는 것</b>이 된다. 없으면 최초 탐색 export 로 남는다.
     */
    static final String ARG_CLOSED_AT = "notification.migration.closed-at";

    /**
     * 인플라이트 drain 확인 — <b>운영자의 선언</b>이다.
     *
     * <p>DB 에는 「이미 시작된 구 워커가 아직 도는 중」이 남지 않는다. 구 flush 는 선점 행을 지우고
     * 나가므로, 그 스레드가 살아 있는지는 어떤 조회로도 알 수 없다. 그래서 이 한 가지는 사람이
     * 말해야 하고, 말하지 않으면 최종 export 를 만들지 않는다 — 없이 통과시키면 「멈췄다고 생각한」
     * 창 안에서 구 경로가 계속 발송한다.
     */
    static final String ARG_INFLIGHT_DRAINED = "notification.migration.inflight-drained";

    /** import 배치 한 묶음의 최대 레코드 수 — wire 계약 상한. */
    static final int IMPORT_BATCH_SIZE = 500;

    /** 재생 인자 — {@code <잡 이름>@<놓친 슬롯 ISO-8601>}. 여러 번 줄 수 있다. */
    static final String ARG_REPLAY = "notification.migration.replay";

    private final NotificationExportService notificationExportService;
    private final NotificationCronReplayService notificationCronReplayService;


    /**
     * 산출물 직렬화용 mapper — {@code OutboxEnvelopeCodec} 과 <b>같은 방식</b>으로 세운다.
     *
     * <p>주입받지 않는다. 이 저장소의 JSON 은 Jackson 2({@code com.fasterxml.jackson})로 쓰는데
     * Boot 4 의 컨텍스트에는 Jackson 3({@code tools.jackson}) 쪽 빈이 올라와 있어, 타입만 보고
     * 주입하면 <b>컴파일은 되고 기동에서 터진다</b>. 시간 모듈을 직접 붙이는 것도 같은 이유다 —
     * 빠지면 {@code Instant} 직렬화가 런타임에야 실패한다.
     */
    private static final ObjectMapper MAPPER = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

    @Override
    public void run(ApplicationArguments args) throws Exception {
        List<String> exportTargets = args.getOptionValues(ARG_EXPORT_TO);
        if (exportTargets != null && !exportTargets.isEmpty()) {
            boolean lenient = Boolean.parseBoolean(firstOrNull(args.getOptionValues(ARG_LENIENT)));
            String migrationId = firstOrNull(args.getOptionValues(ARG_MIGRATION_ID));
            if (migrationId == null || migrationId.isBlank()) {
                throw new IllegalArgumentException("--" + ARG_MIGRATION_ID + " 는 필수입니다 — "
                        + "manifest 와 짝이 없으면 어느 이관의 산출물인지 추적할 수 없습니다.");
            }
            String rawClosedAt = firstOrNull(args.getOptionValues(ARG_CLOSED_AT));
            Long closedAt = rawClosedAt == null || rawClosedAt.isBlank() ? null : Long.valueOf(rawClosedAt);
            boolean inflightDrained =
                    Boolean.parseBoolean(firstOrNull(args.getOptionValues(ARG_INFLIGHT_DRAINED)));
            runExport(Path.of(exportTargets.get(exportTargets.size() - 1)), lenient, migrationId,
                    closedAt, inflightDrained);
        }
        List<String> replays = args.getOptionValues(ARG_REPLAY);
        if (replays != null && !replays.isEmpty()) {
            runReplays(replays);
        }
        if ((exportTargets == null || exportTargets.isEmpty()) && (replays == null || replays.isEmpty())) {
            log.warn("이관 CLI 가 켜졌지만 할 일이 없습니다 — --{} 또는 --{} 를 주세요.",
                    ARG_EXPORT_TO, ARG_REPLAY);
        }
    }

    /**
     * 이관 문서와 <b>그대로 POST 할 수 있는 산출물</b>을 쓴다.
     *
     * <p>본문 하나로 끝내지 않는 이유: import 는 한 번에 500 건까지라 파일 하나를 그대로 보낼 수
     * 없고, 운영 중에 손으로 자르면 <b>자른 자리가 검증에 남지 않는다</b>. 그래서 배치와 verify
     * manifest 를 여기서 함께 떨어뜨린다.
     *
     * @param target      본문 출력 경로. 배치·manifest 는 같은 디렉터리에 이 이름을 접두어로 놓인다
     * @param lenient     {@code true} 면 재조립 실패가 있어도 파일을 남기고 계속한다(사전 점검 전용)
     * @param migrationId 이관 id
     * @param closedAt    정지 창을 닫은 시각(epoch millis). 최초 탐색이면 {@code null}
     * @param inflightDrained 운영자의 인플라이트 drain 확인
     * @throws IOException 파일을 쓸 수 없을 때
     */
    private void runExport(Path target, boolean lenient, String migrationId, Long closedAt,
                           boolean inflightDrained) throws IOException {

        NotificationExportDocument document =
                notificationExportService.export(migrationId, closedAt, inflightDrained, !lenient);
        if (lenient && !document.failures().isEmpty()) {
            // 사전 점검이므로 죽이지는 않지만, 「통과」로 읽히지 않게 분명히 남긴다.
            log.error("재조립 불가 발송 이력 {}건 — 이 상태로 컷오버하면 그 행들은 영영 나가지 않습니다.",
                    document.failures().size());
        }
        Path parent = target.toAbsolutePath().getParent();
        if (parent != null) {
            Files.createDirectories(parent);
        }
        ObjectWriter writer = prettyWriter();
        writeOwnerOnly(target, writer.writeValueAsString(document));

        // import 는 한 번에 500 건까지다 — 파일 하나를 그대로 POST 할 수 없으므로 배치를 미리 나눠
        // 둔다. 운영 중에 손으로 자르면 자른 자리가 검증에 남지 않는다.
        List<NotificationMigrationRecord> records = document.records();
        int batches = 0;
        // 빈 전체 스냅샷도 명시적으로 등재한다. 파일이 없으면 미적재와 전체 삭제를 구분할 수 없다.
        for (int from = 0; from < Math.max(1, records.size()); from += IMPORT_BATCH_SIZE) {
            List<Map<String, Object>> wire = records
                    .subList(from, Math.min(from + IMPORT_BATCH_SIZE, records.size()))
                    .stream().map(NotificationMigrationRecord::toWire).toList();
            Path batchPath = siblingOf(target, String.format("import-%04d.json", batches));
            writeOwnerOnly(batchPath, writer.writeValueAsString(
                    Map.of("snapshot", document.manifest().snapshot(), "records", wire)));
            batches++;
        }
        Path manifestPath = siblingOf(target, "verify.json");
        writeOwnerOnly(manifestPath, writer.writeValueAsString(Map.of("manifest", document.manifest())));

        log.info("알림 이관 export 완료 — {} (레코드 {}건, import 배치 {}개, 실패 {}건)",
                target.toAbsolutePath(), records.size(), batches, document.failures().size());
        log.info("verify manifest — {}", manifestPath.toAbsolutePath());
        if (document.report().finalEligible()) {
            log.info("이 문서는 최종 verify 에 쓸 수 있습니다 — 정지 창 확인·drain 확인·실패 0·잔여 큐 0.");
        } else {
            // 「탐색용인지 최종본인지」를 파일 이름으로는 구분할 수 없다. 로그로 분명히 남긴다.
            log.warn("이 문서는 최종 verify 에 쓸 수 없습니다(탐색용) — closedAt={}, drain 확인={}, "
                            + "실패 {}건, 잔여 {}",
                    document.manifest().stopWindow().closedAt(), document.report().inflightDrained(),
                    document.failures().size(), document.manifest().stopWindow().queueDepth());
        }
    }

    /**
     * <b>소유자만 읽을 수 있게</b> 쓴다 — {@code device} 레코드에 FCM 토큰 <b>원문</b>이 들어간다.
     *
     * <p>토큰은 그 자체가 발송 자격이다. 기본 umask 로 떨어뜨리면 같은 호스트의 다른 사용자·프로세스가
     * 그대로 읽어 임의의 사용자에게 푸시를 보낼 수 있다. 그래서 <b>만들 때부터</b> 0600 이다 —
     * 쓰고 나서 권한을 조이면 그 사이의 창이 열려 있다.
     *
     * <p>기존 출력 파일을 덮어쓰지 않는다. POSIX 권한을 보장하지 못하는 파일 시스템에서는 실패한다.
     *
     * @param target  쓸 경로
     * @param content 내용
     * @throws IOException 쓸 수 없을 때
     */
    private static void writeOwnerOnly(Path target, String content) throws IOException {
        Set<PosixFilePermission> ownerOnly = PosixFilePermissions.fromString("rw-------");
        try {
            Files.createFile(target, PosixFilePermissions.asFileAttribute(ownerOnly));
        } catch (UnsupportedOperationException e) {
            throw new IOException("이관 파일은 소유자 전용 권한을 지원하는 파일 시스템에 저장해야 합니다", e);
        }
        Files.writeString(target, content);
    }

    /**
     * export 파일 옆에 부산물을 놓는다 — 배치와 manifest 가 본문과 떨어지면 어느 export 의 것인지
     * 알 수 없게 된다.
     *
     * @param target 본문 파일
     * @param name   부산물 이름
     * @return 같은 디렉터리의 경로
     */
    private static Path siblingOf(Path target, String name) {
        Path absolute = target.toAbsolutePath();
        Path parent = absolute.getParent();
        String stem = absolute.getFileName().toString().replaceFirst("\\.json$", "");
        String fileName = stem + "." + name;
        return parent == null ? Path.of(fileName) : parent.resolve(fileName);
    }

    /**
     * 놓친 크론을 하나씩 재생하고 결과를 요약한다.
     *
     * @param specs {@code <잡 이름>@<ISO-8601>} 목록
     */
    private void runReplays(List<String> specs) {
        List<NotificationCronReplayService.ReplayResult> results = new ArrayList<>();
        for (String spec : specs) {
            int at = spec.lastIndexOf('@');
            if (at <= 0 || at == spec.length() - 1) {
                // 형식이 틀린 것을 건너뛰면 「재생했다」는 요약이 아무 일도 하지 않은 실행을 덮는다.
                throw new IllegalArgumentException(
                        "재생 인자는 \"<잡 이름>@<놓친 슬롯 ISO-8601>\" 형식이어야 합니다: " + spec);
            }
            String job = spec.substring(0, at);
            Instant missedAt = Instant.parse(spec.substring(at + 1));
            results.add(notificationCronReplayService.replay(job, missedAt));
        }
        results.forEach(result -> log.info("재생 결과 — job={}, missedAt={}, outcome={}, {}",
                result.job(), result.missedAt(), result.outcome(), result.detail()));
    }

    /**
     * 사람이 읽을 JSON — 이 파일은 운영자가 눈으로 대조하는 산출물이라 들여쓰기를 켠다.
     *
     * <p>주의: <b>체크섬은 이 writer 로 만들지 않는다.</b> 체크섬의 정본은
     * {@code MigrationCanonicalJson} 이고, 그쪽은 공백 없는 키 정렬 형태다. 여기서 나온 예쁜 JSON 을
     * 해시하면 값이 전혀 달라진다.
     *
     * @return 들여쓰기 켜진 writer
     */
    private static ObjectWriter prettyWriter() {
        return MAPPER.writerWithDefaultPrettyPrinter();
    }

    private static String firstOrNull(List<String> values) {
        return values == null || values.isEmpty() ? null : values.get(0);
    }
}
