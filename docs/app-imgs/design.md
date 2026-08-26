# gromo App Store 소개 이미지 디자인 문서

최종 수정: 2026-08-10  
최종 결과: `final-v2/`  
재생성 도구: `tools/render_store_images_v2.py`

기능별 v1 확장 결과: `features-v1/`  
기능별 재생성 도구: `tools/render_feature_images_v1.py`

기능별 카피 v2 결과: `features-v1-copy-v2/`  
카피 리뷰: `copy-review.md`

## 1. 목표

gromo의 `집중 기록 → 집중 세션 → 분석 → 성취 → 티어 성장` 경험을 다섯 장의 App Store 소개 이미지로 전달한다.

초안의 반복적인 `카피 + 정면 스크린샷 카드` 구조에서 벗어나, 성공한 생산성 앱에서 반복해서 보인 아래 연출을 적용했다.

- 여러 디바이스를 회전·중첩한 제품 콜라주
- 화면을 프레임 바깥으로 과감하게 자르는 대형 크롭
- 한 장마다 다른 장면 구성
- 넓은 카피 여백과 짧은 결과형 헤드라인
- 캐릭터와 실제 UI를 같은 세계 안에 배치

최종 이미지의 앱 UI는 실제 시뮬레이터 캡처다. UI 내용은 생성형 이미지로 다시 만들거나 변형하지 않았으며 리사이즈·회전·크롭만 적용했다.

## 2. 제출 규격

| 기기군 | 크기 | 경로 |
| --- | --- | --- |
| iPhone 6.9형 | `1290 × 2796` PNG | `final-v2/iphone/` |
| iPad 13형 | `2048 × 2732` PNG | `final-v2/ipad/` |

- 이미지 수: 기기군별 5장
- 색상 모드: RGB
- 알파 채널: 없음
- 개별 파일: 10MB 미만
- 검토용 시트: `final-v2/iphone-contact-sheet.jpg`, `final-v2/ipad-contact-sheet.jpg`

## 3. 스토리라인

| 순서 | 헤드라인 | 보조 카피 | 사용 화면 | 역할 |
| --- | --- | --- | --- | --- |
| 01 | 집중을 기록하고, 함께 성장하세요 | 집중하면 캐릭터와 티어가 함께 자라요 | 홈·집중·통계·티어 | 앱 전체 세계관 |
| 02 | 폰은 내려놓고, 집중만 남겨요 | 카운트업 · 카운트다운 · 뽀모도로 | 집중·홈 | 핵심 행동 |
| 03 | 쌓인 집중을, 한눈에 분석하세요 | 시간 · 과목 · 흐름을 보기 쉬운 기록으로 | 통계·홈·집중 완료 | 데이터 증거 |
| 04 | 끝낸 집중은, 눈에 보이는 성취로 | 기록 · 스트릭 · 비교가 다음 집중을 이어줘요 | 집중 완료·통계 | 즉시 보상 |
| 05 | 집중할수록, 더 높은 단계로 | 리그와 티어 보상으로 꾸준하게 | 티어·집중 | 장기 동기 |

## 4. 장별 구성

### 01 — 제품 콜라주

- 사용자가 제공한 레퍼런스처럼 네 개의 디바이스가 화면 하단과 양옆에서 진입한다.
- 홈·집중·통계·티어 화면을 한 번에 보여 앱의 기능 폭을 전달한다.
- 중앙 캐릭터가 분리된 화면들을 하나의 성장 경험으로 연결한다.
- 배경은 따뜻한 흰색에서 옅은 라일락으로 이어지는 최소한의 그라데이션이다.

### 02 — 몰입 장면

- 어두운 집중 화면을 가장 크게 확대하고 화면 밖으로 잘라 몰입감을 만든다.
- 홈 화면은 왼쪽 하단의 보조 디바이스로만 사용한다.
- 공부 중인 캐릭터와 인디고 동심원이 집중 상태를 강조한다.

### 03 — 분석 화면 팬 배열

- 통계 화면을 중앙 주인공으로 두고 홈과 집중 완료 화면을 양쪽 뒤에 배치한다.
- 세 화면의 각도를 다르게 해 기록이 쌓인다는 인상을 만든다.
- `오늘 3시간 14분` 보조 배지는 실제 화면에서 가장 중요한 수치를 확대한다.

### 04 — 완료와 스트릭

- 집중 완료 화면을 크게 두고 통계 화면을 뒤에 겹친다.
- 행복한 캐릭터와 체크 표시가 완료 감정을 강화한다.
- 연한 녹색 배경으로 앞 장의 분석적 인디고와 감정적으로 구분한다.

### 05 — 티어 성장

- 티어 화면과 집중 화면을 어두운 배경 위에 중첩한다.
- 실제 티어 배지 자산을 화면 주변 궤도에 배치해 단계 상승을 시각화한다.
- 금색 보조 카피와 링을 사용해 보상 장면으로 마무리한다.

## 5. 디자인 토큰

| 용도 | 값 |
| --- | --- |
| 브랜드 인디고 | `#5E6AD2` |
| 집중 배경 | `#15192D` → `#232A48` |
| 분석 배경 | `#F0EEFF` → `#DDE5FB` |
| 성취 배경 | `#F5FBF5` → `#DDEEE3` |
| 티어 배경 | `#181A2A` → `#2C2639` |
| 기본 본문 | `#171922` |
| 성취 포인트 | `#478E5D` |
| 티어 포인트 | `#EBC56C` |
| 서체 | Apple SD Gothic Neo |

