// DeltaRow 컴포넌트 테스트(GROMO-946) — 증감 화살표·퍼센트·문구, lowerIsBetter 색 반전.
// 외부 의존이 없는 표시 전용 컴포넌트라 목 없이 렌더 결과만 검증한다.
import { render, screen } from '@testing-library/react-native';
import { DeltaRow } from './DeltaRow';
import { T } from '@/constants/theme';

describe('DeltaRow', () => {
  test('증가(▲) — 퍼센트·분량 표기, 클수록 좋은 지표면 성공색', async () => {
    await render(<DeltaRow label="집중" delta={30} base={60} lowerIsBetter={false} />);
    expect(screen.getByText('▲')).toHaveStyle({ color: T.successInk });
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText('00:30:00')).toBeOnTheScreen();
  });

  test('lowerIsBetter면 같은 증가도 경고색으로 반전', async () => {
    await render(<DeltaRow label="폰 사용" delta={30} base={60} lowerIsBetter />);
    expect(screen.getByText('▲')).toHaveStyle({ color: T.dangerInk });
  });

  test('감소(▼) — 줄어드는 게 좋은 지표면 성공색', async () => {
    await render(<DeltaRow label="폰 사용" delta={-45} base={90} lowerIsBetter />);
    expect(screen.getByText('▼')).toHaveStyle({ color: T.successInk });
    expect(screen.getByText('50%')).toBeOnTheScreen();
    expect(screen.getByText('00:45:00')).toBeOnTheScreen(); // 절대값 표기
  });

  test('변화 없음 — – 화살표·중립색·"변화 없어요"', async () => {
    await render(<DeltaRow label="집중" delta={0} base={60} lowerIsBetter={false} />);
    expect(screen.getByText('–')).toHaveStyle({ color: T.inkMuted });
    expect(screen.getByText('변화 없어요')).toBeOnTheScreen();
  });

  test('기준값 0이면 퍼센트 대신 –', async () => {
    await render(<DeltaRow label="집중" delta={30} base={0} lowerIsBetter={false} />);
    expect(screen.getByText('▲')).toBeOnTheScreen();
    expect(screen.getByText('–')).toBeOnTheScreen(); // pct 자리
  });
});
