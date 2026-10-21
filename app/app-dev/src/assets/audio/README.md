# 축음기 음원

축음기(공용 음악)가 재생하는 번들 음원 4곡. 로컬 목업은 `waves`·`forest-wind`·`campfire`를 기본 보유곡으로, `rain`을 구매곡으로 표시한다. 재생 코드는 `src/constants/audio.ts`가 `audio/<trackId>.wav` 키로 찾는다. 키는 예전 이름 그대로이고 실제 파일은 `<trackId>.m4a`다(GROMO-2379). 파일명·규격을 바꾸면 `src/constants/assets.ts`도 함께 봐야 한다.

## 목록과 출처 (GROMO-1842, 2026-09-30)

| ID            | 앱 파일           | 원본 제목             | 제작자         | 라이선스 | 원본 페이지                                                | 루프 길이 |
| ------------- | ----------------- | --------------------- | -------------- | -------- | ---------------------------------------------------------- | --------- |
| `waves`       | `waves.m4a`       | Calm ocean waves      | SamsterBirdies | CC0 1.0  | https://freesound.org/people/SamsterBirdies/sounds/578524/ | 90.000초  |
| `rain`        | `rain.m4a`        | Rain_Loop.wav         | Snoopy20111    | CC0 1.0  | https://freesound.org/people/Snoopy20111/sounds/399072/    | 90.000초  |
| `campfire`    | `campfire.m4a`    | campfire.wav          | Spandau        | CC0 1.0  | https://freesound.org/people/Spandau/sounds/40699/         | 90.000초  |
| `forest-wind` | `forest-wind.m4a` | Akacie_AFW2007_01.aif | Akacie         | CC0 1.0  | https://freesound.org/people/Akacie/sounds/73708/          | 90.000초  |

**라이선스:** 네 곡 모두 Freesound에 CC0 1.0(저작권 포기)으로 올라온 음원이다. 상업 이용·수정·앱 내장 배포에 제한이 없고 출처 표기 의무도 없다. 라이선스는 2026-09-30 각 원본 페이지에서 확인했다. 이전에 쓰던 Uppbeat 음원(Basic License, 개인 제작자 한정)과 출처 불명 파일은 모두 이 네 곡으로 교체했다.

## 편집 규격

- 형식: 32 kHz 모노 AAC-LC 64 kbps(`.m4a`, 곡당 약 720 KB). 편집 마스터는 32 kHz · 16-bit · 모노 PCM WAV이고, 앱에는 `afconvert -f m4af -d aac -b 64000 <곡>.wav <곡>.m4a`(macOS)로 바꿔 넣는다. 길이는 네 곡 모두 정확히 90.000초(`duration_millis = 90000`).
- AAC 앞뒤에 붙는 인코더 무음(앞 2112 · 뒤 448 샘플)은 파일의 gapless 정보(`iTunSMPB`)에 적혀 있어, 이를 읽는 디코더는 잘라내고 정확히 2,880,000 샘플(90초)만 재생한다(ffmpeg로 확인). 루프 이음새는 실기기에서 들어 확인한다.
- 음량: 네 곡을 통합 음량 −26 LUFS(모노 파일 기준)로 맞췄다. 모노가 양쪽 채널로 재생되면 스테레오 환산 약 −23 LUFS(방송 기준)다. 곡을 바꿔도 체감 볼륨이 튀지 않게 하기 위한 값이다. 피크는 −1 dBFS 리미터로만 보호하며, 게인·리미터는 구간을 자르기 전에 걸어 리미터 지연(약 5 ms)이 파일 앞머리에 무음으로 남지 않게 했다.
- 루프: 원본의 `[오프셋+4초, 오프셋+94초)` 구간을 본체로 쓰고, 끝 4초를 원본의 `[오프셋, 오프셋+4초)`와 등출력(qsin) 크로스페이드로 이어 붙였다. 파일 끝이 파일 시작 직전 소리로 흘러가므로 `loop` 재생 때 이음새가 없다. 오프셋은 `campfire` 5초, 나머지 2초.
- 재현: `scripts/make-audio-loop.sh <원본> <출력.wav> 90 <오프셋> 4`로 WAV 마스터를 만든 뒤 위 `afconvert`로 `.m4a`를 만든다. ffmpeg·ffprobe·python3가 필요하다.

## 소스 파일에 관한 메모

편집 소스는 Freesound가 공개 CDN으로 제공하는 HQ 미리듣기(192 kbps Vorbis, `https://cdn.freesound.org/previews/<id 앞자리>/<id>_<user id>-hq.ogg`)다. 원본 WAV/AIF는 로그인해야 받을 수 있어 아직 쓰지 않았다. 32 kHz 모노로 줄인 결과물에서 차이는 미미하지만, 원본으로 다시 만들려면 로그인 후 원본 페이지에서 내려받아 위 재현 명령을 그대로 돌리면 된다. 코드 변경은 없다.

## 서버 등록

공용 재생 서버의 `audio_tracks.duration_millis`(V73 마이그레이션)에는 네 곡 모두 `90000`을 등록해야 재생 위치 계산이 실제 파일과 일치한다. 이 값은 백엔드가 관리한다. 앱과 서버 모두 이 값으로 재생 위치를 계산하므로, 서버 값을 먼저(또는 같은 배포에서) 맞춘 뒤 이 음원을 배포해야 한다.
