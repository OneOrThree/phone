import { Btn, CharCount, NavBtn, Pic, Toggle, Txt, Wheel, Overlay } from '@/design-system/patterns';
import { primitiveTokens as P, semanticTokens as S, componentTokens } from '@/design-system/tokens';
import { TextInput } from '@/design-system/typography';
import { t } from '@/i18n';
import { getSession } from '@/services/api/session';
import { ISLAND_INTRO_MAX, ISLAND_NAME_MAX } from '@/services/api/islandManagement';
import { isMockMode } from '@/services/demoMode';
import { CAPACITY_MAX, CAPACITY_MIN } from '@/services/model';
import {
  emptyCreateIslandDraft,
  readCreateIslandDraft,
  writeCreateIslandDraft,
  removeCreateIslandDraft,
  type CreateIslandDraft,
} from '@/services/createIslandDraft';
import { clampCodePoints } from '@/utils/codePoints';
import { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import type { ScreenContext } from '../navigation/useScreenState';

const D = componentTokens.createIsland;
const systemFont =
  Platform.OS === 'web'
    ? '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
    : 'System';

export function CreateIslandScreen({ context }: { context: ScreenContext }) {
  const owner = getSession()?.userId ?? (isMockMode() ? 'preview' : null);
  return <CreateIslandEditor key={owner ?? 'anonymous'} context={context} owner={owner} />;
}
function CreateIslandEditor({
  context: c,
  owner,
}: {
  context: ScreenContext;
  owner: string | null;
}) {
  const [draft, setDraft] = useState<CreateIslandDraft>({
    ...emptyCreateIslandDraft,
    name: c.text,
    intro: c.body,
  });
  const [ready, setReady] = useState(!owner);
  const [storageError, setStorageError] = useState(false);
  const [picking, setPicking] = useState(false);
  const draftRef = useRef(draft);
  const live = useRef(true);
  const { layout, serverBusy, serverDone } = c;
  useEffect(() => {
    live.current = true;
    if (owner)
      void readCreateIslandDraft(owner)
        .then((saved) => {
          if (live.current && saved) {
            draftRef.current = saved;
            setDraft(saved);
          }
        })
        .catch(() => {
          if (live.current) setStorageError(true);
        })
        .finally(() => {
          if (live.current) setReady(true);
        });
    return () => {
      live.current = false;
    };
  }, [owner]);
  const update = (patch: Partial<CreateIslandDraft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    if (owner)
      void writeCreateIslandDraft(owner, next)
        .then(() => {
          if (live.current) setStorageError(false);
        })
        .catch(() => {
          if (live.current) setStorageError(true);
        });
  };
  const close = () => {
    if (!serverBusy) {
      Keyboard.dismiss();
      c.back();
    }
  };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (picking) setPicking(false);
      else close();
      return true;
    });
    return () => sub.remove();
  });
  const clear = async () => {
    if (owner)
      await removeCreateIslandDraft(owner).catch(() => {
        if (live.current) setStorageError(true);
      });
  };
  const submit = () => {
    if (!ready || serverBusy || !draft.name.trim()) return;
    Keyboard.dismiss();
    if (c.server) {
      c.run(async () => {
        await c.server!.create({
          name: draft.name.trim(),
          intro: draft.intro.trim() || undefined,
          approvalRequired: draft.approval,
          maxMembers: draft.capacity,
        });
        await clear();
        if (live.current) c.setServerDone(draft.name.trim());
      });
    } else {
      c.act('CREATE_ISLAND', {
        name: draft.name,
        intro: draft.intro,
        approval: draft.approval,
        capacity: draft.capacity,
      });
      void clear();
      c.go('arrival');
    }
  };
  const top = layout.compact
    ? layout.insets.top + P.space[3]
    : Math.max(D.backdropHeight, layout.insets.top + P.size.tapMin);
  const items = Array.from({ length: CAPACITY_MAX - CAPACITY_MIN + 1 }, (_, n) =>
    t('onboarding.createIsland.capacityUnit', { count: n + CAPACITY_MIN }),
  );
  const field = (name: 'name' | 'intro', max: number, optional = false) => (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Txt style={styles.label}>{t(`onboarding.createIsland.${name}Label`)}</Txt>
        <Txt style={styles.meta}>
          {t(optional ? 'onboarding.createIsland.optional' : 'onboarding.createIsland.required')}
        </Txt>
      </View>
      <TextInput
        accessibilityLabel={t(`onboarding.createIsland.${name}Label`)}
        testID={`create-island-${name}`}
        value={draft[name]}
        editable={ready && !serverBusy}
        maxLength={max}
        onChangeText={(value) => update({ [name]: clampCodePoints(value, max) })}
        placeholder={t(`onboarding.createIsland.${name}Placeholder`)}
        placeholderTextColor={S.color.textMuted}
        multiline={optional}
        textAlignVertical={optional ? 'top' : 'center'}
        style={[styles.input, optional && styles.intro]}
      />
      <CharCount value={draft[name]} max={max} />
    </View>
  );
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Pic id="island/whole" w="100%" h="100%" cover />
      </View>
      <Pressable
        testID="create-island-backdrop"
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        disabled={serverBusy}
        onPress={close}
        style={[StyleSheet.absoluteFill, styles.backdrop]}
      >
        {!layout.compact && (
          <Txt style={[styles.backLabel, { top: layout.insets.top + P.space[6] }]}>
            {t('onboarding.createIsland.returnPrevious')}
          </Txt>
        )}
      </Pressable>
      <View
        style={[
          styles.sheet,
          {
            top,
            left: layout.tablet ? (layout.width - layout.modalWidth) / 2 : layout.insets.left,
            right: layout.tablet ? (layout.width - layout.modalWidth) / 2 : layout.insets.right,
          },
        ]}
      >
        <View style={styles.header}>
          <Txt accessibilityRole="header" style={styles.title}>
            {t('onboarding.createIsland.title')}
          </Txt>
          <NavBtn close disabled={serverBusy} label={t('common.close')} onPress={close} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {serverDone ? (
            <View style={styles.field}>
              <Txt style={styles.title}>{t('onboarding.createIsland.doneTitle')}</Txt>
              <Txt style={styles.meta}>
                {t('onboarding.createIsland.doneSub', { island: serverDone })}
              </Txt>
              {c.enterHome()}
            </View>
          ) : (
            <>
              <Txt style={styles.meta}>{t('onboarding.createIsland.description')}</Txt>
              {field('name', ISLAND_NAME_MAX)}
              {field('intro', ISLAND_INTRO_MAX, true)}
              <View style={styles.field}>
                <Txt style={styles.label}>
                  {t('onboarding.createIsland.capacityLabel', { max: CAPACITY_MAX })}
                </Txt>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('onboarding.createIsland.capacityA11y')}
                  disabled={!ready || serverBusy}
                  onPress={() => setPicking(true)}
                  style={styles.capacity}
                >
                  <Txt style={styles.body}>{items[draft.capacity - CAPACITY_MIN]}</Txt>
                  <Txt style={styles.body}>⌄</Txt>
                </Pressable>
              </View>
              <View style={styles.approval}>
                <View style={{ flex: 1, gap: P.space[1] }}>
                  <Txt style={styles.label}>{t('onboarding.createIsland.approvalAfterJoin')}</Txt>
                  <Txt style={styles.meta}>{t('onboarding.createIsland.approvalAfterJoinSub')}</Txt>
                </View>
                <Toggle
                  value={draft.approval}
                  onChange={(approval: boolean) => update({ approval })}
                  disabled={!ready || serverBusy}
                  activeColor={S.color.primary}
                  label={t('onboarding.createIsland.approvalAfterJoin')}
                />
              </View>
            </>
          )}
          {c.serverError ? (
            <Txt accessibilityRole="alert" style={[styles.meta, { color: S.color.danger }]}>
              {c.serverError}
            </Txt>
          ) : null}
          {/* 생성이 끝난 뒤의 초안 삭제 실패는 입력과 무관하므로 완료 화면에 띄우지 않는다 */}
          {storageError && !serverDone ? (
            <Txt accessibilityRole="alert" style={[styles.meta, { color: S.color.danger }]}>
              {t('onboarding.createIsland.draftError')}
            </Txt>
          ) : null}
        </ScrollView>
        {!serverDone && (
          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(P.space[5], layout.insets.bottom + P.space[3]) },
            ]}
          >
            <Txt style={[styles.meta, { textAlign: 'center' }]}>
              {t(
                owner && !storageError
                  ? 'onboarding.createIsland.draftHint'
                  : 'onboarding.createIsland.draftUnavailable',
              )}
            </Txt>
            <Btn
              id="create-island-submit"
              title={t('onboarding.createIsland.submit')}
              dynamicHeight
              font={systemFont}
              disabled={!ready || !draft.name.trim() || serverBusy}
              onPress={submit}
            />
          </View>
        )}
      </View>
      {picking && (
        <Overlay close={() => setPicking(false)}>
          <Wheel
            a11yLabel={t('onboarding.createIsland.capacityA11y')}
            items={items}
            value={items[draft.capacity - CAPACITY_MIN]}
            onChange={(value: string) => update({ capacity: items.indexOf(value) + CAPACITY_MIN })}
          />
          <Btn title={t('common.ok')} onPress={() => setPicking(false)} />
        </Overlay>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: S.color.canvas },
  backdrop: { backgroundColor: S.color.overlay },
  backLabel: {
    position: 'absolute',
    left: P.space[5],
    right: P.space[5],
    textAlign: 'center',
    fontFamily: systemFont,
    color: P.color.white,
    fontWeight: P.fontWeight.bold,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: S.color.canvas,
    borderTopLeftRadius: P.radius.sheet,
    borderTopRightRadius: P.radius.sheet,
    overflow: 'hidden',
  },
  header: { padding: P.space[5], flexDirection: 'row', alignItems: 'center', gap: P.space[3] },
  title: {
    flexShrink: 1,
    flexGrow: 1,
    fontFamily: systemFont,
    fontSize: P.fontSize.xl,
    lineHeight: P.space[8] + P.space[1],
    fontWeight: P.fontWeight.bold,
  },
  content: { paddingHorizontal: P.space[5], paddingBottom: P.space[6], gap: P.space[5] },
  field: { gap: P.space[2] },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: P.space[2],
  },
  label: {
    fontFamily: systemFont,
    fontSize: P.fontSize.sm,
    lineHeight: P.space[5],
    fontWeight: P.fontWeight.bold,
  },
  meta: {
    fontFamily: systemFont,
    fontSize: P.fontSize.sm,
    lineHeight: P.space[5],
    color: S.color.textMuted,
  },
  body: { fontFamily: systemFont, fontSize: P.fontSize.md, lineHeight: P.space[6] },
  input: {
    minHeight: D.controlHeight,
    borderWidth: S.stroke.default,
    borderColor: S.color.outline,
    borderRadius: S.radius.control,
    backgroundColor: S.color.surface,
    paddingHorizontal: P.space[4],
    paddingVertical: P.space[3],
    fontFamily: systemFont,
    fontSize: P.fontSize.md,
    lineHeight: P.space[6],
    color: S.color.text,
  },
  intro: { minHeight: D.introHeight },
  capacity: {
    minHeight: D.controlHeight,
    borderWidth: S.stroke.default,
    borderColor: S.color.outline,
    borderRadius: S.radius.control,
    padding: P.space[4],
    backgroundColor: S.color.surface,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  approval: {
    padding: P.space[5],
    borderRadius: S.radius.card,
    backgroundColor: S.color.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: P.space[3],
  },
  footer: {
    paddingHorizontal: P.space[5],
    paddingTop: P.space[3],
    gap: P.space[3],
    borderTopWidth: S.stroke.subtle,
    borderTopColor: P.color.progressTrack,
  },
});
