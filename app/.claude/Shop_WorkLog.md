# Shop WorkLog — 상점 기능

---

## 📌 현재 상태

**MVP 범위에서 상점 기능 제외** — 화면에서 숨겼으나 코드는 전부 보존됨.

---

## 🗂️ 관련 파일

| 파일                           | 역할                                |
| ------------------------------ | ----------------------------------- |
| `screens/ShopScreen.js`        | 상점 화면 (코드 보존, 미노출)       |
| `components/MorphingTabBar.js` | 탭바 항목 정의                      |
| `App.js`                       | 네비게이터 등록                     |
| `contexts/CoinContext.js`      | 코인/보유 아이템 상태 (상점과 연동) |
| `contexts/EquipmentContext.js` | 장착 아이템 상태                    |

---

## ✅ 적용한 변경사항 (2026-06-18)

### 목적

MVP 범위에 상점이 포함되지 않아 앱에서 보이지 않게 처리.
삭제하지 않고 숨겨서 나중에 쉽게 복원 가능하도록 함.

### 변경 내용

**`components/MorphingTabBar.js`**

- `TABS` 배열에서 `{ name: '상점', icon: '🛍' }` 제거
- 탭이 홈 / 그룹 / 마이페이지 3개로 재배치됨 (N, TAB_W 자동 반영)

**`App.js`**

- `ShopScreen` import 및 `<Tab.Screen name="상점" />` 등록 유지
- `options={{ tabBarButton: () => null }}` 추가하여 탭 버튼 비노출

---

## 🔁 복원 방법

상점을 다시 보이게 하려면 아래 두 가지 되돌리기:

1. `MorphingTabBar.js` — `TABS` 배열에 `{ name: '상점', icon: '🛍' }` 다시 추가 (그룹과 마이페이지 사이)
2. `App.js` — `options={{ tabBarButton: () => null }}` 제거

---

## 📋 상점 기능 구현 현황 (숨기기 전 기준)

- [x] `ShopScreen.js` — 상점 UI 화면
- [x] `CoinContext.js` — 코인 수, 보유 아이템 상태 관리 (AsyncStorage `gromo:coins`, `gromo:ownedItems`)
- [x] `EquipmentContext.js` — 장착 아이템 상태 관리 (AsyncStorage `gromo:equipment`)
- [ ] 상점 API 연동 — 백엔드 미구현 (미완)
- [ ] 아이템 구매 플로우 — 미완

---

## ⚠️ 주의사항

- `CoinContext` / `EquipmentContext`는 홈화면 캐릭터 꾸미기에도 쓰이므로 상점과 무관하게 유지됨
- 상점 탭을 숨겨도 코인/장착 상태는 계속 동작함
