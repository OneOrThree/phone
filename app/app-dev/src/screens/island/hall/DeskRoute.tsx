import { semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { ScreenProps } from '@/navigation/ScreenEnvironment';
import {
  SceneObjectLabel,
  sceneObjectLabelSize,
} from '@/screens/interiors/shared/SceneObjectLabel';
import { T, web } from '@/design-system/sceneKit';
import { useHallFrame } from '@/screens/island/hall/useHallFrame';
import React from 'react';
import { Pressable, View } from 'react-native';

// ── 042 회관 책상: 사물과 이름표로 같은 기능을 연다 ──
export function DeskRoute({ e }: ScreenProps) {
  const { L, land, W, H, k, off, sx, sy, g, shell } = useHallFrame(e);
  const spots = [
    {
      label: t('common.manageIsland'),
      caption: t('common.manageIsland'),
      labelCenter: land ? [437, 320] : [195, 542],
      route: 'manage' as const,
      on: true,
      box: land ? [309.4, 85.8, 255.1, 236] : [116, 375.8, 170.1, 157.3],
    },
    {
      label: t('ui.hall.chooseWoodenBuilding'),
      caption: t('ui.hall.buildingLabel'),
      labelCenter: land ? [437, 105] : [201, 388],
      route: 'construction' as const,
      on: false,
      box: land ? [337, 5, 200, 100] : [85, 270.9, 231.9, 131.1],
    },
    {
      label: t('ui.hall.sharedLedger'),
      caption: t('ui.hall.sharedLedger'),
      labelCenter: land ? [608, 370] : [318, 634],
      route: 'ledger' as const,
      on: false,
      box: land ? [529.7, 243, 156.5, 196.7] : [262.9, 480.7, 104.4, 131.1],
    },
  ];
  return shell(
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          zIndex: 9,
          top: (land ? 18 : 55.5) + off.top,
          left: land ? 112 + off.left : 0,
          right: land ? undefined : 0,
          alignItems: 'center',
        }}
      >
        <View
          style={[
            {
              minWidth: 148.5,
              paddingTop: 6.5,
              paddingHorizontal: 18.1,
              paddingBottom: 7.7,
              borderWidth: 1.9,
              borderColor: '#65462f',
              borderTopLeftRadius: 7.7,
              borderTopRightRadius: 7.7,
              borderBottomLeftRadius: 11.6,
              borderBottomRightRadius: 11.6,
              backgroundColor: '#c58a55',
              boxShadow: '0px 3.9px 0px rgb(101, 70, 47)',
              transform: [{ rotate: '-1deg' }],
            },
            web({
              backgroundImage:
                'linear-gradient(90deg, rgb(184, 120, 72), rgb(209, 155, 97), rgb(184, 120, 72))',
            }),
          ]}
        >
          <T
            style={g(20.7, 33.12, {
              color: '#fff7e7',
              textAlign: 'center',
              textShadowColor: 'rgb(104, 74, 52)',
              textShadowOffset: { width: 0, height: 1.3 },
              textShadowRadius: 0,
            })}
          >
            {t('building.hall')}
          </T>
        </View>
      </View>
      {spots.map((o) => {
        const labelSize = sceneObjectLabelSize(
          o.caption,
          1,
          Math.max(1, L.fontScale ?? 1),
          W - semanticTokens.spacing.page * 2,
        );
        const labelHeight = Math.max(semanticTokens.size.tapMin, labelSize.height);
        const labelX = Math.max(
          off.left,
          Math.min(sx(o.labelCenter[0]) - labelSize.width / 2, W - off.right - labelSize.width),
        );
        const labelY = Math.max(
          off.top,
          Math.min(sy(o.labelCenter[1]) - labelHeight / 2, H - L.insets.bottom - labelHeight),
        );
        const objectX = sx(o.box[0]),
          objectY = sy(o.box[1]);
        const left = Math.min(objectX, labelX),
          top = Math.min(objectY, labelY);
        // 이름표까지 같은 Pressable 안에 넣는다. Android에서도 부모 밖 터치가 잘리지 않는다.
        return (
          <Pressable
            key={o.route}
            testID={`hall-spot-${o.route}`}
            accessibilityRole="button"
            accessibilityLabel={o.label}
            onPress={() => e.go(o.route)}
            style={{
              position: 'absolute',
              zIndex: 7,
              left,
              top,
              width: Math.max(objectX + o.box[2] * k, labelX + labelSize.width) - left,
              height: Math.max(objectY + o.box[3] * k, labelY + labelHeight) - top,
            }}
          >
            <View
              style={{
                position: 'absolute',
                left: objectX + (o.box[2] * k - 46.5) / 2 - left,
                top: objectY + (o.box[3] * k - 46.5) / 2 - top,
                width: 46.5,
                height: 46.5,
                borderRadius: 23.25,
                backgroundColor: 'rgba(255, 255, 255, 0.45)',
                boxShadow: o.on
                  ? '0px 0px 0px 2.6px rgba(255, 240, 173, 0.8), 0px 0px 0px 9px rgba(244, 167, 187, 0.44)'
                  : '0px 0px 0px 2.6px rgba(255, 255, 255, 0.44), 0px 0px 0px 7.7px rgba(244, 167, 187, 0.333)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 20.7,
                  height: 20.7,
                  borderRadius: 10.35,
                  backgroundColor: o.on ? '#e8517d' : '#f4a7bb',
                }}
              />
            </View>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: labelX - left,
                top: labelY - top,
                width: labelSize.width,
                height: labelHeight,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SceneObjectLabel maxWidth={labelSize.width}>{o.caption}</SceneObjectLabel>
            </View>
          </Pressable>
        );
      })}
    </>,
    e.home,
    t('focusFlow.common.backToIsland'),
  );
}
