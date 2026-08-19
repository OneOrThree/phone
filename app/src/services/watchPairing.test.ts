// GROMO-1598 — 워치 페어링 보급률 계측의 보고 규칙을 고정한다.
// 핵심 계약: 성공 시에만 watch_paired 속성을 만들고, 실패는 「모름」으로 남긴다(PRD §5).
import { NativeModules, Platform } from 'react-native';

import { setIdentityProps } from '@/services/analyticsEvents';
import { reportWatchPairing } from '@/services/watchPairing';

jest.mock('@/services/analyticsEvents', () => ({ setIdentityProps: jest.fn() }));

const mockedSetIdentityProps = setIdentityProps as jest.Mock;

describe('reportWatchPairing', () => {
  const getPairingStatus = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (NativeModules as Record<string, unknown>).WatchSessionModule = { getPairingStatus };
  });

  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).WatchSessionModule;
  });

  it('페어링된 워치가 있으면 watch_paired=true를 보고한다', async () => {
    getPairingStatus.mockResolvedValue({
      supported: true,
      paired: true,
      watchAppInstalled: false,
    });
    await reportWatchPairing();
    expect(mockedSetIdentityProps).toHaveBeenCalledWith({ watch_paired: true });
  });

  it('페어링이 없으면 watch_paired=false를 보고한다', async () => {
    getPairingStatus.mockResolvedValue({
      supported: true,
      paired: false,
      watchAppInstalled: false,
    });
    await reportWatchPairing();
    expect(mockedSetIdentityProps).toHaveBeenCalledWith({ watch_paired: false });
  });

  it('WCSession 미지원 기기는 false로 분모에 포함한다', async () => {
    getPairingStatus.mockResolvedValue({
      supported: false,
      paired: false,
      watchAppInstalled: false,
    });
    await reportWatchPairing();
    expect(mockedSetIdentityProps).toHaveBeenCalledWith({ watch_paired: false });
  });

  it('네이티브 실패(타임아웃 등)는 속성을 남기지 않는다 — false 오염 금지', async () => {
    getPairingStatus.mockRejectedValue(new Error('watch_session_timeout'));
    await expect(reportWatchPairing()).resolves.toBeUndefined();
    expect(mockedSetIdentityProps).not.toHaveBeenCalled();
  });

  it('iOS가 아니면 네이티브를 호출하지 않는다', async () => {
    const os = jest.replaceProperty(Platform, 'OS', 'android');
    try {
      await reportWatchPairing();
      expect(getPairingStatus).not.toHaveBeenCalled();
      expect(mockedSetIdentityProps).not.toHaveBeenCalled();
    } finally {
      os.restore();
    }
  });

  it('네이티브 모듈이 없으면 조용히 끝난다', async () => {
    delete (NativeModules as Record<string, unknown>).WatchSessionModule;
    await expect(reportWatchPairing()).resolves.toBeUndefined();
    expect(mockedSetIdentityProps).not.toHaveBeenCalled();
  });
});
