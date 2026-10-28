# gromo App Store 소개 이미지 레퍼런스 조사

조사일: 2026-08-09  
대상: 한국 App Store에서 노출 중인 집중·스크린타임·공부 타이머·성장형 앱

## 1. Apple 제출 규격

- 한 기기군당 스크린샷은 1~10장, PNG/JPEG, 알파 채널 없이 제출한다.
- iPhone 주력 세트는 `1290 × 2796`(세로)로 제작한다. iPhone 15/16/17 Pro Max용 6.9형 허용 규격이다.
- 현재 gromo는 `supportsTablet: true`이므로 iPad 세트도 필요하다. 13형 세트는 `2048 × 2732`(세로)로 제작한다.
- 출처: [Apple App Store Connect — Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)

## 2. 조사 대상

| 유형 | 앱 | 첫 3장의 전개 | gromo에 가져올 점 |
| --- | --- | --- | --- |
| 캐릭터 보상형 | [Focus Friend](https://apps.apple.com/kr/app/focus-friend-by-hank-green/id6742278016) | 집중 → 꾸미기 보상 → 앱 차단 | 캐릭터를 첫 장부터 주인공으로 두되, 보상 구조를 한 문장으로 이해시킨다. |
| RPG 성장형 | [Focus Hero](https://apps.apple.com/kr/app/focus-hero-%EC%8A%B5%EA%B4%80-%EB%AA%A9%ED%91%9C-%ED%82%A4%EC%9A%B0%EA%B8%B0-rpg/id6465700009) | 신뢰/평점 → 영웅과 집중 → 할 일·습관 | 기능 설명보다 “집중하면 성장한다”는 변화 서사를 앞세운다. |
| 캐릭터 기능형 | [Study Bunny](https://apps.apple.com/kr/app/study-bunny-focus-timer/id1478345385) | 캐릭터 소개 → 코인/상점 → 통계 | 타이머·보상·통계를 하나의 캐릭터 세계관으로 묶는다. |
| 소셜 약속형 | [Flora](https://apps.apple.com/kr/app/flora-green-focus/id1225155794) | 집중 나무 → 위젯 → 습관 기록 | 친구와 함께한다는 약속을 행동 유지 장치로 설명한다. |
| 감성 기능형 | [Forest](https://apps.apple.com/kr/app/forest-focus-for-productivity/id866450515) | 더 나은 시간 → 중독 완화 → 앱 차단 | 짧은 결과형 카피와 큰 실제 UI를 결합한다. |
| 결과·신뢰형 | [Opal](https://apps.apple.com/kr/app/opal-screen-time-control/id1497465230) | 방해 차단 → 삶의 결과 → 차단 화면 | 첫 장에 해결 약속을 명확히 말하고, 수치·수상·실제 화면으로 신뢰를 보강한다. |
| 소셜 집중형 | [Pogether](https://apps.apple.com/kr/app/%EC%A7%91%EC%A4%91-%ED%83%80%EC%9D%B4%EB%A8%B8-%EC%B9%9C%EA%B5%AC-pogether/id6738842916) | 함께 집중 → 함께하면 더 잘 집중 → 공부 시작 | 차별점이 소셜이면 첫 장부터 사람 관계와 장면을 보여준다. |
| 국내 기능형 | [열품타](https://apps.apple.com/kr/app/%EC%97%B4%ED%92%88%ED%83%80/id1441909643) | 기록/분석 → 과목 기록 → 함께 공부 | 한국 사용자에게 익숙한 기능형 문장과 실제 데이터를 활용한다. 다만 한 장에 정보가 과밀해지는 것은 피한다. |

원본 공개 스크린샷 24장은 Apple의 공개 iTunes Lookup 응답에서 내려받아 비교했다. 전체 첫 3장 비교는 [reference-board.jpg](./references/reference-board.jpg)에서 확인한다.

## 3. 반복해서 보인 패턴

### 첫 3장이 하나의 랜딩 페이지처럼 작동한다

1. 1장: 사용자가 얻는 변화 또는 앱의 가장 강한 세계관
2. 2장: 그 변화를 만드는 핵심 행동(집중 타이머·앱 차단)
3. 3장: 기록·보상·차단처럼 믿을 수 있는 구체 기능

기능을 메뉴 순서대로 나열한 앱보다, “왜 써야 하는가 → 어떻게 되는가 → 무엇이 남는가” 순서가 더 빨리 이해된다.

### 캐릭터형 앱은 캐릭터를 장식이 아니라 동기 구조로 쓴다

Focus Friend·Focus Hero·Study Bunny는 캐릭터를 화면 구석의 마스코트로만 두지 않는다. 집중을 시작하고, 보상을 얻고, 다시 돌아오게 만드는 이유로 설명한다. gromo도 캐릭터를 첫 장의 시각적 주인공으로 쓰되 “집중할수록 더 자란다”는 인과가 보여야 한다.

### 실제 UI 비중이 커야 신뢰가 생긴다

Forest·열품타는 실제 화면을 크게 노출하고, Opal은 연출 이미지 안에서도 핵심 UI를 읽을 수 있게 유지한다. gromo는 캐릭터 일러스트만으로 채우지 않고 실제 홈·집중·통계·리그 화면을 각 장의 55~70%에 배치한다.

### 카피는 짧고 결과형이어야 한다

- 한 장에 메시지 하나
- 제목은 2줄 이내, 한국어 기준 10~18자 안팎
- 부제는 기능명을 보충하는 한 줄
- “관리하세요”보다 “집중할수록 더 자라요”처럼 결과가 그려지는 문장

## 4. gromo에 맞는 방향

gromo의 차별점은 `집중 + 스크린타임 + 소셜 경쟁 + 캐릭터 보상`의 결합이다. 모든 기능을 첫 장에 넣지 않고, 캐릭터 성장형 감성을 중심에 두고 실제 기록과 소셜 기능으로 신뢰를 쌓는다.

### 비주얼 원칙

- 앱의 실제 인디고 `#5E6AD2`와 쿨 화이트를 기본으로 쓰고, 캐릭터가 따뜻하게 보이도록 크림·라일락 보조색을 더한다.
- 화면마다 배경색은 변주하되 큰 제목 위치, 화면 프레임 크기, 하단 브랜드 표식은 고정한다.
- 실제 앱 화면을 임의로 재설계하지 않는다. 시뮬레이터 캡처를 그대로 사용하고 마케팅 프레임만 합성한다.
- 첫 장은 캐릭터와 홈을 함께 보여 “감성 앱”과 “관리 앱”을 동시에 이해시킨다.
- 상태바·개인정보·개발용 오버레이가 없는 캡처만 사용한다.

## 5. 최종 5장 스토리라인

| 순서 | 헤드라인 | 보조 카피 | 대표 화면 | 역할 |
| --- | --- | --- | --- | --- |
| 01 | 집중할수록, 더 자라요 | 폰 사용을 줄이고 집중 습관을 키우는 gromo | 홈 + 캐릭터 | 변화/브랜드 약속 |
| 02 | 폰은 내려놓고, 몰입은 깊게 | 카운트업 · 카운트다운 · 뽀모도로 집중 | 집중 세션 | 핵심 행동 |
| 03 | 오늘의 변화를 한눈에 | 집중시간과 과목별 기록을 보기 쉽게 | 통계 | 기록/신뢰 |
| 04 | 작은 집중도 성취로 남아요 | 집중을 마칠 때마다 기록과 스트릭 확인 | 집중 완료 | 즉시 보상/성취 |
| 05 | 집중이 쌓이면, 레벨이 올라요 | 리그와 티어 보상으로 꾸준한 동기부여 | 티어/승급 | 장기 동기 |

## 6. 제작 범위

- iPhone 6.9형: `final/iphone/01~05.png` (`1290 × 2796`)
- iPad 13형: `final/ipad/01~05.png` (`2048 × 2732`)
- 검토용 한눈 보기: `final/iphone-contact-sheet.jpg`, `final/ipad-contact-sheet.jpg`
- 실제 시뮬레이터 원본: `captures/`
- 재생성 도구와 카피/색상 설정: `tools/render_store_images.py`

## 7. 구성 중심 재조사와 v2 방향 (2026-08-10)

초안은 실제 UI를 크게 보여주는 데는 성공했지만, 모든 장이 같은 `헤드라인 + 세로 화면 카드` 템플릿이라 광고적 인상과 장면 전환이 부족했다. 사용자가 제시한 레퍼런스처럼 여러 기기를 회전·중첩하고 화면을 프레임 밖으로 과감하게 잘라내는 연출을 중심으로 다시 조사했다.

### 추가 조사 대상

- [투두메이트](https://apps.apple.com/kr/app/%ED%88%AC%EB%91%90%EB%A9%94%EC%9D%B4%ED%8A%B8-todo-mate/id1505220130): 300만 사용자·평가 11만 개 규모. 장식을 줄이고 실제 UI의 색과 리듬을 전면에 둔다.
- [Structured](https://apps.apple.com/kr/app/structured-%EB%8D%B0%EC%9D%BC%EB%A6%AC-%ED%94%8C%EB%9E%98%EB%84%88/id1499198946): 한 장에 한 기능만 남기고 화면을 크게 기울이거나 크롭한다.
- [Finch](https://apps.apple.com/us/app/finch-self-care-pet/id1528595748): 캐릭터를 제품 화면과 같은 비중으로 사용해 기능보다 감정적 보상을 먼저 전달한다.
- [ScreenZen](https://apps.apple.com/us/app/screenzen-screen-time-control/id1541027222): 강한 배경색, 짧은 결과형 카피, 비스듬한 다중 화면으로 설치 전에도 사용 장면을 이해시킨다.
- [터닝](https://apps.apple.com/kr/app/turning-screen-time-routine/id6449270376): 문제 상황과 수치를 먼저 말하고 실제 차단·집중 화면으로 증명한다.
- [Opal](https://apps.apple.com/kr/app/opal-screen-time-control/id1497465230): 넓은 여백과 프리미엄 오브젝트, 과감한 디바이스 크롭으로 일반 기능 설명보다 광고에 가깝게 연출한다.

전체 첫 5장 비교는 [composition-reference-board.jpg](./references/composition-reference-board.jpg)에서 확인한다. 첨부 레퍼런스를 바탕으로 ImageGen에서 탐색한 조명·디바이스 팬 배열은 [imagegen-composition-concept.png](./references/imagegen-composition-concept.png)에 보관했다. 생성 콘셉트의 가짜 화면은 사용하지 않고, 최종본에는 실제 gromo 캡처만 합성했다.

### v2 구성 원칙

1. 첫 장은 홈·집중·통계·티어 화면 네 개를 회전·중첩해 앱의 전체 세계관을 한 장에 보여준다.
2. 둘째 장부터는 같은 프레임을 반복하지 않고 대형 단일 크롭, 세 화면 팬 배열, 완료 화면 중첩, 티어 배지 궤도처럼 장면을 전환한다.
3. 디바이스는 프레임 안에 얌전히 넣지 않고 화면 가장자리 밖으로 잘라 속도감과 스케일을 만든다.
4. 캐릭터는 단순 장식이 아니라 `집중 중 → 완료 → 성장`의 감정선을 연결한다.
5. 실제 앱 UI는 리사이즈·회전·크롭만 허용하고 내용은 재생성하거나 변형하지 않는다.

### v2 결과물

- iPhone 6.9형: `final-v2/iphone/01~05.png` (`1290 × 2796`)
- iPad 13형: `final-v2/ipad/01~05.png` (`2048 × 2732`)
- 검토용: `final-v2/iphone-contact-sheet.jpg`, `final-v2/ipad-contact-sheet.jpg`
- 재생성: `tools/render_store_images_v2.py`
