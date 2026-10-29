import { AppState } from 'react-native';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { InteriorScreen } from './BuildingInteriors';
import { getAssetRepository } from '@/services/assets/repository';
import { PackLease } from '@/services/assets/contracts';
jest.mock('@/services/assets/repository', () => ({ getAssetRepository: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
const lease = (version: string): PackLease => ({
  id: version,
  packId: 'interior-hall',
  version,
  assets: {
    background: {
      mediaType: 'image/png',
      uri: `file:///cache/${version}.png`,
      width: 1024,
      height: 1536,
    },
  },
  release: jest.fn(),
});
const scene = () => (
  <InteriorScreen
    buildingIndex={0}
    conceptIndex={0}
    width={402}
    height={874}
    reduceMotion
    hideArtifact
  />
);
afterEach(() => jest.clearAllMocks());
test('첫 대체 그림은 준비된 팩 전체로 전환하고 닫을 때 lease를 해제한다', async () => {
  const ready = lease('v1');
  let finish!: () => void;
  const ensure = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const repository = {
    acquirePack: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(ready),
    ensurePack: jest.fn(() => ensure),
  };
  jest.mocked(getAssetRepository).mockReturnValue(repository as any);
  const screen = await render(scene());
  const original = screen.getByTestId('interior-background-image').props.source;
  expect(original).not.toEqual({ uri: ready.assets.background.uri });
  await act(async () => {
    finish();
    await ensure;
  });
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: ready.assets.background.uri,
    }),
  );
  await screen.unmount();
  expect(ready.release).toHaveBeenCalledTimes(1);
});
test('이미 열린 화면은 ensure 완료에도 버전을 바꾸지 않는다', async () => {
  const existing = lease('v1');
  const repository = {
    acquirePack: jest.fn().mockResolvedValue(existing),
    ensurePack: jest.fn().mockResolvedValue({ status: 'ready', version: 'v2' }),
  };
  jest.mocked(getAssetRepository).mockReturnValue(repository as any);
  const screen = await render(scene());
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: existing.assets.background.uri,
    }),
  );
  expect(repository.acquirePack).toHaveBeenCalledTimes(1);
  await screen.unmount();
});
test('실제 RN Image 오류는 불량 기록 후 직전 팩으로 전환한다', async () => {
  const current = lease('v2'),
    previous = lease('v1');
  const repository = {
    acquirePack: jest.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(previous),
    ensurePack: jest.fn().mockResolvedValue({ status: 'ready' }),
    reportDecodeFailure: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(getAssetRepository).mockReturnValue(repository as any);
  const screen = await render(scene());
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: current.assets.background.uri,
    }),
  );
  await fireEvent(screen.getByTestId('interior-background-image'), 'error', {});
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: previous.assets.background.uri,
    }),
  );
  expect(repository.reportDecodeFailure).toHaveBeenCalledWith(current);
  expect(current.release).toHaveBeenCalled();
  await screen.unmount();
  expect(previous.release).toHaveBeenCalled();
});
test('native 기능이 없는 바이너리는 기존 번들 그림을 사용한다', async () => {
  jest.mocked(getAssetRepository).mockReturnValue(null);
  const screen = await render(scene());
  expect(screen.getByTestId('interior-background-image').props.source).toEqual(
    require('@/assets/interiors/hall-cute-v1.png'),
  );
  await screen.unmount();
});

test('복귀 동기화와 디코드 복구가 겹쳐도 교체된 lease를 모두 해제한다', async () => {
  const current = lease('broken'),
    foreground = lease('foreground'),
    recovered = lease('recovered');
  let finish!: () => void;
  const failure = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let onChange: (state: string) => void = () => {};
  const listener = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      onChange = callback as (state: string) => void;
      return { remove: jest.fn() };
    });
  const repository = {
    acquirePack: jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(foreground)
      .mockResolvedValueOnce(recovered),
    ensurePack: jest.fn().mockResolvedValue({ status: 'ready' }),
    reportDecodeFailure: jest.fn(() => failure),
  };
  jest.mocked(getAssetRepository).mockReturnValue(repository as any);
  const screen = await render(scene());
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: current.assets.background.uri,
    }),
  );
  await fireEvent(screen.getByTestId('interior-background-image'), 'error', {});
  await act(async () => onChange('active'));
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: foreground.assets.background.uri,
    }),
  );
  await act(async () => {
    finish();
    await failure;
  });
  await waitFor(() =>
    expect(screen.getByTestId('interior-background-image').props.source).toEqual({
      uri: recovered.assets.background.uri,
    }),
  );
  expect(foreground.release).toHaveBeenCalledTimes(1);
  await screen.unmount();
  expect(recovered.release).toHaveBeenCalledTimes(1);
  expect(current.release).toHaveBeenCalledTimes(1);
  listener.mockRestore();
});
