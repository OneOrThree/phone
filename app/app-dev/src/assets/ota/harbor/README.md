# 출항·도착 분리 원화

2026-10-31 사용자 요청: 내 고양이 색을 반영하고 아이패드에서 영상 좌우가 비던 문제를 함께 해소한다.

- `ocean-camera.jpg`: 현재 사용하는 1254×1254 RGB 바다. 확대·축소할 때 반복 무늬가 두드러지지 않도록 대비를 낮춘 원화를 내장 `image_gen`으로 생성했다. 최대 카메라 배율을 포함한 픽셀 밀도로 반복하며, 맞닿는 변을 반전해 잇는다. 단순히 화면 전체로 늘리지 않는다.
- `ocean.jpg`: 첫 시안의 바다 원화. 현재 장면에서는 참조하지 않는다.
- `island-dock.png`: 1254×1254 RGBA. 고양이·뗏목 없는 섬/부두 원화. 최대 표시 620pt(2배율 아이패드에서 1240px). 폰은 짧은 변을 따라 더 작게 표시한다.
- 고양이 6색과 뗏목 전후 레이어는 기존 `characters/cat/<color>/idle.png`, `boats/raft/layers/`를 재사용한다.
- `pelican-flight-up.png`, `pelican-flight-down.png`: 펠리컨 날갯짓 두 자세, 각각 1254² RGBA. 기존 `characters/pelican/npc/idle.png`의 정체성을 참조해 내장 `image_gen`으로 만들고, 첫 자세의 몸·머리를 고정한 채 날개만 내려 두 번째 자세를 만들었다. 착지는 기존 NPC 원화를 재사용한다. 전체 프롬프트는 `pelican-flight-prompts.json`이다.
- 항해 중단 컷신은 최종 사용자 요청으로 제거했다. 펠리컨 배달은 1024² `boats/raft/day.png`와 `MAGAZINE_UI.cover`를 재사용한다. 황금 물고기는 사용자 요청대로 기존 MP4를 유지한다.
- `magazine-deck.png`: 배달 후 뗏목 위에 놓인 입체 잡지, 1254² RGBA. 기존 표지 그림을 참조해 내장 `image_gen`으로 만들었다. 긴 책등이 뗏목 판자와 같은 오른쪽 위 방향으로 놓이며 종이 단면·책등·접촉 그림자를 포함한다. 들고 있을 때는 기존 표지를 쓰고, 내려놓을 때 원근 투영을 맞춘 뒤 이 원화로 잇는다. 전체 프롬프트는 `magazine-deck-prompts.json`에 보관한다.
- 생성: 내장 `image_gen` 도구. 참조는 저장소의 `backgrounds/island/base/day.png`와 `props/dock/layers/back-day.png`. 섬의 외곽 여백을 보완한 최종본을 채택했다.
- 요청 크기는 2048²였지만 도구가 반환한 실제 크기는 두 이미지 모두 1254²다. 확대 보간으로 크기를 부풀리지 않았다. 바다 PNG는 JPEG 품질 92로 형식 변환했다.
- 재생·구도 정본: `screens/world/HarborCutscene.tsx`, `harborMotion.ts`, `componentTokens.harborCutscene`.

생성에 사용한 전체 프롬프트는 `prompts.json`과 카메라 보완판의 `camera-ocean-prompt.txt`에 보관한다. 기존 MP4는 앱 출항·도착에서는 더 이상 참조하지 않으며 비교 미리보기의 원본 패널에서 재생한다.
