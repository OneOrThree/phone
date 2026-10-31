import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, TextInput, View } from 'react-native';
import { Btn, CharCount, Overlay, Txt } from '@/design-system/patterns';
import {
  componentTokens as c,
  primitiveTokens as p,
  semanticTokens as s,
} from '@/design-system/tokens';
import { t } from '@/i18n';
import { uuid } from '@/services/api/client';
import { ISLAND_NAME_MAX, manageIsland } from '@/services/api/islandManagement';
import { useGowun } from '@/screens/island/sceneKit';

/**
 * 무인도 항해로 새로 세운 섬에 도착해 홈에 들어오면 뜨는 강제 이름 짓기 모달(GROMO-2649).
 * 저장 전에는 닫기·뒤로가기·바깥 터치·홈 조작이 모두 막힌다(blocking, DESIGN §7.11) — `close` 를
 * 주지 않아 바깥 터치가 닫지 않고, 안드로이드 뒤로가기는 삼킨다. 배경은 살아있는 섬 홈(`background`)이고
 * 모달은 그 위 가운데에 뜬다(Overlay 가 배경을 스크린리더에서 숨긴다).
 * 저장은 `PATCH /islands/{id}` 로 이름만 보내고(멱등 키는 의도당 한 번), 성공하면 `onDone` 으로 넘긴다.
 * 이름 칸은 Hall 의 `input('섬 이름','name')` 과 같은 규칙 — UTF-16 `maxLength` 50(서버 @Size 와 같은 축)·공백이면 저장 비활성.
 */
export function IslandNamingModal({
  islandId,
  background,
  onDone,
}: {
  islandId: string;
  background?: React.ReactNode;
  onDone: () => void;
}) {
  const gowun = useGowun();
  const font = { fontFamily: gowun };
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 저장 의도 키 — 응답 유실 재시도도 같은 키로 보낸다(PATCH 는 Idempotency-Key 필수)
  const saveKey = useRef(uuid()).current;
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  // 저장 전에는 안드로이드 뒤로가기를 삼킨다(blocking) — 마운트 순서상 App 핸들러보다 먼저 불려 홈으로 가지 않는다
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const save = () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    manageIsland(islandId, { name: trimmed }, saveKey)
      .then(() => onDone())
      .catch(() => {
        setBusy(false);
        setError(t('home.naming.error'));
      });
  };

  return (
    <Overlay
      maxWidth={320}
      background={background}
      contentStyle={styles.content}
      frameStyle={styles.frame}
    >
      <View accessibilityViewIsModal testID="island-naming-modal" style={styles.inner}>
        <Txt accessibilityRole="header" style={[styles.title, font]}>
          {t('home.naming.title')}
        </Txt>
        <View style={styles.fieldBox}>
          <TextInput
            testID="island-naming-input"
            accessibilityLabel={t('home.naming.title')}
            value={name}
            onChangeText={setName}
            maxLength={ISLAND_NAME_MAX}
            editable={!busy}
            placeholder={t('home.naming.placeholder')}
            placeholderTextColor={c.input.placeholder}
            returnKeyType="done"
            onSubmitEditing={save}
            style={[styles.field, font]}
          />
          <CharCount value={name} max={ISLAND_NAME_MAX} />
        </View>
        {!!error && (
          <Txt accessibilityRole="alert" style={[styles.error, font]}>
            {error}
          </Txt>
        )}
        <Btn
          font={gowun}
          dynamicHeight
          title={busy ? t('home.naming.saving') : t('home.naming.save')}
          disabled={!canSave}
          onPress={save}
        />
      </View>
    </Overlay>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: s.radius.modal, boxShadow: c.modal.shadow },
  content: { padding: p.space[6], paddingBottom: p.space[6] },
  inner: { gap: p.space[4] },
  title: {
    fontSize: s.typography.title,
    lineHeight: 27,
    fontWeight: s.typography.extraBold,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  fieldBox: { gap: p.space[2] },
  field: {
    height: 50,
    borderWidth: s.stroke.default,
    borderColor: s.color.outline,
    borderRadius: s.radius.control,
    backgroundColor: s.color.surface,
    paddingHorizontal: p.space[4],
    fontSize: s.typography.body,
    color: s.color.text,
  },
  error: { color: s.color.danger, textAlign: 'center' },
});
