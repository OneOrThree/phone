# GROMO 앱 디자인 시스템

`app/app-dev/.docs/project-context/ui-kit/`의 HTML UI kit을 React Native에서 재사용할 수
있도록 옮긴 앱 코드 정본이다. HTML·CSS 원본은 디자인 참고와 비교용이고, 앱 화면에서는 이
폴더의 토큰과 컴포넌트를 사용한다.

## 구조

- `tokens.ts`: primitive → semantic → component의 3단계 토큰과 기존 `C.*` 호환 별칭
- `typography.tsx`: 기기 크기에 대응하는 `Text`, `TextInput`
- `primitives.tsx`: `Button`, `Card`, `Field`, `Progress` 등 기본 UI
- `patterns.tsx`: `Page`, `Overlay`, `Row`, `Wheel` 등 앱 조합 패턴

## 사용 기준

- 새 색·간격·크기는 `tokens.ts`에 목적을 정의한 뒤 사용한다.
- 작은 범용 UI는 `primitives.tsx`, 화면 구조를 포함하는 조합은 `patterns.tsx`에 둔다.
- 특정 화면에서만 쓰는 컴포넌트는 해당 `screens/<feature>/`에 둔다.
- `.docs`의 HTML/CSS 파일을 런타임 코드에서 직접 참조하지 않는다.
- `C.*`는 기존 화면 호환용이다. 새 코드는 `semanticTokens` 또는 `componentTokens`를 우선한다.
