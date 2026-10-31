import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Btn, Field, Overlay, Txt } from '@/design-system/patterns';
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
  // 저장 의도 키(PATCH 는 Idempotency-Key 필수). 같은 이름 재시도(응답 유실)는 같은 키로 보내 중복을 막고,
  // 이름을 바꿔 재시도하면 새 키를 쓴다 — 서버 manage() 가 이름을 멱등 지문에 넣어, 같은 키로 다른 이름을
  // 보내면 IDEMPOTENCY_KEY_CONFLICT 로 거절돼 수정한 이름으로 진행할 수 없기 때문.
  const saveKey = useRef(uuid());
  const keyName = useRef<string | null>(null);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  // 저장 전에는 안드로이드 뒤로가기를 삼킨다(blocking) — 마운트 순서상 App 핸들러보다 먼저 불려 홈으로 가지 않는다
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const save = () => {
    if (!canSave) return;
    // 직전 시도와 이름이 다르면 새 멱등 키를 발급한다(같은 이름 재시도는 키를 유지해 중복 저장을 막는다).
    if (keyName.current !== trimmed) {
      saveKey.current = uuid();
      keyName.current = trimmed;
    }
    setBusy(true);
    setError('');
    manageIsland(islandId, { name: trimmed }, saveKey.current)
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
        {/* 공용 Field 재사용(GROMO-2649) — minHeight·동적 글자 크기·CharCount·앱 글씨체를 다른 입력과 똑같이 따른다 */}
        <Field
          value={name}
          onChange={setName}
          placeholder={t('home.naming.placeholder')}
          maxLength={ISLAND_NAME_MAX}
          disabled={busy}
          onSubmit={save}
        />
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
  error: { color: s.color.danger, textAlign: 'center' },
});
