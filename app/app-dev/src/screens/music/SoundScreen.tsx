import { t, errorTextOr } from '@/i18n';
import {
  BUNDLED_AUDIO_TRACK_IDS,
  DEFAULT_FREE_AUDIO_TRACK_IDS,
  hasBundledAudio,
} from '@/constants/audio';
import { Btn, C, NavBtn, Pic, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { ApiError } from '@/services/api/client';
import { canBuy, products, trackNames } from '@/services/model';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { gradient, shopBlockReason } from '../island/navigation/screenParts';
import type { ScreenContext } from '../island/navigation/useScreenState';

export function renderSoundScreen(context: ScreenContext) {
  const {
    route,
    server,
    shopApi,
    island,
    layout,
    soundDialog,
    setSoundDialog,
    e,
    notify,
    state,
    act,
    ins,
    back,
    go,
  } = context;

  if (route === 'sound') {
    const gramophone = componentTokens.gramophone;
    const audioProducts: any[] = server
      ? shopApi.items
      : products.filter((p) => p.kind === 'audio');
    const localAudioIds = new Set<string>(BUNDLED_AUDIO_TRACK_IDS);
    const serverAudioLoaded = !!shopApi.shared;
    const ownedTrackIds = (serverAudioLoaded ? shopApi.shared!.audio : island.sharedOwned).filter(
      hasBundledAudio,
    );
    const trackLabel = (id: string) => trackNames[id] ?? shopApi.titles[id] ?? id;
    const trackIds = [
      ...ownedTrackIds,
      ...audioProducts.map((p) => p.id).filter((id) => !ownedTrackIds.includes(id)),
    ];
    const largeText = (layout.fontScale ?? 1) >= semanticTokens.typography.largeTextThreshold;
    const dialogProduct = soundDialog?.product;
    const selectTrack = (id: string) => {
      if (ownedTrackIds.includes(id)) return;
      const product = audioProducts.find((item) => item.id === id);
      if (
        !localAudioIds.has(id) ||
        (server && (product?.available === false || product?.price == null))
      )
        return;
      if (product) setSoundDialog({ kind: 'confirm', productId: id, product });
    };
    const buyTrack = async () => {
      if (!dialogProduct) return;
      if (server) {
        try {
          await shopApi.buy(dialogProduct);
          setSoundDialog({ kind: 'success', productId: dialogProduct.id, product: dialogProduct });
        } catch (thrown) {
          if (e.conversion?.offer(thrown)) setSoundDialog(null);
          else if (thrown instanceof ApiError && thrown.code === 'INSUFFICIENT_FUNDS')
            setSoundDialog({ kind: 'error', productId: dialogProduct.id, product: dialogProduct });
          else {
            setSoundDialog(null);
            notify(errorTextOr(thrown, 'ui.errors.purchaseFailed'));
          }
        }
        return;
      }
      if (canBuy(state, dialogProduct)) {
        setSoundDialog({ kind: 'error', productId: dialogProduct.id, product: dialogProduct });
        return;
      }
      act('BUY', { id: dialogProduct.id });
      setSoundDialog({ kind: 'success', productId: dialogProduct.id, product: dialogProduct });
    };
    const bottomWidth = Math.min(gramophone.panelWidth, layout.width - ins.left - ins.right - 36);
    const panelWidth = layout.compact
      ? Math.min(gramophone.compactPanelWidth, layout.width - ins.left - ins.right - 36)
      : bottomWidth;
    const panelHeight = layout.compact ? gramophone.compactPanelHeight : gramophone.panelHeight;
    const contentHeight = layout.compact
      ? gramophone.compactContentHeight
      : gramophone.contentHeight;
    const panelBottom = Math.max(18, ins.bottom + 8);
    // 큰 글자 판은 곡 수만큼 늘리되 간판(위 20+높이 40) 아래·바닥 여백 위로 상한을 둔다 — 넘치면 곡 목록만 스크롤된다
    const largePanelMaxHeight = Math.max(0, layout.height - (20 + ins.top + 40 + 12) - panelBottom);
    return (
      <View style={{ flex: 1, backgroundColor: C.paper }}>
        <View
          testID="sound-background-content"
          style={StyleSheet.absoluteFill}
          pointerEvents={soundDialog ? 'none' : 'auto'}
          accessibilityElementsHidden={!!soundDialog}
          importantForAccessibility={soundDialog ? 'no-hide-descendants' : 'auto'}
        >
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            aria-hidden={true}
            style={StyleSheet.absoluteFill}
          >
            <Pic id="interior/gram" w="100%" h="100%" cover />
          </View>
          <NavBtn
            label={t('focusFlow.common.backToIsland')}
            onPress={back}
            style={{ position: 'absolute', left: 20 + ins.left, top: 16 + ins.top }}
          />
          <View
            style={[
              gradient(
                `linear-gradient(90deg, ${gramophone.signStart}, ${gramophone.signCenter} 50%, ${gramophone.signEnd})`,
              ),
              {
                position: 'absolute',
                top: 20 + ins.top,
                alignSelf: 'center',
                minWidth: 124,
                height: 40,
                borderWidth: 1.5,
                borderColor: gramophone.woodBorder,
                borderRadius: 8,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: gramophone.signShadow,
              },
            ]}
          >
            <Txt
              tabletScale={1}
              style={{ color: gramophone.signForeground, fontSize: 17, lineHeight: 24 }}
            >
              {t('building.gram')}
            </Txt>
          </View>
          <View
            testID="sound-panel"
            style={{
              position: 'absolute',
              left: (layout.width - panelWidth) / 2,
              bottom: panelBottom,
              width: panelWidth,
              // 큰 글자는 곡 수만큼 높이를 늘린다 — 고정 높이면 셋째 곡이 스크롤 밖으로 숨었다(GROMO-2888).
              // 다만 화면 위로 벗어나지 않게 상한을 두고, 레코드 칸이 없으니 세로로 쌓아 목록이 줄어들며 스크롤된다
              height: largeText ? undefined : panelHeight,
              maxHeight: largeText ? largePanelMaxHeight : undefined,
              flexDirection: largeText ? 'column' : 'row',
              alignItems: largeText ? 'stretch' : 'center',
              gap: 12,
              padding: 16,
              borderWidth: 2,
              borderColor: C.brown,
              borderRadius: 14,
              backgroundColor: gramophone.panelBackground,
              boxShadow: gramophone.panelShadow,
            }}
          >
            {island.buildings.includes('gram') ? (
              <>
                {/* 큰 글자는 레코드 칸을 빼고 곡 목록이 패널 폭을 다 쓴다 — 360dp·1.3배에서 「잔잔한 파/도」처럼 곡 이름이 끊겼다(GROMO-2888) */}
                {!largeText && (
                  <View
                    style={{
                      width: 128,
                      height: contentHeight,
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <View
                      accessibilityLabel={t('ui.shop.recordPlayer')}
                      style={{
                        width: gramophone.recordSize,
                        height: gramophone.recordSize,
                        borderRadius: gramophone.recordSize / 2,
                        borderWidth: 6,
                        borderColor: gramophone.recordGroove,
                        backgroundColor: gramophone.recordBackground,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {[88, 68, 48].map((size) => (
                        <View
                          key={size}
                          style={{
                            position: 'absolute',
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderWidth: 4,
                            borderColor: gramophone.recordGroove,
                          }}
                        />
                      ))}
                      <View
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 15,
                          backgroundColor: C.pink,
                          borderWidth: 2,
                          borderColor: gramophone.recordGroove,
                        }}
                      />
                    </View>
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foregroundMuted, ...gramophone.captionText }}
                    >
                      {t('ui.shop.buyMusicHint')}
                    </Txt>
                  </View>
                )}
                <View
                  style={[
                    { minWidth: 0, gap: 8 },
                    largeText
                      ? { flexShrink: 1, minHeight: 0 }
                      : { flex: 1, height: contentHeight },
                  ]}
                >
                  <View
                    testID="sound-current-track"
                    style={{ minHeight: gramophone.currentTrackMinHeight, flexShrink: 0 }}
                  >
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foreground, ...gramophone.titleText }}
                    >
                      {t('ui.shop.buyMusic')}
                    </Txt>
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foregroundMuted, ...gramophone.captionText }}
                    >
                      {t('ui.shop.playAtFocusIsland')}
                    </Txt>
                  </View>
                  <ScrollView
                    testID="sound-track-list"
                    style={largeText ? { flexShrink: 1 } : { flex: 1 }}
                    contentContainerStyle={{ gap: 4, paddingRight: 4 }}
                    showsVerticalScrollIndicator
                  >
                    {trackIds.map((id) => {
                      const owned = ownedTrackIds.includes(id);
                      const product = audioProducts.find((item) => item.id === id);
                      const unavailable =
                        !owned &&
                        (!localAudioIds.has(id) ||
                          (server && (product?.available === false || product?.price == null)));
                      const status = owned
                        ? DEFAULT_FREE_AUDIO_TRACK_IDS.includes(id)
                          ? t('focusFlow.music.free')
                          : t('focusFlow.music.owned')
                        : !localAudioIds.has(id)
                          ? t('ui.shop.updateRequired')
                          : unavailable
                            ? shopBlockReason(product ?? {})
                            : t('ui.shop.priceBuy', { v0: product?.price });
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="button"
                          accessibilityLabel={
                            owned
                              ? `${trackLabel(id)}, ${status}`
                              : unavailable
                                ? `${trackLabel(id)}, ${status}`
                                : t('ui.shop.buyTrackA11y', {
                                    v0: trackLabel(id),
                                    v1: product?.price,
                                  })
                          }
                          accessibilityState={{ disabled: owned || unavailable }}
                          disabled={owned || unavailable}
                          onPress={() => selectTrack(id)}
                          style={{
                            minHeight: gramophone.rowMinHeight,
                            paddingHorizontal: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            borderWidth: 1.25,
                            borderColor: C.brown,
                            borderRadius: 7,
                            backgroundColor: owned ? C.paper : C.butter,
                            opacity: owned || unavailable ? 0.72 : 1,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                            <Txt
                              testID={`sound-track-title-${id}`}
                              tabletScale={1}
                              style={{ ...gramophone.rowTitleText, flexShrink: 1 }}
                            >
                              {trackLabel(id)}
                            </Txt>
                          </View>
                          <Txt
                            testID={`sound-track-status-${id}`}
                            tabletScale={1}
                            style={{
                              maxWidth: '45%',
                              flexShrink: 1,
                              textAlign: 'right',
                              color: gramophone.rowForeground,
                              ...gramophone.rowStatusText,
                            }}
                          >
                            {status}
                          </Txt>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            ) : (
              <View style={{ flex: 1, alignItems: 'center', gap: 12 }}>
                <Txt style={{ color: gramophone.foreground }}>{t('ui.shop.buildGramFirst')}</Txt>
                <Btn title={t('ui.shop.buildAtHall')} onPress={() => go('construction')} />
              </View>
            )}
          </View>
        </View>
        {soundDialog && dialogProduct && (
          <View
            accessibilityViewIsModal
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: componentTokens.overlay.background,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
              },
            ]}
          >
            <View
              testID="sound-dialog-card"
              style={{
                width: Math.min(354, layout.width - 48),
                maxHeight: layout.height - ins.top - ins.bottom - 32,
                borderWidth: 2,
                borderColor: C.brown,
                borderRadius: 22,
                backgroundColor: C.paper,
                boxShadow: '0px 6px 0px ' + C.brown,
              }}
            >
              <ScrollView
                testID="sound-dialog-scroll"
                style={{ flexShrink: 1 }}
                contentContainerStyle={{ padding: 20, gap: 16 }}
              >
                {soundDialog.kind === 'error' && (
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      alignSelf: 'center',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: C.butter,
                    }}
                  >
                    <Txt tabletScale={1} style={{ fontSize: 27, lineHeight: 32 }}>
                      !
                    </Txt>
                  </View>
                )}
                <Txt
                  style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center' }}
                >
                  {soundDialog.kind === 'confirm'
                    ? t('ui.shop.confirmTrack', { v0: dialogProduct.title })
                    : soundDialog.kind === 'success'
                      ? t('focusFlow.music.purchaseSuccess')
                      : t('focusFlow.music.insufficientFish')}
                </Txt>
                {soundDialog.kind === 'confirm' && (
                  <Txt kind="meta" style={{ textAlign: 'center', lineHeight: 20 }}>
                    {t('ui.shop.musicShared')}
                  </Txt>
                )}
                {soundDialog.kind === 'confirm' ? (
                  <View
                    testID="sound-dialog-actions"
                    style={{ flexDirection: largeText ? 'column' : 'row', gap: 8 }}
                  >
                    <Btn
                      title={t('common.cancel')}
                      kind="glass"
                      dynamicHeight={largeText}
                      onPress={() => setSoundDialog(null)}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                    <Btn
                      title={t('ui.shop.buyForFish', { v0: dialogProduct.price })}
                      dynamicHeight={largeText}
                      disabled={server && shopApi.writing}
                      onPress={buyTrack}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                  </View>
                ) : (
                  <Btn
                    title={t('common.ok')}
                    dynamicHeight={largeText}
                    disabled={server && shopApi.writing}
                    onPress={() => setSoundDialog(null)}
                  />
                )}
              </ScrollView>
            </View>
          </View>
        )}
      </View>
    );
  }
}
