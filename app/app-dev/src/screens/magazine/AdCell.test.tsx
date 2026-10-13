// 잡지 칸 공용 렌더러(GROMO-2289) — 스티커 수만큼 그리기·모르는 재료 건너뛰기, 오른쪽 아래 corner 세 가지,
// 평균 집계 전, 칸 전체 접근성 이름, 섬 이름 표기(「…섬섬」 방지), 섬 그림 단계.
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { applyLocalePref } from '@/i18n';
import { ISLAND_STAGE_ART } from '@/constants/magazineAssets';
import { AdCell, AdCellData } from './AdCell';
import { islandTitle } from './islandTitle';

const cell = (over: Partial<AdCellData> = {}): AdCellData => ({
  name: '소다',
  buildingCount: 6,
  memberCount: 8,
  maxMembers: 15,
  averageFocusMinutesPerDay: 130,
  body: '같이 집중할 새 친구를 기다려요!',
  layout: {
    v: 1,
    frameId: 'mag.frame-catear',
    stickers: [
      { assetId: 'mag.cat-ginger-fish', x: 0.85, y: 0.2, scale: 0.2, rotation: -10 },
      { assetId: 'mag.heart', x: 0.9, y: 0.8, scale: 0.08, rotation: 0 },
    ],
    tape: { assetId: 'mag.tape-pink', x: 0.5, y: 0.04, rotation: -4 },
  },
  ...over,
});

afterEach(() => applyLocalePref('system'));

describe('AdCell', () => {
  it('스티커 수만큼 그리고, 이 앱이 모르는 재료(새 시즌)는 건너뛴다', async () => {
    const data = cell();
    data.layout.stickers.push({
      assetId: 'mag.season-2027',
      x: 0.5,
      y: 0.5,
      scale: 0.2,
      rotation: 0,
    });
    const screen = await render(<AdCell testID="c" width={300} cell={data} />);
    expect(screen.getAllByTestId('c-sticker')).toHaveLength(2);
    expect(screen.getByTestId('c-tape')).toBeTruthy();
  });

  it('모르는 틀도 기본 틀로 그려 죽지 않는다', async () => {
    const data = cell();
    data.layout.frameId = 'mag.frame-season-2027';
    const screen = await render(<AdCell testID="c" width={200} cell={data} />);
    expect(screen.getByTestId('c')).toBeTruthy();
  });

  it('칸 전체가 섬 이름·주민·평균·글을 한 번에 읽는다', async () => {
    const screen = await render(<AdCell width={300} cell={cell()} />);
    expect(
      screen.getByLabelText(
        '소다섬, 주민 8/15, 평균 2시간 10분, ‘같이 집중할 새 친구를 기다려요!’',
      ),
    ).toBeTruthy();
    expect(screen.getByText('주민 8/15 · 평균 2시간 10분')).toBeTruthy();
  });

  it('평균이 null 이면 0분이 아니라 「평균 집계 전」이다', async () => {
    const screen = await render(
      <AdCell width={300} cell={cell({ averageFocusMinutesPerDay: null })} />,
    );
    expect(screen.getByText('주민 8/15 · 평균 집계 전')).toBeTruthy();
  });

  it('corner 없음 — 동그라미도 배지도 없다(섬에서 본 잡지)', async () => {
    const screen = await render(<AdCell testID="c" width={300} cell={cell()} />);
    expect(screen.queryByTestId('c-scope')).toBeNull();
    expect(screen.queryByTestId('c-ours')).toBeNull();
  });

  it('corner scope — 망원경 동그라미 버튼이 따로 눌린다(바다판)', async () => {
    const onScope = jest.fn();
    const onPress = jest.fn();
    const screen = await render(
      <AdCell
        testID="c"
        width={300}
        cell={cell()}
        corner="scope"
        onScope={onScope}
        onPress={onPress}
      />,
    );
    await fireEvent.press(screen.getByLabelText('소다섬 망원경에 넣기'));
    expect(onScope).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('작은 칸에서도 망원경 버튼은 칸 안에 44pt 이상으로 눌린다(칸 밖 hitSlop 은 터치가 안 온다)', async () => {
    const screen = await render(<AdCell testID="c" width={150} cell={cell()} corner="scope" />);
    const style = StyleSheet.flatten(screen.getByTestId('c-scope').props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
    expect(style.right).toBe(0);
    expect(style.bottom).toBe(0);
  });

  it('corner ours — 「우리 섬이에요」 배지와 읽는 이름', async () => {
    const screen = await render(<AdCell testID="c" width={300} cell={cell()} corner="ours" />);
    // 배지는 장식이라 스크린리더에서 숨긴다 — 숨김 요소까지 찾아 본다
    expect(screen.getByTestId('c-ours', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByLabelText(/, 우리 섬이에요$/)).toBeTruthy();
  });

  it('누르기는 크게 보기, 길게 누르기·스크린리더 「신고하기」 동작은 신고', async () => {
    const onPress = jest.fn();
    const onReport = jest.fn();
    const screen = await render(
      <AdCell width={300} cell={cell()} onPress={onPress} onReport={onReport} />,
    );
    const target = screen.getByRole('button');
    await fireEvent.press(target);
    await fireEvent(target, 'longPress');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledTimes(1);
    expect(target.props.accessibilityActions).toEqual([{ name: 'report', label: '신고하기' }]);
    await fireEvent(target, 'accessibilityAction', { nativeEvent: { actionName: 'report' } });
    expect(onReport).toHaveBeenCalledTimes(2);
  });

  it('신고를 받지 않는 칸(쓰기 화면·망원경)에는 신고 동작이 없다', async () => {
    const screen = await render(<AdCell testID="c" width={300} cell={cell()} onPress={() => {}} />);
    expect(screen.getByRole('button').props.accessibilityActions).toBeUndefined();
  });

  it('섬 프로필은 건물 수에 맞는 섬 그림 단계(5~6 → s5)', async () => {
    const screen = await render(
      <AdCell testID="c" width={300} cell={cell({ buildingCount: 6 })} />,
    );
    expect(screen.getByTestId('c-island').props.source).toBe(ISLAND_STAGE_ART.s5);
  });
});

describe('islandTitle', () => {
  it('「섬」으로 끝나면 그대로, 아니면 붙인다', async () => {
    expect(islandTitle('바다섬')).toBe('바다섬');
    expect(islandTitle('바다')).toBe('바다섬');
    expect(islandTitle(' 소다 ')).toBe('소다섬');
  });
});