## 6. 원본 자산

### 실제 앱 캡처

`captures/` 아래에 iPhone·iPad 각 5종이 있다.

- `home`: 캐릭터와 오늘 집중 요약
- `focus`: 진행 중인 집중 세션
- `stats`: 일간 통계와 과목별 기록
- `result`: 집중 완료·스트릭·비교
- `tier`: 티어 단계 또는 승급 화면

### 앱 자산

- `app/app-dev/src/assets/character_happy.png`
- `app/app-dev/src/assets/character_study.png`
- `app/app-dev/src/assets/tier_image/tier2.png` ~ `tier5.png`

### 조사 자료

- `references/reference-board.jpg`: 집중 앱 8종의 첫 3장 비교
- `references/composition-reference-board.jpg`: 생산성 앱 6종의 첫 5장 구성 비교
- `references/imagegen-composition-concept.png`: 다중 디바이스·조명 탐색 콘셉트
- `references/raw-v1/`: 1차 조사 개별 원본
- `references/raw-v2/`: 구성 중심 재조사 개별 원본과 iTunes 응답
- `research.md`: 조사 출처와 결론

## 7. 재생성

저장소 루트에서 실행한다.

```bash
python3 docs/app-imgs/tools/render_store_images_v2.py
```

생성 결과:

```text
docs/app-imgs/final-v2/
├── iphone/
│   ├── 01.png
│   ├── 02.png
│   ├── 03.png
│   ├── 04.png
│   └── 05.png
├── ipad/
│   ├── 01.png
│   ├── 02.png
│   ├── 03.png
│   ├── 04.png
│   └── 05.png
├── iphone-contact-sheet.jpg
└── ipad-contact-sheet.jpg
```

카피, 배경색, 화면 크기, 회전 각도와 좌표는 `render_store_images_v2.py`에서 수정한다.

## 8. 검수 기준

- 헤드라인이 App Store 축소 화면에서도 두 줄 이내로 읽히는가
- 첫 장만 봐도 집중·캐릭터·기록·티어가 연결되는가
- 실제 앱 UI의 텍스트와 수치가 왜곡되지 않았는가
- 각 장이 같은 템플릿처럼 보이지 않는가
- UI, 캐릭터, 디바이스 그림자 사이에 어색한 경계가 없는가
- iPhone·iPad 규격, RGB 모드, 파일 용량을 만족하는가

## 9. 기능별 v1 확장 — 그룹·챌린지·누끼

2026-08-10에 그룹, 챌린지, 누끼 기능을 각각 3장씩 추가했다. 사용자가 요청한 기존 v1 문법에 맞춰 모든 장을 `짧은 결과형 카피 + 정면 단일 화면`으로 통일했다. 실제 iPhone 15 Pro Max 앱 화면을 캡처했으며, UI 자체는 생성하거나 다시 그리지 않았다.

| 기능 | 순서 | 헤드라인 | 실제 화면 |
| --- | --- | --- | --- |
| 그룹 | 01 | 함께라면, 더 오래 집중해요 | 내 그룹 목록 |
| 그룹 | 02 | 우리의 집중을 한곳에서 | 공지·챌린지·멤버가 보이는 그룹방 |
| 그룹 | 03 | 우리만의 그룹을 바로 만들어요 | 그룹 생성 폼 |
| 챌린지 | 01 | 오늘의 목표를 함께 지켜요 | 멤버별 진행·달성 카드 |
| 챌린지 | 02 | 집중도, 사용시간도 챌린지로 | 시간대·목표 설정 시트 |
| 챌린지 | 03 | 코인을 걸면 몰입은 더 선명하게 | 참가비·적립금·참가자 내기 시트 |
| 누끼 | 01 | 내 물건이 캐릭터가 돼요 | 기본·커스텀 캐릭터 선택 |
| 누끼 | 02 | 사진 한 장이면 준비 끝 | 사진 선택·촬영 화면 |
| 누끼 | 03 | 배경은 지우고, 개성은 살리고 | 누끼 캐릭터 생성 완료 |

### 결과 경로

```text
docs/app-imgs/features-v1/
├── group/01-group-list.png ~ 03-group-create.png
├── challenge/01-challenge-progress.png ~ 03-challenge-bet.png
├── cutout/01-character-select.png ~ 03-cutout-ready.png
├── group-contact-sheet.jpg
├── challenge-contact-sheet.jpg
├── cutout-contact-sheet.jpg
└── all-contact-sheet.jpg
```

캡처 원본은 `captures/features/<기능>/`에 같은 이름으로 보관한다. 카피·배경색·스크린샷 위치는 `tools/render_feature_images_v1.py`에서 수정할 수 있다.

## 10. 기능별 카피 v2

기존 기능별 v1의 앱 UI와 구성은 유지하고, 설명형 문구를 감정·행동 중심 문구로 바꾼 추가 9장이다.

```text
docs/app-imgs/features-v1-copy-v2/
├── group/3장
├── challenge/3장
├── cutout/3장
├── group-contact-sheet.jpg
├── challenge-contact-sheet.jpg
├── cutout-contact-sheet.jpg
└── all-contact-sheet.jpg
```

재생성:

```bash
python3 docs/app-imgs/tools/render_feature_images_v1.py --variant copy-v2
```

기존 세트와의 비교 및 카피 결정 근거는 `copy-review.md`에 기록했다.
