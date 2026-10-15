package com.oneorthree.phone.notification.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.DefaultApplicationArguments;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class NotificationMigrationCliRunnerTest {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();

    @Test
    void allChunksAndVerificationCarryTheExportSnapshot() throws Exception {
        List<NotificationMigrationRecord> records = IntStream.range(0, 501)
                .mapToObj(i -> new NotificationMigrationRecord("settings", "user-" + i,
                        Map.of("userId", "user-" + i), "fixture-checksum")).toList();
        String snapshot = run(records);
        var first = json.readTree(Files.readString(directory.resolve("export.import-0000.json")));
        var second = json.readTree(Files.readString(directory.resolve("export.import-0001.json")));
        assertThat(first.get("snapshot").asText()).isEqualTo(snapshot);
        assertThat(second.get("snapshot").asText()).isEqualTo(snapshot);
        assertThat(first.get("records").size()).isEqualTo(500);
        assertThat(second.get("records").size()).isEqualTo(1);
        assertThat(second.get("records").get(0).get("recordKey").asText()).isEqualTo("user-500");
        var verify = json.readTree(Files.readString(directory.resolve("export.verify.json")));
        assertThat(verify.get("manifest").get("snapshot").asText()).isEqualTo(snapshot);
    }

    @Test
    void emptySnapshotStillHasAnExplicitImportChunk() throws Exception {
        String snapshot = run(List.of());
        var batch = json.readTree(Files.readString(directory.resolve("export.import-0000.json")));
        assertThat(batch.get("snapshot").asText()).isEqualTo(snapshot);
        assertThat(batch.get("records").isArray()).isTrue();
        assertThat(batch.get("records").size()).isZero();
        assertThat(directory.resolve("export.import-0001.json")).doesNotExist();
    }

    @Test
    void lenientFailedExportWritesOnlyTheDiagnosticDocument() throws Exception {
        run(List.of(), true, false, 1757577600000L, true);
        var diagnostic = json.readTree(Files.readString(directory.resolve("export.json")));
        assertThat(diagnostic.get("report").get("finalEligible").asBoolean()).isFalse();
        assertThat(directory.resolve("export.verify.json")).doesNotExist();
        assertThat(directory.resolve("export.import-0000.json")).doesNotExist();
    }

    @Test
    void lenientModeCannotPublishEvenWhenTheExportChecksPass() throws Exception {
        run(List.of(), true, true, 1757577600000L, true);
        assertThat(directory.resolve("export.json")).exists();
        assertThat(directory.resolve("export.verify.json")).doesNotExist();
        assertThat(directory.resolve("export.import-0000.json")).doesNotExist();
    }

    @Test
    void strictExplorationWithoutAStopWindowAlsoRemainsDiagnosticOnly() throws Exception {
        run(List.of(), false, false, null, false);
        assertThat(directory.resolve("export.json")).exists();
        assertThat(directory.resolve("export.verify.json")).doesNotExist();
        assertThat(directory.resolve("export.import-0000.json")).doesNotExist();
    }

    @ParameterizedTest
    @ValueSource(strings = {"export.verify.json", "export.import-0000.json", "export.import-9999.json"})
    void staleSiblingsRejectTheOutputNameBeforeWritingANewDiagnosis(String sibling) throws Exception {
        Path stale = directory.resolve(sibling);
        Files.writeString(stale, "previous-snapshot");

        assertThatThrownBy(() -> run(List.of(), true, false, 1757577600000L, true))
                .isInstanceOf(java.io.IOException.class);

        assertThat(directory.resolve("export.json")).doesNotExist();
        assertThat(Files.readString(stale)).isEqualTo("previous-snapshot");
    }

    @Test
    void anotherOutputPrefixDoesNotBlockFreshExport() throws Exception {
        Files.writeString(directory.resolve("another.verify.json"), "previous-snapshot");
        run(List.of());
        assertThat(directory.resolve("export.verify.json")).exists();
        assertThat(Files.readString(directory.resolve("another.verify.json"))).isEqualTo("previous-snapshot");
    }

    private String run(List<NotificationMigrationRecord> records) throws Exception {
        return run(records, false, true, 1757577600000L, true);
    }

    private String run(List<NotificationMigrationRecord> records, boolean lenient, boolean finalEligible,
                       Long closedAt, boolean drained) throws Exception {
        String snapshot = UUID.randomUUID().toString();
        var manifest = new NotificationMigrationManifest(1, snapshot, Map.of(),
                new NotificationMigrationManifest.StopWindow(closedAt, "test-cursor", 0, "data-api"));
        var report = new NotificationExportDocument.Report(List.of(), Map.of(), Map.of(), drained, finalEligible);
        var document = new NotificationExportDocument(Instant.parse("2026-09-11T00:00:00Z"),
                "migration-test", manifest, records, List.of(), report);
        var exports = mock(NotificationExportService.class);
        when(exports.export("migration-test", closedAt, drained, !lenient)).thenReturn(document);
        var runner = new NotificationMigrationCliRunner(exports, mock(NotificationCronReplayService.class));
        var arguments = new java.util.ArrayList<>(List.of("--notification.migration.export-to="
                + directory.resolve("export.json"), "--notification.migration.id=migration-test",
                "--notification.migration.lenient=" + lenient, "--notification.migration.inflight-drained=" + drained));
        if (closedAt != null) {
            arguments.add("--notification.migration.closed-at=" + closedAt);
        }
        runner.run(new DefaultApplicationArguments(arguments.toArray(String[]::new)));
        return snapshot;
    }
}
