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
            notify(
              thrown instanceof ApiError && thrown.message
                ? thrown.message
                : '구매하지 못했어요. 다시 시도해 주세요.',
            );
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
            label="섬으로 돌아가기"
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
              축음기
            </Txt>
          </View>
          <View
            style={{
              position: 'absolute',
              left: (layout.width - panelWidth) / 2,
              bottom: Math.max(18, ins.bottom + 8),
              width: panelWidth,
              height: panelHeight,
              flexDirection: 'row',
              alignItems: 'center',
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
                <View
                  style={{
                    width: 128,
                    height: contentHeight,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <View
                    accessibilityLabel="축음기 레코드판"
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
                    섬에서 들을 곡을 구매해요
                  </Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0, height: contentHeight, gap: 8 }}>
                  <View
                    testID="sound-current-track"
                    style={{ minHeight: gramophone.currentTrackMinHeight, flexShrink: 0 }}
                  >
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foreground, ...gramophone.titleText }}
                    >
                      음원 구매
                    </Txt>
                    <Txt
                      tabletScale={1}
                      style={{ color: gramophone.foregroundMuted, ...gramophone.captionText }}
                    >
                      재생과 곡 변경은 집중섬 축음기에서 할 수 있어요
                    </Txt>
                  </View>
                  <ScrollView
                    style={{ flex: 1 }}
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
                          ? '무료'
                          : '보유'
                        : !localAudioIds.has(id)
                          ? '앱 업데이트가 필요해요'
                          : unavailable
                            ? shopBlockReason(product ?? {})
                            : `${product?.price}마리 · 구매`;
                      return (
                        <Pressable
                          key={id}
                          accessibilityRole="button"
                          accessibilityLabel={
                            owned
                              ? `${trackLabel(id)}, ${status}`
                              : unavailable
                                ? `${trackLabel(id)}, ${status}`
                                : `${trackLabel(id)}, ${product?.price}마리로 구매`
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
                <Txt style={{ color: gramophone.foreground }}>축음기를 먼저 지어 주세요.</Txt>
                <Btn title="마을회관에서 건설" onPress={() => go('construction')} />
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
                    ? `${dialogProduct.title}를 구매할까요?`
                    : soundDialog.kind === 'success'
                      ? '구매했어요'
                      : '물고기가 부족해요'}
                </Txt>
                {soundDialog.kind === 'confirm' && (
                  <Txt kind="meta" style={{ textAlign: 'center', lineHeight: 20 }}>
                    구매한 곡은 같은 섬 주민 모두가 함께 들을 수 있어요.
                  </Txt>
                )}
                {soundDialog.kind === 'confirm' ? (
                  <View
                    testID="sound-dialog-actions"
                    style={{ flexDirection: largeText ? 'column' : 'row', gap: 8 }}
                  >
                    <Btn
                      title="취소"
                      kind="glass"
                      dynamicHeight={largeText}
                      onPress={() => setSoundDialog(null)}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                    <Btn
                      title={`${dialogProduct.price}마리로 구매`}
                      dynamicHeight={largeText}
                      disabled={server && shopApi.writing}
                      onPress={buyTrack}
                      style={largeText ? undefined : { flex: 1 }}
                    />
                  </View>
                ) : (
                  <Btn
                    title="확인"
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
