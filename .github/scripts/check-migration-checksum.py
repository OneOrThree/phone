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
        System.out.println("PASS Data/Noti checksum: control chars, unicode, nested keys, nulls, delivery");
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
        with zipfile.ZipFile(jars[0]) as archive:
            libraries = [n for n in archive.namelist()
                         if n.startswith('BOOT-INF/lib/jackson-') and n.endswith('.jar')]
            for name in libraries:
                # archive 경로를 파일시스템 경로로 신뢰하지 않는다.
                (work / Path(name).name).write_bytes(archive.read(name))
        for name in ('Json', 'NotificationFailure'):
            (work / f'{name}.java').write_text((ROOT /
                f'server/notification/src/main/java/com/oneorthree/notification/{name}.java').read_text())
        (work / 'MigrationCanonicalJson.java').write_text((ROOT /
            'server/data-api/src/main/java/com/oneorthree/phone/notification/migration/MigrationCanonicalJson.java')
            .read_text())
        (work / 'MigrationContractProbe.java').write_text(PROBE)
        classpath = os.pathsep.join(str(work / Path(name).name) for name in libraries)
        subprocess.run(['javac', '-encoding', 'UTF-8', '-cp', classpath, '-d', str(work),
                        *map(str, work.glob('*.java'))], check=True)
        subprocess.run(['java', '-cp', str(work) + os.pathsep + classpath,
                        'com.oneorthree.notification.MigrationContractProbe'], check=True)


if __name__ == '__main__':
    main()
