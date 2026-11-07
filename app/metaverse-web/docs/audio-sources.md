# 섬 배경음

일반 섬 산책과 낚시섬 준비 단계는 기존 기본 무료 음원 `forest-wind.m4a`, 의자에서 낚시 집중과 모닥불 휴식은 기존 모닥불 음원 `campfire.m4a`를 사용한다. `app/app-dev/src/assets/audio/`의 파일을 `public/audio/`에 바이트 그대로 복사했다. 새 음원 생성·재편집·외부 CDN 재생은 하지 않았다.

| 웹 파일                 | 원본 제목             | 제작자  | 라이선스 | 원본 페이지                                        |
| ----------------------- | --------------------- | ------- | -------- | -------------------------------------------------- |
| `audio/forest-wind.m4a` | Akacie_AFW2007_01.aif | Akacie  | CC0 1.0  | https://freesound.org/people/Akacie/sounds/73708/  |
| `audio/campfire.m4a`    | campfire.wav          | Spandau | CC0 1.0  | https://freesound.org/people/Spandau/sounds/40699/ |

출처·기존 편집 내역은 `app/app-dev/src/assets/audio/README.md`를 따른다. 원본 페이지의 CC0 표시는 코디네이터가 2026-11-07 재확인했다. 이 작업자는 원본 페이지를 별도로 열람하지 않았다.

## 파일 동일성 및 길이

2026-11-07 SHA-256 검증에서 원본과 웹 복사본이 각각 일치했다.

- `campfire.m4a`: `25d29359527a7212dde15182828e2885c52228bd1963ef94d0fa0de313a33fe7`
- `forest-wind.m4a`: `b0568eb51b35dc75cebf0d13e0f9da3bce86f4036cdcf894553ad2d611da2853`

두 파일 모두 AAC, 32 kHz, 모노다. ffprobe의 컨테이너 길이는 인코더 패딩을 포함한 90.080초다. ffmpeg PCM 디코드 결과는 각각 5,760,000바이트(16비트 모노, 2,880,000샘플), 정확히 90초다. Chromium AudioContext 디코드도 각각 90초(48 kHz로 리샘플된 4,320,000샘플)였다. 실제 loopEnd는 브라우저가 디코드한 buffer.duration을 사용한다.

## 연결 계약

`useIslandAudio(focusing: boolean)`는 `{ enabled, volume, state, mode, error, unlock, toggle, setVolume }`을 반환한다.

- `state`: `locked | loading | playing | muted | error`, `mode`: `ambient | focus`, `error`: `string | null`.
- 기본 enabled=true, volume=0.35지만 최초 상태는 locked이며 자동 재생하지 않는다. main의 pointerdown/key capture에서 `unlock()`을 직접 동기 호출한다. 소리 버튼의 실제 이벤트 핸들러에서 `toggle()`을 호출한다. unlock을 effect나 타이머로 미루지 않는다.
- 저장한 enabled=false는 일반 gesture unlock으로 해제되지 않는다. `setVolume`은 유한한 값만 받고 0~1로 제한한다. 음소거와 볼륨은 `cattus-island-audio-v1` localStorage에 저장한다.
- 최초 gesture에서 AudioContext.resume을 다운로드보다 먼저 호출한다. 두 로컬 파일의 디코드가 모두 끝나면 source를 각각 한 번 시작하고 gain만 0.8초 선형 크로스페이드한다. 빠른 전환에서도 현재 페이드 값을 이어받는다. 두 루프는 음소거 중에도 진행하지만 master gain이 0이므로 focus 변경이 소리를 켜지 않는다.
- focus 변경·볼륨·음소거에 React 렌더링마다 context를 재생성하지 않는다. unmount는 fetch 중단, source 정지·연결 해제, context 종료를 수행한다. visibilitychange로 재생을 중단하지 않는다. 브라우저나 OS가 context를 중단하면 playing으로 표시하지 않고 다음 직접 gesture에서 resume을 재시도한다.
- 다운로드·AAC 디코드·resume 오류는 error로 노출한다. 오류 UI에서 다시 켜려면 직접 gesture에서 unlock을 호출한다. 브라우저 자체의 배경 탭/OS 절전 정책은 강제로 해제할 수 없다.

## 검증 근거

`npx tsx --test tests/audio.test.ts`: 5개 통과. 동기 gesture resume, 로컬 소스 선택, 90초 loop 설정, 반복 unlock 중복 source 방지, 0.8초 페이드 예약, 로딩 중 mute/focus/volume 경합, 저장된 음소거, resume/디코드 오류, unmount 후 늦은 완료를 검사한다.

로컬 Vite의 독립 빈 페이지에서 Playwright Chromium 실제 WebAudio로 검증했다(autoplay-policy=user-gesture-required). 클릭 전 locked, 클릭 후 playing, ambient gain=1/focus gain=0을 확인했다. 1.2초 대기 동안 AudioContext.currentTime이 1.205333초 진행했다. focus 전환 0.9초 뒤 ambient gain=0/focus gain=1이었다. mute 후 ambient 복귀와 일반 unlock을 호출해도 enabled=false/state=muted/master gain=0/source 수=2를 유지했다. 이 검증은 브라우저 디코드·시간 진행·gain 상태 근거이며 스피커 청취나 90초 전체 루프 경계 청취를 주장하지 않는다.

초기 병렬 작업 중에는 다른 파일의 통합 전 타입 오류로 전체 검사가 실패했다. 이후 App 통합과 오류 수정 뒤 전체 TypeScript 검사·빌드가 통과했다. `tests/focus-qa.mjs`에서 실제 착석·퇴석에 따른 gain 전환, 음소거 유지와 타이머를 확인했다. 실제 스피커 청취는 검증하지 않았다.
