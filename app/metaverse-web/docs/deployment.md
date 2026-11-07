# 3D 웹 배포

대표 주소는 <https://try.oneorthree.world/>다. 소유자의 2026-11-07 지시에 따라 기존 공개 웹을 3D 웹으로 교체한다. 기존 계정·집중 기록과 분리된 체험이며 새로고침·연결 종료 때 현재 방의 집중과 예약을 해제한다.

## 배포 대상

- 정적 웹: 기존 Vercel `joejaeyoungs-projects/cattus-web-demo`.
- 실시간 방: Cloudflare `cattus-3d-room`, 동일 계정의 SQLite Durable Object `IslandRoom` 하나. `/island-room`만 연결하고 Origin은 대표 주소 하나로 제한한다. 두 섬 합계 60명·낚시 의자 30석이다.
- 기존 `/service-api/*` Worker·계정 서버·AWS·DNS·네이티브 앱은 이번 배포에서 바꾸지 않는다. 실시간 연결은 전용 Worker의 `workers.dev` 주소를 빌드에 명시한다.
- 비밀 키는 웹·저장소·빌드 인자에 넣지 않는다. CLI에 로그인된 Vercel·Cloudflare 계정을 사용한다.

## 검증·발행

PR의 CI와 최신 head 리뷰를 확인해 main에 squash merge한 뒤 그 소스와 일치하는 작업 디렉터리에서 실행한다. `ROOM_URL` 아래 값은 `room:deploy`가 돌려준 정확한 공개 주소를 사용한다.

```sh
npm ci
npm test
npm run build
npm run room:deploy
VITE_ROOM_URL=wss://<배포한-Worker>.workers.dev/island-room npm run build
SOURCE_REVISION=<main-머지-SHA> VITE_ROOM_URL=wss://<배포한-Worker>.workers.dev/island-room npm run prepare:deploy
vercel link --yes --project cattus-web-demo --scope joejaeyoungs-projects --cwd dist
vercel deploy --prod --yes --scope joejaeyoungs-projects --cwd dist
```

`prepare:deploy`는 빌드의 방 주소와 헤더 설정을 대조하고 `version.json`에 소스 커밋을 기록한다. HTML은 매번 재검증·no-transform, 해시 JS/CSS는 1년 immutable, 해시 없는 동일 음원·폰트는 하루 캐시 후 재검증한다. 예전 `/experience(.html)`·`/google-login(.html)` 주소는 새 첫 화면으로 보낸다.

게시 뒤 대표 주소의 `version.json`, HTML·JS 캐시 헤더, 단일 브라우저의 이동→낚시섬→착석→휴식→복귀→종료를 확인한다. 부하 검사는 localhost에서만 수행한다. AWS 대상 부하·스트레스·지속 검사와 시험 데이터 생성은 금지다.

## 되돌리기

발행 전에 Vercel의 현재 Production 배포 URL을 기록한다. 새 웹을 되돌릴 때는 그 배포를 `vercel rollback <이전-배포-URL> --scope joejaeyoungs-projects`로 복구한다. 기존 API Worker는 유지되므로 기존 웹도 같은 API로 돌아온다. 새 방 Worker는 이름이 별개이므로 웹 롤백 중 삭제하지 않는다. 방 코드 변경은 연결을 끊을 수 있으며 현재 클라이언트는 세션 종료를 알리고 일반 섬으로 재접속한다.

## 최적화 근거

- 첫 화면 동기 JavaScript 1,314,007 → 259,799 bytes, gzip 366,068 → 83,059 bytes. 전체 3D 코드가 삭제된 것은 아니며 이어서 받는다. React·Three 엔진은 별도 해시 청크여서 UI 수정 때 캐시를 재사용한다.
- 움직이지 않을 때 10Hz move 전송을 없애고 30초 heartbeat만 보낸다. 공개 방은 변경 때만 최대 10Hz로 snapshot을 묶어 보내며 유휴 연결은 WebSocket Hibernation을 사용한다.
- 숨겨진 탭에서는 Canvas와 HUD 갱신을 멈춘다. 로컬 회귀 검사에서 유휴 move 0건, 숨김 상태 draw call 0건과 다시 보일 때 재개를 확인했다. 실제 기기의 배터리·발열 측정은 아니다.
- 에셋 geometry·재질·음원 품질은 줄이지 않았다. 초기 총 다운로드가 위 동기 JS 크기와 같다는 뜻은 아니다.
- [검증 상세](optimization-validation.json). API는 [Cloudflare WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/), 렌더 수명은 [R3F 성능 지침](https://r3f.docs.pmnd.rs/advanced/scaling-performance)을 참고했다.
