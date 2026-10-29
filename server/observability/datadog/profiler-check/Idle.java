import java.nio.file.Files;
import java.nio.file.Path;

// 재현용 빈 앱 — /tmp 마운트 옵션을 한 줄 찍고 인자로 받은 초만큼 기다린다(프로파일러 시작 지연을 넘기기 위해).
public class Idle {
    public static void main(String[] args) throws Exception {
        for (String line : Files.readAllLines(Path.of("/proc/self/mounts"))) {
            String[] f = line.split(" ");
            if (f.length > 3 && (f[1].equals("/tmp") || f[1].equals("/ddprof"))) {
                System.out.println("MOUNT " + f[1] + " " + f[3]);
            }
        }
        Thread.sleep(Long.parseLong(args.length > 0 ? args[0] : "40") * 1000L);
    }
}
