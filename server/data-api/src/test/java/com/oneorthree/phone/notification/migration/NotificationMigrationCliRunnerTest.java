package com.oneorthree.phone.notification.migration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
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

    private String run(List<NotificationMigrationRecord> records) throws Exception {
        String snapshot = UUID.randomUUID().toString();
        var manifest = new NotificationMigrationManifest(1, snapshot, Map.of(),
                new NotificationMigrationManifest.StopWindow(null, "test-cursor", 0, "data-api"));
        var report = new NotificationExportDocument.Report(List.of(), Map.of(), Map.of(), false, false);
        var document = new NotificationExportDocument(Instant.parse("2026-09-11T00:00:00Z"),
                "migration-test", manifest, records, List.of(), report);
        var exports = mock(NotificationExportService.class);
        when(exports.export("migration-test", null, false, true)).thenReturn(document);
        var runner = new NotificationMigrationCliRunner(exports, mock(NotificationCronReplayService.class));
        runner.run(new DefaultApplicationArguments("--notification.migration.export-to="
                + directory.resolve("export.json"), "--notification.migration.id=migration-test"));
        return snapshot;
    }
}
