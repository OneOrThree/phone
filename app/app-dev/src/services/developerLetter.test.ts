import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DeveloperNotice } from '@/services/api/developerNotices';
import {
  decideLetter,
  isLetterReady,
  letterSeenKey,
  readLetterSeen,
  visibleAt,
  writeLetterSeen,
} from './developerLetter';

const n = (id: string, published: string, starts = published, extra = {}): DeveloperNotice => ({
  publicationId: id,
  title: id,
  body: 'b',
  startsAt: starts,
  endsAt: null,
  publishedAt: published,
  ...extra,
});
const T = (s: string) => Date.parse(s);

describe('decideLetter', () => {
  it('키 없음 + 공지 있음: 최신 visibleAt 만 저장하고 띄우지 않는다', () => {
    const items = [n('a', '2026-10-01T00:00:00Z'), n('b', '2026-10-05T00:00:00Z')];
    expect(decideLetter(items, null)).toEqual({ save: T('2026-10-05T00:00:00Z') });
  });
  it('키 없음 + 공지 없음: 0 을 저장한다', () => {
    expect(decideLetter([], null)).toEqual({ save: 0 });
  });
  it('여럿이면 visibleAt 최대 1건만 띄운다', () => {
    const items = [
      n('a', '2026-10-02T00:00:00Z'),
      n('b', '2026-10-04T00:00:00Z'),
      n('c', '2026-10-03T00:00:00Z'),
    ];
    expect(decideLetter(items, T('2026-10-01T00:00:00Z'))).toEqual({ show: items[1] });
    // 닫은 뒤(저장=b) 더 오래된 공지는 다시 안 뜬다
    expect(decideLetter(items, visibleAt(items[1]))).toBeNull();
  });
  it('예약 게시: publishedAt 이 앞서도 startsAt 이 뒤면 startsAt 으로 비교한다', () => {
    const scheduled = n('s', '2026-10-01T00:00:00Z', '2026-10-10T00:00:00Z');
    expect(visibleAt(scheduled)).toBe(T('2026-10-10T00:00:00Z'));
    expect(decideLetter([scheduled], T('2026-10-05T00:00:00Z'))).toEqual({ show: scheduled });
  });
  it('forcesUpdate 만 있으면 표시도 저장도 없다', () => {
    const force = n('f', '2026-10-09T00:00:00Z', undefined, { forcesUpdate: true });
    expect(decideLetter([force], T('2026-10-01T00:00:00Z'))).toBeNull();
  });
  it('forcesUpdate 가 섞이면 그 공지를 건너뛰고 일반 공지를 띄운다', () => {
    const force = n('f', '2026-10-09T00:00:00Z', undefined, { forcesUpdate: true });
    const patch = n('p', '2026-10-08T00:00:00Z');
    expect(decideLetter([force, patch], T('2026-10-01T00:00:00Z'))).toEqual({ show: patch });
  });
});

describe('저장소', () => {
  beforeEach(() => AsyncStorage.clear());
  it('계정별 키에 epoch 문자열로 적고 읽는다', async () => {
    expect(await readLetterSeen('u/1')).toBeNull();
    await writeLetterSeen('u/1', 123);
    expect(await AsyncStorage.getItem('gromo:developer-letter-seen:v1:u%2F1')).toBe('123');
    expect(letterSeenKey('u/1')).toBe('gromo:developer-letter-seen:v1:u%2F1');
    expect(await readLetterSeen('u/1')).toBe(123);
    expect(await readLetterSeen('other')).toBeNull();
  });
});

describe('isLetterReady 게이트', () => {
  const ok = {
    loaded: true,
    review: false,
    demo: false,
    hasServerSession: true,
    appActive: true,
    route: 'home',
    islandHomeShown: true,
    session: false,
    inTutorial: false,
    tutorialExperience: false,
    onboardingStory: 'done' as const,
    visiting: false,
    modal: false,
    convUi: false,
    switchAsk: false,
    appContentHidden: false,
    walkRequest: false,
    sceneGuide: false,
    keyboardHeight: 0,
    incomingAppLink: false,
    openingInvitation: false,
  };
  it('기준 상태는 참이고 바다·옛 계정(undefined)도 참이다', () => {
    expect(isLetterReady(ok)).toBe(true);
    expect(isLetterReady({ ...ok, route: 'sea', islandHomeShown: false })).toBe(true);
    expect(isLetterReady({ ...ok, onboardingStory: undefined })).toBe(true);
  });
  it.each([
    ['loaded', { loaded: false }],
    ['REVIEW', { review: true }],
    ['DEMO', { demo: true }],
    ['hasServerSession', { hasServerSession: false }],
    ['appActive', { appActive: false }],
    ['route', { route: 'shop' }],
    ['홈 미표시', { islandHomeShown: false }],
    ['state.session', { session: true }],
    ['inTutorial', { inTutorial: true }],
    ['tutorialExperience', { tutorialExperience: true }],
    ['onboardingStory intro', { onboardingStory: 'intro' as const }],
    ['onboardingStory scope', { onboardingStory: 'scope' as const }],
    ['visitingIslandId', { visiting: true }],
    ['modal', { modal: true }],
    ['convUi', { convUi: true }],
    ['switchAsk', { switchAsk: true }],
    ['appContentHidden', { appContentHidden: true }],
    ['walkRequest', { walkRequest: true }],
    ['sceneGuide(회관·펠리컨 안내·배달)', { sceneGuide: true }],
    ['keyboard', { keyboardHeight: 300 }],
    ['incomingAppLink', { incomingAppLink: true }],
    ['openingInvitation', { openingInvitation: true }],
  ])('%s 하나만 깨져도 거짓', (_name, patch) => {
    expect(isLetterReady({ ...ok, ...patch })).toBe(false);
  });
});
