import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Btn, Overlay, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { t } from '@/i18n';

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
  return (
    <View accessibilityViewIsModal aria-modal style={StyleSheet.absoluteFill}>
      <Overlay close={pending ? undefined : onClose} maxWidth={354}>
        <Txt accessibilityRole="header" kind="h">
          {t('openSea.prepareTitle', { name: destinationName })}
        </Txt>
        <Txt>{t('openSea.prepareBody')}</Txt>
        <TextInput
          accessibilityLabel={t('openSea.optionalMessage')}
          placeholder={t('openSea.optionalMessage')}
          style={k.field}
          value={message}
          editable={!pending}
          onChangeText={(value) => setMessage(Array.from(value).slice(0, 20).join(''))}
        />
        {!!error && <Txt accessibilityRole="alert">{error}</Txt>}
        <Btn
          dynamicHeight
          title={t(pending ? 'openSea.processing' : 'openSea.start')}
          disabled={pending}
          onPress={() => onStart(message.trim())}
        />
        <Btn
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
