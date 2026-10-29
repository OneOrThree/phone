# 홈 바다 원본과 재생성

2026-10-17 사용자가 확인한 HTML 시안의 주간 `ocean-day-v2.png`, 야간
`ocean-night.png`, 홈 `island-cutout.png`를 각각 `day.png`, `night.png`,
`home-cutout.png`로 보관한다. 시안과 원본 프롬프트는 [티켓 2326](https://romance.atlassian.net/browse/GROMO-2326)의 첨부 묶음에 있다.

- 새 바다는 전체 이미지 기준 512px 정사각형으로 반복한다. 반사 타일 대신 64px 경계 중첩을
  생성 단계에서 적용해 양쪽 변을 연결한다. 결과는 1190×1190이며 실제 표시 크기는 512px이다.
- 컷아웃의 **알파만** 쓴다. 최종 섬 RGB는 `backgrounds/island/base/{day,night}.png`와
  모든 픽셀이 같다. 248 이상 알파를 불투명으로 정규화하고 해안 가장자리는 유지한다.
- 승인된 시안과 동일하게 야간 원화의 바다에 포함돼 있던 달·반사광은 새 바다에 합성하지 않는다.
- 일반 이미지 경로는 `ocean/home-{day,night}.png`, 타일 경로는 그 이미지를 자른 새 아틀라스를 쓴다.
- `tileset.json.coastlineMaskVersion: 1`은 바다가 제거된 아틀라스임을 나타낸다.
  필드가 없는 기존 캐시는 원래의 tilemap/nav/layout을 유지하고 렌더 단계에서 `home-mask.png`만
  적용한다. 새 아틀라스에는 추가 마스크 레이어가 없다. 원격 파일을 배포할 때는 새 mapVersion으로
  발행해야 하며 기존 immutable URL의 내용을 바꾸지 않는다.
- 타일 환경변수·이동 좌표·건물 배치·새 마을 미리보기는 바꾸지 않는다.

```sh
python3 -m venv .venv-tile-atlas
.venv-tile-atlas/bin/pip install -r scripts/requirements-tile-atlas.txt
.venv-tile-atlas/bin/python scripts/build-island-ocean.py
.venv-tile-atlas/bin/python scripts/build-tile-atlas.py
.venv-tile-atlas/bin/python scripts/build-island-ocean.py --check
.venv-tile-atlas/bin/python scripts/build-tile-atlas.py --check
.venv-tile-atlas/bin/python scripts/test-island-ocean.py
```

`requirements-tile-atlas.txt`의 Pillow·NumPy 버전을 사용한다. 원화 RGB 보존, 바다 투명화,
반복 경계의 색 차이, 타일 384개 내부 및 extrusion 링을 검사한다.

## 집중섬 (티켓 2327)

`focus-cutout.png`는 기존 `backgrounds/fishing-island/day.jpg`에서 바깥 바다만
투명하게 만든 컷아웃이다. 중앙 연못·물줄기·폭포·해변·독립 바위는 남긴다.
생성본 RGB는 사용하지 않고 홈과 같은 `terrain()`으로 원본 RGB와 알파만 합성한다.
`python scripts/build-focus-ocean.py`로 `ocean/focus-day.png`를 재생성하며
`--check`는 최신 픽셀 및 연못·폭포·육지·바위의 불투명도와 바다 투명도를 검사한다.

집중섬은 기존 주간 전용 이미지 렌더러를 유지한다. 홈의 공통 `IslandOcean`을
`left`, `top`, `size / 1536` 배율로 연결하며 자리·낚시 좌표는 바꾸지 않는다.

컷아웃 생성 요청의 핵심: 원본 1536×1024 위치·크기를 유지하고 외부 바다만 제거한다.
중앙 연못과 물줄기·폭포·폭포 아래 거품, 모든 육지·나무·모래·해안 거품·독립 바위는
불투명하게 남긴다. 생성본의 색이나 디테일 변경은 최종 합성에 사용하지 않는다.

## 집중섬 이동 격자 (티켓 2516)

`src/constants/fishing-island.json`(50×50)의 칸 값은 `'0'` 물 · `'1'` 걸을 수 있는 땅 ·
`'2'` 나무·바위처럼 못 가는 땅이다. 고양이 걷기와 앉기는 `'1'`만, 낚싯줄은 `'0'`으로만 던지고,
물고기 더미는 `'0'`만 피한다(`'2'`에는 걸쳐도 된다).

`'2'`는 `python scripts/build-focus-mask.py`가 `ocean/focus-day.png`에서 뽑는다. 진한 윤곽선 안쪽을
벽으로 보고 잔디·모래 바닥만 한 덩어리로 이은 뒤, 바닥이 절반 미만인 칸을 막는다. 물 칸은 JSON 그대로 둔다.
자동 결과를 손으로 고친 칸은 `focus-mask-overrides.json`에 `[열, 행]`으로 적는다. `--check`는 다시 뽑은
결과가 지금 JSON과 같은지 검사한다. 그림을 바꾸면 격자를 그림 위에 겹쳐 다시 검수하고 overrides를 고친다.
