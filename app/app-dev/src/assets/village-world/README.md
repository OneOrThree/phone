# 타일 마을 · 개발 미리보기 에셋

출처: OneOrThree/planning-document의 `assets/village-world/export/`.
기획 시연 `village-world.html`에서 확정한 배치를 `scripts/export-village-world.cjs`로 내보내고 이 폴더에 복사한다.

- `map.json`: 1536×1024 좌표, 소품 109개, 시설별 문, 통행 폴리곤과 32px 길 데이터.
- `terrain.png`: 조각을 합친 빈 지형. 타일마다 별도 네이티브 뷰를 생성하지 않는다.
- `road-*.png`: 투명 길 레이어. `map.json`의 잘라낸 영역 좌표에 그린다.
- 나머지 PNG: 투명 소품·건물·부두·다리. 발밑 중심을 배치 기준으로 사용한다.

실행: 개발 빌드의 마을에서 **새 마을 미리보기** 버튼. 웹은 `?demo=1&village=layered`로 바로 연다.
명시적인 QA 빌드는 `EXPO_PUBLIC_VILLAGE_PREVIEW=1`로 활성화할 수 있다. 일반 배포 기본값은 기존 마을이다.

기존 화면의 카메라·건물 진입·권한·건설 HUD를 재사용한다. 시설별 표시와 충돌은 실제 건설 상태를 따른다.
캐릭터 이동 비용은 길 0.8, 잔디 2.7. 나무와 시설은 발밑 좌표로 고양이 앞뒤에 그린다.
모션 감소 설정과 앱 비활성 상태에서는 자연 소품 모션을 중지한다.

이 단계에는 사용자 배치 편집·저장 기능과 새 밤 원화를 포함하지 않는다. 최종 미술과 실기기 성능은 검토 대상이다.

## 검증과 갱신

내보내기 폴더를 복사한 뒤 `npx prettier --write src/assets/village-world/map.json`을 실행한다.
JSON 포맷은 달라도 기획 원본과 데이터는 같아야 한다. PNG는 동일한 파일을 사용한다.

- `src/utils/village-world.test.ts`: 시설별 그림·샛길·충돌, 모든 문·부두·다리 경로와 대각선 모서리 통과 방지.
- Expo 웹 서버 실행 후 `node scripts/review-village-world.cjs`: 세로·가로 전환, 시설 탭/이동/진입, 건설 단계, 기존 화면 기본값 검사. 서버 주소는 `GROMO_REVIEW_URL`로 지정한다.
- 2026-09-23: Jest 59개 묶음/741개 테스트, 타입/포맷/팔레트 검사, ESLint 오류 0개, 3개 플랫폼 JS 번들 생성 통과. 웹 시각·동작 검사 통과, 실기기 성능은 미검증.
- 현재 앱의 `TESTFLIGHT_ALL_BUILDINGS` 정책 때문에 내 섬은 모든 건물을 완성한다. 일부 시설 렌더링은 구경할 섬에서 확인한다.

### 2026-09-23 흙길 보정 (surface 5)

사용자 요청으로 길 바탕을 밝게 하고 2~4px 자갈을 드문드문 섞었다.
길의 불투명 표면 평균 밝기(8비트 가중 RGB)는 201.04 → 214.49.
배치와 통행 데이터는 유지하며, 길 PNG 8개와 표면 메타데이터를 기획 원본에서 다시 내보냈다.
세로·가로 앱 화면, 시설 진입과 경로 검사 통과.

### 2026-09-29 건설 밤 아틀라스

- `construction/*-atlas-night.png`: 낮 아틀라스와 같은 픽셀 크기·격자의 밤 리라이트(이미지 생성 style transfer). 낮 아틀라스 실루엣에서 먼 픽셀은 투명 처리해 옆 셀이 viewport에 비치지 않게 했다.
- `ConstructionBuildingSprite`의 `night` prop 이 밤 셀을 고른다. 밤에는 작업 진동·효과를 재생하지 않으므로 `effects-atlas-night.png`는 런타임에서 참조하지 않는다.
- 웹 미리보기: `?construction-motion` 에서 낮·밤과 공사 단계를 전환해 확인한다.

