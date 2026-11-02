/**
 * GROMO-2159 — 집중 중 낚시섬의 내 고양이는 reduce 가 꺼져 있으면 움직인다.
 * FishingIsland.test.ts 는 파일 전체에서 CatSprite 를 목으로 바꿔 «reduce 가 true 로 굳어 스프라이트가 멎는» 결함을 못 잡는다.
 * 여기서는 실제 CatSprite 와 Animated(JS 드라이버로 관찰)를 그대로 쓰고, 지금 보이는 프레임을 읽는다.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { AppState, StyleSheet } from 'react-native';
import { cat } from '@/constants/assets';
import { observeAnimatedOnJsDriver } from '@/components/animatedJsDriver.testing';
import { SECONDS_PER_FISH } from '@/services/model';
import { DEFAULT_SPOT, FishingActor, castSpot } from '@/screens/focus/FishingIsland';

type View = Awaited<ReturnType<typeof render>>;

const mine = castSpot(DEFAULT_SPOT);
const actor = (seconds: number, reduce: boolean) => (
  <FishingActor
    spot={mine}
    size={640}
    sizeY={640 / 1.5}
    color="ginger"
    name="하늘이"
    me
    subject="수학"
    seconds={seconds}
    reduce={reduce}
  />
);
// 셀 레이어는 모두 깔려 있고 opacity 로 하나만 보인다
const shown = (view: View) => {
  const layers = view
    .getAllByTestId(/^fishing-actor-cat-frame-/)
    .filter((layer) => StyleSheet.flatten(layer.props.style).opacity > 0.5);
  expect(layers).toHaveLength(1);
  return layers[0];
};
const cell = (view: View) => Number(shown(view).props.testID.slice(-1));
const advance = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

const appState = AppState.currentState;
beforeEach(() => {
  jest.useFakeTimers();
  observeAnimatedOnJsDriver();
  // Jest 의 AppState 목은 currentState 가 함수라 앞에 있는 앱(active)을 따로 알려 줘야 reel 이 키 포즈로 돈다
  (AppState as any).currentState = 'active';
});
afterEach(() => {
  (AppState as any).currentState = appState;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('reduce 가 꺼져 있으면 대기 중 3.1초에 낚시 프레임이 바뀌고 다시 돌아온다', async () => {
  const view = await render(actor(0, false));
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/fishing-frame-0'));
  await advance(3_099);
  expect(cell(view)).toBe(0);
  await advance(1);
  expect(cell(view)).toBe(1);
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/fishing-frame-1'));
  await advance(160);
  expect(cell(view)).toBe(2);
  await advance(220);
  expect(cell(view)).toBe(3);
  await advance(160);
  expect(cell(view)).toBe(0);
  await view.unmount();
});

test('reduce 가 켜지면 12초가 지나도 첫 프레임에 멈춘다 (저장값이 true 로 굳으면 이 상태가 계속된다)', async () => {
  const view = await render(actor(0, true));
  await advance(12_000);
  expect(cell(view)).toBe(0);
  await view.unmount();
});

test('reduce 가 꺼져 있으면 seconds 가 60 에 닿을 때 reel 이 재생되고 2초 뒤 대기로 돌아간다', async () => {
  const view = await render(actor(SECONDS_PER_FISH - 1, false));
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/fishing-frame-0'));

  await view.rerender(actor(SECONDS_PER_FISH, false));
  await advance(0);
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/reel-frame-0'));
  const seen = [cell(view)];
  for (const hold of [456, 400, 267, 337]) {
    await advance(hold);
    seen.push(cell(view));
  }
  expect(seen).toEqual([0, 1, 2, 1, 3]);

  await advance(2_000);
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/fishing-frame-0'));
  await view.unmount();
});

test('reduce 가 켜지면 seconds 가 60 에 닿아도 reel 을 재생하지 않는다', async () => {
  const view = await render(actor(SECONDS_PER_FISH - 1, true));
  await view.rerender(actor(SECONDS_PER_FISH, true));
  await advance(1_000);
  expect(shown(view).props.source).toBe(cat('ginger', 'fishing/fishing-frame-0'));
  await view.unmount();
});
