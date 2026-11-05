import { openGoogleWebLogin } from './webGoogleLogin';

const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
let receive: (event: MessageEvent) => void;
let opened: URL;
const popup = { closed: false, close: jest.fn() };
const remove = jest.fn();

beforeEach(() => {
  jest.useFakeTimers();
  popup.closed = false;
  popup.close.mockClear();
  remove.mockClear();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { origin: 'https://try.oneorthree.world' },
      open: jest.fn((url: string) => {
        opened = new URL(url);
        return popup;
      }),
      addEventListener: (_type: string, listener: typeof receive) => {
        receive = listener;
      },
      removeEventListener: remove,
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    },
  });
});
afterEach(() => {
  jest.useRealTimers();
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
});

const reply = (overrides: object = {}, nonce?: string) => {
  const params = new URLSearchParams(opened.hash.slice(1));
  const credential =
    'header.' + btoa(JSON.stringify({ nonce: nonce ?? params.get('nonce') })) + '.signature';
  receive({
    origin: opened.origin,
    source: popup,
    data: {
      type: 'cattus-google-login',
      state: params.get('state'),
      credential,
    },
    ...overrides,
  } as unknown as MessageEvent);
  return credential;
};

test('열었던 팝업의 같은 출처·state·nonce 응답만 채택한다', async () => {
  const result = openGoogleWebLogin();
  reply({ origin: 'https://elsewhere.example' });
  reply({ source: {} });
  reply({ data: { type: 'cattus-google-login', state: 'wrong', credential: 'wrong' } });
  expect(popup.close).not.toHaveBeenCalled();
  const credential = reply();
  await expect(result).resolves.toBe(credential);
  expect(remove).toHaveBeenCalledWith('message', receive);
  expect(jest.getTimerCount()).toBe(0);
});

test('다른 로그인 시도의 nonce는 거절하고 자격을 반환하지 않는다', async () => {
  const result = openGoogleWebLogin();
  reply({}, 'different-attempt');
  await expect(result).rejects.toMatchObject({ code: 'CLIENT_LOGIN_RESPONSE_INVALID' });
});

test('팝업 닫기는 로그인 취소로 끝나고 재시도를 막지 않는다', async () => {
  const result = openGoogleWebLogin();
  popup.closed = true;
  jest.advanceTimersByTime(500);
  await expect(result).rejects.toMatchObject({ code: 'SIGN_IN_CANCELLED' });
  expect(jest.getTimerCount()).toBe(0);
});
