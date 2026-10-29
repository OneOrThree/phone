import java.nio.file.Files;
import java.nio.file.Path;

// 재현용 빈 앱 — /tmp·/ddprof 마운트 옵션을 찍고 인자로 받은 초만큼 기다린다(프로파일러 시작 지연을 넘기기 위해).
public class Idle {
    public static void main(String[] args) throws Exception {
        for (String line : Files.readAllLines(Path.of("/proc/self/mounts"))) {
            String[] f = line.split(" ");
            if (f.length > 3 && (f[1].equals("/tmp") || f[1].equals("/ddprof"))) {
                System.out.println("MOUNT " + f[1] + " " + f[3]);
            }
        }
        Thread.sleep(Long.parseLong(args.length > 0 ? args[0] : "40") * 1000L);
        // sleep 뒤 /ddprof 아래 파일과 소유 uid 를 찍는다(crash tracking 초기화 여부 확인용, 외부 연결 없음).
        Path root = Path.of("/ddprof");
        if (Files.isDirectory(root)) {
            try (var walk = Files.walk(root)) {
                for (Path p : (Iterable<Path>) walk::iterator) {
                    System.out.println("DDFILE " + p + " uid=" + Files.getAttribute(p, "unix:uid"));
                }
            }
        }
    }
}