### 2026-09-29 건물 밤 모션 프레임 (GROMO-2154)

- `motion/{hall,library,observatory,shop}/night-frame-0~3.png`: 낮 frame-0~3과 같은 크기·발밑 기준점.
  night-frame-0은 `backgrounds/island/layers/night/<건물>.png`를 `placement.json` rect로 무손실 crop한 것이다.
  1~3은 night-frame-0 위에 움직이는 부위(문·망원경·강아지)만 낮 프레임에서 밤 톤으로 변환해 합성한다.
- 회관·도서관·전망대·상점 모션 컴포넌트는 `night` prop 으로 밤 프레임을 재생한다. 밤 마을에서도 이 네 건물은
  정지 밤 레이어 대신 모션 프레임이 그리며, 게시판·우편함·축음기는 기존 밤 레이어를 쓴다.
- 재생성: `python3 -m pip install -r scripts/requirements-night-motion.txt` 후
  `python3 scripts/generate-night-village-motion.py` (건설 밤 아틀라스까지 다시 만들 때만 `--atlas-source`).
- `WorldMap`은 네 모션을 `placement.json` rect 좌표에 그린다. 밤 프레임도 같은 rect로 잘라 정지 밤 레이어와 픽셀 위치가 같다.

### 타일 지형 (10/9) — 에셋·재생성(GROMO-2229)

- `v1/`: `terrain.png` 를 Lanczos 2배로 올려 128px 로 자른 `tileset@2x.png` 아틀라스와 `tileset.json`·`tilemap.json`·`nav.json`·`objects.json`. 아틀라스·타일맵은 `npm run gen:tile-atlas` 로 만들고 `npm run gen:tile-atlas:check` 가 최신 여부를 검증한다.
- 재생성 환경: `python3 -m venv .venv-tile-atlas` 로 **별도 venv** 를 만들어 `scripts/requirements-tile-atlas.txt`(pillow 12.2.0·numpy 2.4.4)를 설치한다. `requirements-night-motion.txt`(pillow 11.3.0·numpy 2.5.1)와는 버전이 달라 한 venv 에 공존할 수 없다. 아틀라스 픽셀이 pillow 구현에 의존하므로 버전은 고정이 재현성이다.
- `tilemap.json` 의 `terrain-detail`·`roads` 는 `data: []` 다. Tiled 규격상 비표준(원래 길이 384 의 0 배열)이며, 로더(`TileTerrainCanvas`)가 `[]` 를 빈 레이어로 다룬다는 전제다.

### 타일 지형 (10/9) — 렌더러(GROMO-2230)

- `EXPO_PUBLIC_TILE_ISLAND=1`(iOS·Android) 이면 새 마을의 지형 `terrain.png` 한 장 대신 `v1/tileset@2x.png` 384 조각을 `TileTerrainCanvas`(Skia `<Atlas>`, 드로우콜 1)로 그린다. 웹은 플래그를 무시하고 기존 Image.
- 배열은 `v1/tilemap.json` terrain 레이어 + `v1/tileset.json`(margin 1·spacing 2·31열·scale 2)에서 한 번 만든다. 목적지는 1x 이미지 좌표(64px 격자)라 기존 카메라 투영(`base·z`)을 Group transform 하나로 그대로 쓴다.
- 소품·건물은 지금처럼 `VillageScenery` 가 그린다. 한 캔버스로 합치기·Reanimated 카메라는 실기기 프레임 측정(p95 ≤ 16.7ms) 뒤 다음 단계.
- 서버 배치(`/screens/home` 의 `layout.buildings[].cell`)가 오면 `applyLayout` 이 건물 발밑을 셀 중심 px 로 덮어쓴다. 없으면 `map.json` 그대로.
