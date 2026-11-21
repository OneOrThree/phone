import { NavBtn, art } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import { BROWN, T, fill, safeOffset, useGowun, web } from '@/design-system/sceneKit';
import { CARD_INK, MUTED } from '@/screens/island/hall/hallShared';
import { useAppLayout } from '@/utils/layout';
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Pressable, ScrollView, View } from 'react-native';

// 회관 모든 route 가 같이 쓰는 틀 — 글꼴·배치 값·방 그림·뒤로 버튼·토스트·확인창과 그 셋을 감싸는 shell.
// closeInner: route 의 안쪽 창(건설 청사진, 섬 정보 수정·위임 창)이 열려 있을 때만 그 창을 한 단계 닫는 함수, 닫혀 있으면 null.
// route 는 안쪽 창 값이 바뀔 때만 새 함수를 만든다(useMemo) — 뒤로 가기 리스너는 그때와 확인창이 바뀔 때만 다시 건다.
export function useHallFrame(e: ScreenProps['e'], closeInner: (() => void) | null = null) {
  const font = useGowun();
  const L = useAppLayout(),
    land = L.landscape,
    W = L.width,
    H = L.height,
    r = e.route;
  const [toast, setToast] = useState(''),
    [dialog, setDialog] = useState<{
      title: string;
      text: string;
      detail?: React.ReactNode;
      // ok가 없으면 취소만 있는 선택창
      ok?: string;
      onOk?: () => void;
      // 되돌릴 수 없는 행동(탈퇴·강퇴)만 붉은 확인 버튼을 쓴다
      danger?: boolean;
      body?: React.ReactNode;
    } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // 안드로이드 뒤로 가기: 확인창 → 청사진 → 수정·위임 창 순으로 하나만 닫고 회관에 머문다(청사진은 건설, 수정·위임 창은 관리 route 의 closeInner).
  // 열린 창이 있을 때만 등록해 App 전역 리스너보다 나중에 등록되므로 먼저 불린다
  useEffect(() => {
    if (!dialog && !closeInner) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dialog) setDialog(null);
      else closeInner?.();
      return true;
    });
    return () => sub.remove();
  }, [dialog, closeInner]);
  const notify = (text: string) => {
    setToast(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2400);
  };
  // .hl 글자: 고운돋움, 자간 −0.15
  const g = (size: number, lh: number, extra?: object) => ({
    fontFamily: font,
    fontSize: size,
    lineHeight: lh,
    ...extra,
  });

  // 방 그림은 cover로 잘리므로, 시안(402×874 / 874×402) 좌표를 화면 가운데 기준으로 옮긴다
  const k = land
    ? Math.max(W / 1024, H / 471) / (874 / 1024)
    : Math.max(W / 1024, H / 1536) / (874 / 1536);
  // 가로 패널 왼쪽: 874 폭은 시안대로 300, 좁은 폰(SE 667·640dp)은 패널 폭 558을 지키다가
  // 뒤로 버튼(오른쪽 끝 100) 옆 120까지만 줄인다. 확인창·토스트는 그보다 60 안쪽
  const off = safeOffset(L);
  const side = Math.min(300, Math.max(120, W - 574)),
    over = side + 60;
  const sx = (x: number) => W / 2 + (x - (land ? 437 : 201)) * k,
    sy = (y: number) => H / 2 + (y - (land ? 201 : 437)) * k;
  const blurred = r !== 'hall' && r !== 'construction';
  const scene = (
    <>
      <Image
        source={art[(land ? 'L/' : '') + (blurred ? 'hall/room-blur' : 'hall/room')]}
        style={fill}
        resizeMode="cover"
      />
      <View
        pointerEvents="none"
        style={[
          fill,
          web({
            backgroundImage:
              'linear-gradient(rgba(55, 39, 29, 0.07), transparent 24%, transparent 70%, rgba(55, 39, 29, 0.047)), linear-gradient(90deg, rgba(57, 40, 27, 0.086), transparent 24%, transparent 76%, rgba(57, 40, 27, 0.086))',
          }),
        ]}
      />
      {blurred && (
        <View pointerEvents="none" style={[fill, { backgroundColor: 'rgba(78, 61, 41, 0.094)' }]} />
      )}
    </>
  );
  // 목적지가 정해진 ‹ 는 목적지를 읽고(책상 → 섬), 이전 화면으로 가는 ‹ 는 「뒤로」다(DESIGN §7.14)
  const back = (onPress: () => void, label = t('common.back')) => (
    <NavBtn
      label={label}
      testID="hall-back"
      onPress={onPress}
      style={{
        position: 'absolute',
        zIndex: 12,
        left: (land ? 56 : 18) + off.left,
        top: (land ? 14 : 46.5) + off.top,
      }}
    />
  );
  const toastView = toast !== '' && (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        zIndex: 22,
        left: land ? over : 28,
        right: land ? 75 : 28,
        bottom: land ? 24 : 65,
        paddingVertical: 13,
        paddingHorizontal: 16,
        borderRadius: 12,
        backgroundColor: 'rgba(73, 59, 57, 0.91)',
        boxShadow: '0px 6px 18px rgba(45, 33, 27, 0.333)',
      }}
    >
      <T style={g(14, 20.3, { color: '#fffaf0', textAlign: 'center' })}>{toast}</T>
    </View>
  );
  const dialogView = dialog && (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        onPress={() => setDialog(null)}
        style={[fill, { zIndex: 20, backgroundColor: 'rgba(51, 42, 38, 0.45)' }]}
      />
      <View
        pointerEvents="box-none"
        style={[
          fill,
          {
            zIndex: 21,
            justifyContent: 'center',
            paddingLeft: land ? over : 31,
            paddingRight: land ? 75 : 31,
            paddingTop: L.insets.top + semanticTokens.spacing.control,
            paddingBottom: L.insets.bottom + semanticTokens.spacing.control,
          },
        ]}
      >
        <View
          testID="hall-dialog"
          accessibilityViewIsModal
          style={{
            maxHeight: H - L.insets.top - L.insets.bottom - 2 * semanticTokens.spacing.control,
            gap: land ? 7 : 11,
            paddingTop: land ? 16 : 22,
            paddingHorizontal: land ? 18 : 19,
            paddingBottom: land ? 16 : 18,
            borderWidth: 2,
            borderColor: '#806449',
            borderRadius: 17,
            backgroundColor: '#fff8e9',
            boxShadow: '0px 14px 34px rgba(45, 33, 27, 0.5)',
          }}
        >
          <ScrollView
            testID="hall-dialog-content"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: land ? 7 : 11 }}
            keyboardShouldPersistTaps="handled"
          >
            <T style={g(21, 33.6, { color: CARD_INK, fontWeight: '700' })}>{dialog.title}</T>
            {!!dialog.text && (
              <T
                style={g(land ? 14 : 15, land ? 21.7 : 23.25, {
                  color: MUTED,
                  ...web({ wordBreak: 'keep-all' }),
                })}
              >
                {dialog.text}
              </T>
            )}
            {dialog.body}
            {!!dialog.detail && (
              <View
                style={{
                  padding: land ? 8 : 11,
                  borderWidth: 1,
                  borderColor: '#d1b995',
                  borderRadius: 9,
                  backgroundColor: '#fffdf8',
                }}
              >
                <T style={g(14, 20.3, { color: CARD_INK })}>{dialog.detail}</T>
              </View>
            )}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexShrink: 0, gap: 8, marginTop: 3 }}>
            {(dialog.ok ? [false, true] : [false]).map((ok) => (
              <Pressable
                key={String(ok)}
                testID={ok ? 'hall-dialog-ok' : 'hall-dialog-cancel'}
                accessibilityRole="button"
                accessibilityLabel={ok ? dialog.ok : t('common.cancel')}
                onPress={() => {
                  setDialog(null);
                  if (ok) dialog.onOk?.();
                }}
                style={{
                  flex: ok ? 1.35 : 1,
                  minHeight: 44,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: BROWN,
                  borderRadius: 99,
                  // 주 행동은 Pink(DESIGN §7.2), 위험 행동만 빨강
                  backgroundColor: ok
                    ? dialog.danger
                      ? '#e9a49d'
                      : componentTokens.button.background
                    : undefined,
                }}
              >
                <T
                  style={g(14, 22.4, {
                    color: ok && dialog.danger ? '#6f2d2a' : CARD_INK,
                    fontWeight: ok ? '700' : '400',
                  })}
                >
                  {ok ? dialog.ok : t('common.cancel')}
                </T>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </>
  );
  const shell = (children: React.ReactNode, backPress?: () => void, backLabel?: string) => (
    <View style={{ flex: 1 }}>
      {/* 확인창이 열린 동안 뒤 장면은 보조기기에서 숨긴다 */}
      <View
        style={fill}
        aria-hidden={!!dialog}
        accessibilityElementsHidden={!!dialog}
        importantForAccessibility={dialog ? 'no-hide-descendants' : 'auto'}
      >
        {scene}
        {backPress && back(backPress, backLabel)}
        {children}
      </View>
      {dialogView}
      {toastView}
    </View>
  );
  return { font, L, land, W, H, k, off, side, sx, sy, g, notify, setDialog, shell };
}
