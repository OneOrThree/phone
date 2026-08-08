// 컴포넌트 테스트 공용 render 헬퍼(GROMO-946) — App.tsx와 같은 순서(Focus › Subject)로
// Provider를 감싸 렌더한다. Context 훅(useFocus/useSubjects)을 쓰는 컴포넌트 테스트에 사용.
//
// ⚠️ 두 Provider는 마운트 시 AsyncStorage(jest.setup의 메모리 목)와 서버 복원
// fetchTodayFocusRestore를 부른다. jest.mock은 테스트 파일에서만 호이스팅되므로,
// 이 헬퍼를 쓰는 테스트 파일은 반드시 아래를 선언할 것:
//   jest.mock('@/screens/focus/focusRestore', () => ({
//     fetchTodayFocusRestore: jest.fn().mockResolvedValue({ sessions: null, tags: null }),
//     sessionFocusSeconds: jest.fn(() => 0),
//     sessionTodayFocusSeconds: jest.fn(() => 0),
//   }));
import type { ReactElement } from 'react';
import { render } from '@testing-library/react-native';
import { FocusProvider } from '@/store/FocusContext';
import { SubjectProvider } from '@/store/SubjectContext';

export function renderWithProviders(ui: ReactElement) {
  return render(
    <FocusProvider>
      <SubjectProvider>{ui}</SubjectProvider>
    </FocusProvider>,
  );
}
