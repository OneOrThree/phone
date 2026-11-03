import type { ScreenEnvironment } from '@/navigation/ScreenEnvironment';
import { Route, State } from '@/services/model';
import { useAppLayout } from '@/utils/layout';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { InteriorScreen } from './InteriorScreen';
import { NavScale } from './shared/NavScale';
import { useInteriorFonts } from './shared/styles';

export function InteriorRoute({
  e,
  modalAboveBoard = false,
}: {
  e: ScreenEnvironment;
  modalAboveBoard?: boolean;
}) {
  const [fontsLoaded, fontError] = useInteriorFonts();
  const layout = useAppLayout();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const r: Route = e.route;
  const mail = r === 'mail' || r === 'friendMail';
  const friend = (e.state as State).friends?.some(
    (f) => f.id === e.detail && f.status === 'friend',
  );
  // 우체통 시안 번호: 0 열린 우체통 · 1 받은 편지 · 2 편지 상세 · 3 친구 선택 · 4 편지 쓰기.
  // 섬 채팅방은 우체통 밖 섬 홈 위 시트다(IslandChatSheet, GROMO-2499·2500)
  const conceptIndex = !mail
    ? 0
    : r === 'friendMail'
      ? friend
        ? 4
        : 3
      : e.detail
        ? 2
        : e.tab === '받은 편지'
          ? 1
          : 0;
  const width = size?.width ?? layout.width,
    height = size?.height ?? layout.height;
  // 우체통은 316×686 폰 시안 크기로 그린 뒤 더 큰 화면에서는 통째로 키운다 (작아지지는 않는다)
  // 배율은 창 크기로 정해 키보드가 올라와 높이가 줄어도 글자 크기가 바뀌지 않게 한다
  const k = mail ? Math.max(1, Math.min(layout.width / 316, layout.height / 686)) : 1;
  return (
    <View
      style={{ flex: 1, overflow: 'hidden' }}
      onLayout={(event) => {
        const { width: w, height: h } = event.nativeEvent.layout;
        setSize({ width: w, height: h });
      }}
    >
      {/* 글꼴을 못 불러와도 기본 글꼴로 계속 그린다 */}
      {(fontsLoaded || fontError) && (
        <View style={{ transformOrigin: 'left top', transform: [{ scale: k }] }}>
          <NavScale.Provider value={1 / k}>
            <InteriorScreen
              buildingIndex={mail ? 3 : 1}
              conceptIndex={conceptIndex}
              width={width / k}
              height={height / k}
              reduceMotion={e.state.settings.reduceMotion}
              e={e}
              insets={{
                top: layout.insets.top / k,
                left: layout.insets.left / k,
                right: layout.insets.right / k,
              }}
              sceneHeight={Math.max(height, layout.height) / k}
              higherModalOpen={modalAboveBoard}
            />
          </NavScale.Provider>
        </View>
      )}
    </View>
  );
}

// 웹 비교용 화면: /?interiors=1&b=건물&c=시안&w=폭&h=높이[&noartifact=1]
export function InteriorsReview() {
  const q = new URLSearchParams(window.location.search);
  const [fontsLoaded] = useInteriorFonts();
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  useEffect(() => {
    document.documentElement.lang = 'ko';
    if (!fontsLoaded) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => ((window as any).__interiorsReady = true)),
    );
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;
  const w = Number(q.get('w') || 402),
    h = Number(q.get('h') || 874);
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        backgroundColor: '#fff',
      }}
    >
      <InteriorScreen
        buildingIndex={Number(q.get('b') || 0)}
        conceptIndex={Number(q.get('c') || 0)}
        width={w}
        height={h}
        reduceMotion={reduceMotion}
        hideArtifact={q.has('noartifact')}
      />
    </View>
  );
}
