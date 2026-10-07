# GROMO-2059 편집 증거

## 웹 재현

Chrome 기반 Expo 웹 앱을 390×844 뷰포트에서 열고 가입 닉네임에 `가나다`를 입력했습니다. macOS 전체 선택(`⌘A`) 후 Backspace를 눌러 값이 빈 문자열로 유지되는지 확인하고, `abc`를 입력해 필드에 `abc`만 표시되는지 확인했습니다.

- 삭제 전: [web-before.png](web-before.png)
- 새 이름 입력 후: [web-after.png](web-after.png)
- 결과: 빈 입력 상태 유지, 새 값 `abc` 표시

## 자동 회귀 검사

- `src/screens/island/Screens.test.tsx`: 가입 편집에서 `수빈` → `수` → 빈 값 → `abc`, 빈 이름 제출 차단, `abc` 최종 저장
- `src/services/model.test.ts`: 빈 편집 값 반영과 새 이름 입력 시 닉네임 이력 보존

## iOS 재현

요청된 iPhone SE iOS 26.5 clone은 `GROMO-2059-SE3`로 생성했습니다. 이 실행에서는 동시 시뮬레이터 검증으로 CoreSimulator 명령이 응답하지 않아 iOS 상호작용 재현 및 캡처를 완료하지 못했습니다.
