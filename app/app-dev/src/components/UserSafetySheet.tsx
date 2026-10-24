import React, { useEffect, useState } from 'react';
import {
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Btn, C, NavBtn, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { blockUser } from '@/services/api/safety';
import { errorTextOr, t } from '@/i18n';
import { isUserBlocked, markUserBlocked, revalidateBlockedUsers } from '@/services/blockedUsers';
import { useAppLayout } from '@/utils/layout';

const SAFETY_ART = {
  background: require('@/assets/interiors/mail-cute-v1.png'),
  envelope: require('@/assets/interiors/ui/letter-envelope-v1.png'),
  cat: require('@/assets/redesign/cat-black-sitting.png'),
  postbird: require('@/assets/characters/pelican/npc/on-mailbox.png'),
};

type Props = {
  visible: boolean;
  targetUserId: string;
  targetName: string;
  initialMode?: 'menu' | 'block';
  onClose: () => void;
  onChanged?: () => void;
  onMessage: (message: string) => void;
  extraAction?: { title: string; onPress: () => void };
};

export function UserSafetySheet(props: Props) {
  const layout = useAppLayout();
  const centered = layout.tablet || layout.compact;
  const [mode, setMode] = useState<'menu' | 'block'>(props.initialMode ?? 'menu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!props.visible) return;
    setMode(props.initialMode ?? 'menu');
    setBusy(false);
    setError('');
  }, [props.visible, props.targetUserId, props.initialMode]);

  const fail = (thrown: unknown) => {
    setError(errorTextOr(thrown, 'safety.failed'));
  };

  const block = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await blockUser(props.targetUserId);
      markUserBlocked(props.targetUserId);
      props.onChanged?.();
      props.onClose();
      props.onMessage(t('safety.blocked', { name: props.targetName }));
    } catch (thrown) {
      // 서버 성공 뒤 응답만 유실됐을 수도 있으므로 정본을 즉시 다시 읽어 로컬 필터를 수렴시킨다.
      const verified = await revalidateBlockedUsers()
        .then(
          (users) =>
            users.some((user) => user.id === props.targetUserId) ||
            isUserBlocked(props.targetUserId),
        )
        .catch(() => false);
      if (verified) {
        props.onChanged?.();
        props.onClose();
        props.onMessage(t('safety.blocked', { name: props.targetName }));
        return;
      }
      fail(thrown);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) props.onClose();
  };

  return (
    <Modal transparent visible={props.visible} animationType="fade" onRequestClose={close}>
      <ImageBackground source={SAFETY_ART.background} resizeMode="cover" style={{ flex: 1 }}>
        <View
          testID="user-safety-overlay"
          style={[StyleSheet.absoluteFill, { backgroundColor: componentTokens.overlay.background }]}
        />
        <KeyboardAvoidingView
          testID="user-safety-layout"
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{
            flex: 1,
            justifyContent: centered ? 'center' : 'flex-end',
            alignItems: centered ? 'center' : 'stretch',
          }}
        >
          <Pressable
            testID="user-safety-background"
            style={StyleSheet.absoluteFill}
            accessibilityLabel={t('common.close')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={close}
          >
            <Image
              source={SAFETY_ART.envelope}
              resizeMode="contain"
              accessible={false}
              style={{
                position: 'absolute',
                left: 18,
                top: 42,
                width: 94,
                height: 94,
                transform: [{ rotate: '-9deg' }],
              }}
            />
            <Image
              source={SAFETY_ART.postbird}
              resizeMode="contain"
              accessible={false}
              style={{ position: 'absolute', right: -12, top: 8, width: 154, height: 154 }}
            />
            <Image
              source={SAFETY_ART.cat}
              resizeMode="contain"
              accessible={false}
              style={{ position: 'absolute', left: '33%', bottom: -18, width: 112, height: 112 }}
            />
          </Pressable>
          <View
            testID="user-safety-panel"
            accessibilityViewIsModal
            style={{
              width: centered ? layout.modalWidth : undefined,
              maxHeight: '80%',
              marginHorizontal: centered ? 0 : semanticTokens.spacing.control,
              marginBottom: centered ? 0 : layout.insets.bottom + semanticTokens.spacing.control,
              padding: componentTokens.modal.padding,
              paddingBottom: componentTokens.modal.paddingBottom,
              gap: componentTokens.modal.gap,
              borderRadius: centered
                ? componentTokens.modal.radius
                : componentTokens.modal.sheetRadius,
              borderBottomLeftRadius: centered ? componentTokens.modal.radius : 0,
              borderBottomRightRadius: centered ? componentTokens.modal.radius : 0,
              borderWidth: componentTokens.modal.borderWidth,
              borderColor: C.brown,
              backgroundColor: C.paper,
              boxShadow: componentTokens.modal.shadow,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Txt kind="title">{mode === 'menu' ? props.targetName : t('safety.blockTitle')}</Txt>
              <NavBtn close label={t('common.close')} disabled={busy} onPress={close} />
            </View>

            <ScrollView
              testID="user-safety-content"
              keyboardShouldPersistTaps="handled"
              style={{ flexShrink: 1, minHeight: 0 }}
              contentContainerStyle={{ gap: componentTokens.modal.gap }}
            >
              {mode === 'menu' ? (
                <View style={{ gap: semanticTokens.spacing.control }}>
                  <Btn kind="sec" title={t('safety.blockTitle')} onPress={() => setMode('block')} />
                  {props.extraAction ? (
                    <Btn
                      kind="sec"
                      title={props.extraAction.title}
                      onPress={() => {
                        props.onClose();
                        props.extraAction?.onPress();
                      }}
                    />
                  ) : null}
                </View>
              ) : (
                <View style={{ gap: componentTokens.modal.gap }}>
                  <Txt>{t('safety.blockBody', { name: props.targetName })}</Txt>
                  <View style={{ flexDirection: 'row', gap: semanticTokens.spacing.control }}>
                    <Btn
                      kind="sec"
                      title={t('common.cancel')}
                      disabled={busy}
                      style={{ flex: 1 }}
                      onPress={() => (props.initialMode === 'block' ? close() : setMode('menu'))}
                    />
                    <Btn
                      title={busy ? t('safety.processing') : t('safety.blockAction')}
                      disabled={busy}
                      style={{ flex: 1 }}
                      onPress={block}
                    />
                  </View>
                </View>
              )}
            </ScrollView>
            {error ? <Txt style={{ color: C.danger }}>{error}</Txt> : null}
          </View>
        </KeyboardAvoidingView>
      </ImageBackground>
    </Modal>
  );
}
