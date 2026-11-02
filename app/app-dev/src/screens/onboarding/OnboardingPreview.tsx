import React, { useEffect, useReducer, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MotionContext } from '@/design-system/primitives';
import { LoginScreen } from '@/screens/LoginScreen';
import { SeaScreen } from '@/screens/sea/SeaScreen';
import { Telescope } from '@/screens/island/Telescope';
import { initialState, reducer, colors, type Route } from '@/services/model';
import type { TelescopeItem } from '@/services/api/telescope';
import { OnboardingFlow } from './OnboardingFlow';
import { applyLocalePref } from '@/i18n';
import { Btn, Txt } from '@/design-system/patterns';
import { primitiveTokens as p } from '@/design-system/tokens';

// ?onboarding 는 API·인증 저장소에 쓰지 않는 실제 RN 화면의 검토 진입점이다.
const destinations: TelescopeItem[] = ['별빛섬', '무인도', '별고래섬'].map((name, i) => ({
  islandId: `preview-${i}`,
  name,
  intro: '',
  memberCount: i === 1 ? 0 : i === 2 ? 10 : 1,
  buildingCount: i === 1 ? 0 : i === 2 ? 5 : 1,
  maxMembers: 10,
  approvalRequired: false,
  membershipStatus: 'none',
  slot: 'nearby',
  sailingMinutes: i === 2 ? 30 : 15,
  averageFocusMinutesPerDay: null,
  full: i === 2,
  arrivedBefore: false,
}));
export function OnboardingPreview() {
  const query =
    Platform.OS === 'web' ? new URLSearchParams(window.location.search).get('onboarding') : null;
  const scenario =
    query === 'uninhabited' || query === 'islands' || query === 'full' ? query : undefined;
  return <OnboardingPreviewScene scenario={scenario} />;
}
export function OnboardingPreviewScene({
  scenario,
}: {
  scenario?: 'uninhabited' | 'islands' | 'full';
}) {
  const items = destinations.filter((item) =>
    scenario === 'uninhabited'
      ? item.memberCount === 0
      : scenario === 'full'
        ? item.memberCount === 0 || item.full
        : true,
  );
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState());
  const [route, setRoute] = useState<Route>(scenario ? 'sea' : 'login');
  const [terms, setTerms] = useState(false);
  const [message, setMessage] = useState('');
  const [arrived, setArrived] = useState<string | null>(null);
  const onFirstVoyageArrival = (item: TelescopeItem) => setArrived(item.name);
  const [now, setNow] = useState(Date.now());
  const backOverride = useRef<(() => boolean) | null>(null);
  useEffect(() => {
    applyLocalePref('ko');
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const reset = (next: Route) => setRoute(next);
  const startSea = async (islandId: string) => {
    const session = {
      id: 'preview-session',
      islandId,
      subject: '',
      kind: 'sea' as const,
      status: 'active' as const,
      startedAt: Date.now(),
      syncedAt: Date.now(),
      seconds: 0,
      targetMinutes: items.find((i) => i.islandId === islandId)!.sailingMinutes,
    };
    dispatch({ type: 'SESSION_SYNC', session });
    return session;
  };
  const self = {
    userId: 'self',
    name: state.name,
    color: state.color,
    focusing: !!state.session,
    activeSeconds: 0,
    message,
  };
  return (
    <SafeAreaProvider>
      <MotionContext.Provider value={false}>
        <View style={{ flex: 1 }}>
          {arrived ? (
            <View
              testID="first-voyage-preview-arrived"
              style={{ flex: 1, justifyContent: 'center', padding: p.space[6], gap: p.space[4] }}
            >
              <Txt kind="h24">{arrived}에 도착했어요!</Txt>
              <Txt>첫 항해 체험 미리보기예요. 실제 앱에서는 섬으로 이어져요.</Txt>
              <Btn
                title="다시 보기"
                onPress={() => {
                  setArrived(null);
                  reset('telescope');
                }}
              />
            </View>
          ) : route === 'login' ? (
            <LoginScreen
              providers={['apple', 'google']}
              termsAccepted={terms}
              onTermsAcceptedChange={setTerms}
              onProviderPress={() => reset('character')}
              onGuestPress={() => reset('character')}
            />
          ) : route === 'telescope' ? (
            <Telescope
              previewItems={items}
              e={{
                state,
                dispatch,
                reset,
                backOverride,
                back: () => reset('sea'),
                focus: { startSea },
                onFirstVoyageArrival,
              }}
            />
          ) : route === 'character' ? (
            <OnboardingFlow
              previewItems={items}
              e={{
                state,
                now,
                dispatch,
                reset,
                backOverride,
                back: () => reset('login'),
                focus: {
                  startSea,
                },
                onFirstVoyageArrival,
              }}
            />
          ) : (
            <SeaScreen
              self={self}
              participants={colors.flatMap((color, i) => [
                {
                  userId: `peer-${i}`,
                  color,
                  name: ['두부', '호두', '콩이', '모카', '보리', '나비'][i],
                  focusing: true,
                  activeSeconds: 120 + i * 60,
                  message: '같이 집중해요',
                },
              ])}
              voyage={
                state.session
                  ? {
                      sessionId: state.session.id,
                      destinationId: state.session.islandId,
                      destinationName: items.find((i) => i.islandId === state.session?.islandId)!
                        .name,
                      subject: '',
                      activeSeconds: Math.max(
                        0,
                        Math.floor((now - state.session.startedAt) / 1000),
                      ),
                      requiredSeconds: (state.session.targetMinutes ?? 15) * 60,
                      canDisembark: false,
                    }
                  : null
              }
              result={null}
              onMessage={async (text) => setMessage(text)}
              onEmote={async () => {}}
              onTelescope={() => reset('telescope')}
              onFinish={async () => {
                dispatch({ type: 'SESSION_SYNC', session: null });
              }}
              onExplore={async () => {}}
            />
          )}
        </View>
      </MotionContext.Provider>
    </SafeAreaProvider>
  );
}
