// 과목 행의 피드백 정책 테스트 — "행 계열은 스케일 없이 사운드만, 햅틱 없음".
// 특히 행 안에 중첩된 액션 버튼(대표색 칩·⋮ 메뉴)은 부모 행의 onPressIn이 오지 않아
// 각자 사운드를 내야 한다. 리뷰에서 "버튼인데 무음"으로 지적된 지점이다.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DraggableSubjectRows } from './DraggableSubjectRows';
import type { Subject } from '../types';
import { playTapSound } from '@/utils/sound';
import { hapticLight, hapticMedium, hapticSelect } from '@/utils/haptics';

jest.mock('@/utils/sound', () => ({ playTapSound: jest.fn(), preloadTapSound: jest.fn() }));
jest.mock('@/utils/haptics', () => ({
  hapticLight: jest.fn(),
  hapticMedium: jest.fn(),
  hapticSelect: jest.fn(),
}));
// 네이티브 리퀴드 글래스는 jest에서 로드할 수 없다 — 선택 연출 스타일만 빈 값으로 고정
jest.mock('@/components/liquidGlass', () => ({ glassSlide: {}, glassPill: {} }));
// 컴포넌트가 useSafeAreaInsets를 직접 쓴다(GROMO-886 footer 인셋) — Provider 없이 렌더하는
// 테스트 관행(GroupScreen.test.tsx)대로 훅만 고정값으로 목킹한다.
jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = require('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
    useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }),
    SafeAreaView: RNView,
  };
});

const SUBJECTS: Subject[] = [{ id: 's1', name: '수학', accumulatedSeconds: 90, color: '#FFB4A2' }];

beforeEach(() => jest.clearAllMocks());

async function renderRows() {
  await render(
    <DraggableSubjectRows
      subjects={SUBJECTS}
      onReorder={jest.fn()}
      onPressRow={jest.fn()}
      onOpenColor={jest.fn()}
      onOpenMenu={jest.fn()}
    />,
  );
}

describe('DraggableSubjectRows', () => {
  test('행은 사운드만 낸다 — 같은 터치 영역이 롱프레스·드래그도 받아 햅틱은 주지 않는다', async () => {
    await renderRows();
    await fireEvent(screen.getByTestId('focus.subject.item.0'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
    expect(hapticLight).not.toHaveBeenCalled();
    expect(hapticMedium).not.toHaveBeenCalled();
    expect(hapticSelect).not.toHaveBeenCalled();
  });

  test('대표색 칩도 사운드를 낸다 — 중첩 터처블이라 부모 행 피드백이 오지 않는다', async () => {
    await renderRows();
    await fireEvent(screen.getByLabelText('수학 대표색 변경'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
  });

  test('⋮ 메뉴 버튼도 사운드를 낸다', async () => {
    await renderRows();
    await fireEvent(screen.getByLabelText('수학 메뉴'), 'pressIn');
    expect(playTapSound).toHaveBeenCalledTimes(1);
  });
});
