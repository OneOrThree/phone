import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Btn, Overlay, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { t } from '@/i18n';
import { useGowun } from '@/screens/island/sceneKit';

/** 망원경에서 고른 목적지를 받아 시작 명령을 호출하는 V1 시트. */
export function SeaVoyagePreparation({
  destinationName,
  pending,
  error,
  onStart,
  onClose,
}: {
  destinationName: string;
  pending: boolean;
  error?: string;
  onStart: (message: string) => void;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  // 출항 준비창 글자·입력·버튼도 고운돋움(DESIGN.md 그림 장면 위 화면 규칙)
  const gowun = useGowun();
  const font = { fontFamily: gowun };
  return (
    <View accessibilityViewIsModal aria-modal style={StyleSheet.absoluteFill}>
      <Overlay close={pending ? undefined : onClose} maxWidth={354}>
        <Txt accessibilityRole="header" kind="h" style={font}>
          {t('openSea.prepareTitle', { name: destinationName })}
        </Txt>
        <Txt style={font}>{t('openSea.prepareBody')}</Txt>
        <TextInput
          accessibilityLabel={t('openSea.optionalMessage')}
          placeholder={t('openSea.optionalMessage')}
          style={[k.field, font]}
          value={message}
          editable={!pending}
          onChangeText={(value) => setMessage(Array.from(value).slice(0, 20).join(''))}
        />
        {!!error && (
          <Txt accessibilityRole="alert" style={font}>
            {error}
          </Txt>
        )}
        <Btn
          font={gowun}
          dynamicHeight
          title={t(pending ? 'openSea.processing' : 'openSea.start')}
          disabled={pending}
          onPress={() => onStart(message.trim())}
        />
        <Btn
          font={gowun}
          dynamicHeight
          title={t('openSea.close')}
          kind="glass"
          disabled={pending}
          onPress={onClose}
        />
      </Overlay>
    </View>
  );
}
