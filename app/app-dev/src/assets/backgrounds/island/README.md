# 같이숲 공유 마을섬 · 확정 6번

2026-09-15부터 `island-final-6/enhanced/`를 제품 아트 정본으로 사용한다.

- 캔버스: 1536 × 1024
- `base/`: 건물 없는 낮·밤 섬
- 건설 단계 그림 `growth/`는 읽는 곳이 없어 지웠다(GROMO-2907).
- `layers/`: 확정 좌표에 놓인 시설별 1536 × 1024 투명 레이어. 앱은 직접 쓰지 않고, `scripts/build-facility-crops.py`가 시설 rect 로 자른 `village-world/facility/`(그림·외곽선 마스크·지형 시설)를 쓴다(GROMO-2378, 디코드 메모리)
- `placement.json`: 시설별 배치 좌표
- 모닥불은 배경에 포함되어 `campfire-on.png`는 호환용 빈 레이어다.
- 집중섬(`../fishing-island`)은 이 교체 대상이 아니다.
