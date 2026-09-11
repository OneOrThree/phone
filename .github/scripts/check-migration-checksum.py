#!/usr/bin/env python3
"""빌드된 Noti의 실제 Jackson과 Data export 직렬화를 같은 JVM에서 대조한다."""
from pathlib import Path
import os
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PROBE = r'''
package com.oneorthree.notification;
import java.util.*;
import com.oneorthree.phone.notification.migration.MigrationCanonicalJson;
import com.oneorthree.phone.notification.migration.NotificationMigrationRecord;
public class MigrationContractProbe {
    public static void main(String[] args) {
        Map<String,Object> value = new LinkedHashMap<>();
        StringBuilder controls = new StringBuilder();
        for (int i=0;i<32;i++) controls.append((char)i);
        value.put("nickname", "한글😀" + controls);
        value.put("amount", 12L);
        value.put("nullable", null);
        value.put("params", Map.of("Ａ", 2, "😀", 1, "groupName", "가족\n그룹"));
        value.put("array", Arrays.asList(true, null, 19, "日本語", "繁體中文"));
        // 전송된 JSON을 실제 수신기가 다시 읽은 값도 같은 체크섬이어야 한다.
        String data = MigrationCanonicalJson.canonical(value);
        if (!MigrationCanonicalJson.hash(value).equals(Json.hash(Json.map(data)))) {
            throw new AssertionError("Data export / Noti import checksum mismatch");
        }
        Map<String,Object> delivery = new LinkedHashMap<>();
        delivery.put("eventId", "noti:BET_RESULT:u:s:none");
        delivery.put("userId", "11111111-1111-4111-8111-111111111111");
        delivery.put("kind", "BET_RESULT"); delivery.put("subjectId", "session-1");
        delivery.put("groupId", null); delivery.put("slotAt", 1789118400000L);
        delivery.put("locale", "ko"); delivery.put("status", "DEFERRED");
        delivery.put("attempts", 0); delivery.put("nextAttemptAt", 1789196400000L);
        delivery.put("sentAt", null); delivery.put("params", value);
        if (!MigrationCanonicalJson.hash(delivery).equals(Json.hash(Json.map(
                MigrationCanonicalJson.canonical(delivery))))) {
            throw new AssertionError("delivery checksum mismatch");
        }
        checkRecord("delivery", delivery, "noti:BET_RESULT:u:s:none");
        String userId = "11111111-1111-4111-8111-111111111111";
        String sessionId = "22222222-2222-4222-8222-222222222222";
        Map<String,Object> user = new LinkedHashMap<>();
        user.put("userId", userId); user.put("version", 17L);
        user.put("displayName", "한글😀" + controls); user.put("locale", null);
        user.put("settingsPresent", false);
        for (String key : List.of("notificationEnabled", "soundEnabled", "nightModeEnabled",
                "nightStartTime", "nightEndTime")) user.put(key, null);
        checkRecord("user", user, userId);
        user.put("settingsPresent", true); user.put("notificationEnabled", true);
        user.put("soundEnabled", false); user.put("nightModeEnabled", true);
        user.put("nightStartTime", "22:00:00"); user.put("nightEndTime", "08:30:00");
        checkRecord("user", user, userId);
        Map<String,Object> settings = new LinkedHashMap<>(user);
        for (String key : List.of("displayName", "locale", "settingsPresent")) settings.remove(key);
        checkRecord("settings", settings, userId);
        settings.put("nightStartTime", null); settings.put("nightEndTime", null);
        checkRecord("settings", settings, userId);
        Map<String,Object> device = new LinkedHashMap<>();
        device.put("deviceToken", "synthetic-fcm-token"); device.put("userId", userId);
        device.put("authGeneration", null); device.put("active", false);
        checkRecord("device", device, Json.digest("synthetic-fcm-token"));
        device.put("authGeneration", 12L); device.put("active", true);
        checkRecord("device", device, Json.digest("synthetic-fcm-token"));
        Map<String,Object> participation = new LinkedHashMap<>();
        participation.put("userId", userId); participation.put("sessionId", sessionId);
        participation.put("version", 17L);
        participation.put("challengeId", "33333333-3333-4333-8333-333333333333");
        participation.put("groupId", "44444444-4444-4444-8444-444444444444");
        participation.put("sessionStatus", "OPEN"); participation.put("stake", 100000L);
        participation.put("joinClosesAt", 1789196400000L); participation.put("achieved", null);
        checkRecord("participation", participation, userId + ":" + sessionId);
        participation.put("achieved", true);
        checkRecord("participation", participation, userId + ":" + sessionId);
        System.out.println("PASS Data/Noti canonical records: unicode, controls, nulls, all five resources");
    }

    private static void checkRecord(String resource, Map<String,Object> value, String expectedKey) {
        NotificationMigrationRecord exported = NotificationMigrationRecord.of(resource, expectedKey, value);
        Map<String,Object> received = Json.map(MigrationCanonicalJson.canonical(exported.toWire()));
        Map<String,Object> canonical = MigrationRecords.canonical(resource, Json.map(received.get("data")));
        if (!exported.recordChecksum().equals(MigrationRecords.checksum(canonical))) {
            throw new AssertionError(resource + " canonical checksum mismatch");
        }
        if (!expectedKey.equals(MigrationRecords.recordKey(resource, canonical))) {
            throw new AssertionError(resource + " record key mismatch");
        }
    }
}
'''


def main():
    jars = [p for p in (ROOT / 'server/notification/build/libs').glob('*.jar')
            if not p.name.endswith('-plain.jar')]
    if len(jars) != 1:
        raise SystemExit('notification bootJar를 먼저 빌드해야 합니다')
    with tempfile.TemporaryDirectory(prefix='migration-checksum-') as temporary:
        work = Path(temporary)
        classes = work / 'classes'
        with zipfile.ZipFile(jars[0]) as archive:
            libraries = [n for n in archive.namelist()
                         if n.startswith('BOOT-INF/lib/') and n.endswith('.jar')]
            for name in libraries:
                (work / Path(name).name).write_bytes(archive.read(name))
            for name in archive.namelist():
                if not name.startswith('BOOT-INF/classes/') or not name.endswith('.class'):
                    continue
                relative = Path(name.removeprefix('BOOT-INF/classes/'))
                if relative.is_absolute() or '..' in relative.parts:
                    raise SystemExit('잘못된 bootJar 클래스 경로')
                target = classes / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(name))
        for name in ('MigrationCanonicalJson', 'NotificationMigrationRecord'):
            (work / f'{name}.java').write_text((ROOT /
                f'server/data-api/src/main/java/com/oneorthree/phone/notification/migration/{name}.java')
                .read_text())
        (work / 'MigrationContractProbe.java').write_text(PROBE)
        classpath = os.pathsep.join([str(classes), *(str(work / Path(name).name) for name in libraries)])
        subprocess.run(['javac', '-encoding', 'UTF-8', '-cp', classpath, '-d', str(work),
                        *map(str, work.glob('*.java'))], check=True)
        subprocess.run(['java', '-cp', str(work) + os.pathsep + classpath,
                        'com.oneorthree.notification.MigrationContractProbe'], check=True)


if __name__ == '__main__':
    main()
