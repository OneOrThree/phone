import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Btn, Txt, k } from '@/design-system/patterns';
import { TextInput } from '@/design-system/typography';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { useGowun } from '@/screens/island/sceneKit';
import { useTelescope } from '@/screens/island/useTelescope';
import { Ticking } from '@/hooks/useNow';
import { seaClock } from '@/screens/sea/seaModel';
import { seaAssets } from '@/screens/sea/seaAssets';
import { updateProfile } from '@/services/api/account';
import { sessionGeneration } from '@/services/api/session';
import { uuid } from '@/services/api/client';
import type { TelescopeItem } from '@/services/api/telescope';
import { colorName, colors, sessionRoute, type Color, type State } from '@/services/model';
import { errorTextOr, t } from '@/i18n';
import {
  firstStoryStep,
  nextStoryStep,
  storyHasLine,
  storyPose,
  storySteps,
  type StoryStep,
} from './story';
import { StoryRaft, storyIslandArt, storyCats } from './StoryRaft';
import { useStoryLine } from './useStoryLine';

const ui = componentTokens.onboarding;
const { space } = primitiveTokens;
const c = semanticTokens.color;

/** character 라우트의 신규 계정 흐름. profile 완료와 story 완료를 별도로 보관한다. */
export function OnboardingFlow({ e, previewItems }: { e: any; previewItems?: TelescopeItem[] }) {
  const state: State = e.state;
  const layout = useAppLayout();
  const fontFamily = useGowun();
  const [step, setStep] = useState<StoryStep>(() => firstStoryStep(state.onboardingStory));
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState<Color>(state.color);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [departing, setDeparting] = useState<TelescopeItem | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const skipAfterName = useRef(false);
  const profileSaved = useRef(false);
  const requestLock = useRef(false);
  const profileIntent = useRef<{ signature: string; key: string } | null>(null);
  const mounted = useRef(true);
  const latest = useRef(e);
  latest.current = e;
  const list = useTelescope({ active: !!e.islands && ['scope', 'ready'].includes(step) });
  const items = previewItems ?? list.items;
  const selected =
    step === 'depart' ? departing : items.find((item) => item.islandId === selectedId);
  const line = storyHasLine(step) ? t(`onboardingStory.${step}`, { name }) : '';
  const typing = useStoryLine(step, line);
  const scroll = useRef<ScrollView>(null);
  const width = Math.min(layout.width, ui.maxWidth);
  const large = (layout.fontScale ?? 1) > 1.3;
  const height = Math.max(layout.height, large ? 1120 : 740);
  const top = Math.max(layout.insets.top, space[10]);
  const bottom = Math.max(layout.insets.bottom, space[8]);
  const position = (fraction: number) => height * fraction;
  const font = { fontFamily };
  const nameStep = step === 'name';
  const scopeStep = step === 'scope' || step === 'ready';
  const pose = storyPose(step, typing.complete);
  const hasCta = ['name', 'invite', 'scopeIntro', 'ready', 'depart'].includes(step);
  const canAdvance = !hasCta && !['choose', 'arrival', 'scope'].includes(step);
  const move = (next: StoryStep) => {
    setError('');
    setStep(next);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const checkpoint = (value: 'intro' | 'scope' | 'done') =>
    latest.current.dispatch({ type: 'ONBOARDING_STORY', checkpoint: value });
  useEffect(() => {
    mounted.current = true;
    if (!latest.current.state.onboardingStory) checkpoint('intro');
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (step !== 'arrival') return;
    const timer = setTimeout(() => setStep('silence'), ui.introDelay);
    return () => clearTimeout(timer);
  }, [step]);
  useEffect(() => {
    if (step === 'ready' && !selected) setStep('scope');
  }, [step, selected]);
  // 출항 완료 직후 강제 종료됐으면 서버가 복구한 세션으로 돌아간다. 이 화면의 타이머는 정본이 아니다.
  const enterSea = () => {
    const session = latest.current.state.session;
    latest.current.reset(session ? sessionRoute(session) : 'sea', selected?.name);
  };
  const scope = () => {
    checkpoint('scope');
    move('scopeIntro');
  };
  const skip = () => {
    if (pending) return;
    // 선택한 고양이도 아직 서버에 저장하지 않았으므로 이름 화면을 반드시 거친다.
    if (profileSaved.current) return scope();
    skipAfterName.current = true;
    move('name');
  };
  const saveName = async () => {
    const value = name.trim();
    if (!value) {
      setError(t('onboardingStory.nameEmpty'));
      return;
    }
    if (requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setError('');
    const gen = sessionGeneration();
    const live = () => mounted.current && sessionGeneration() === gen;
    const signature = JSON.stringify([value, color]);
    if (profileIntent.current?.signature !== signature)
      profileIntent.current = { signature, key: uuid() };
    try {
      const saved = e.islands
        ? await updateProfile({ name: value, catColor: color }, profileIntent.current.key)
        : { name: value, catColor: color };
      if (!live()) return;
      profileIntent.current = null;
      profileSaved.current = true;
      const savedName = saved.name ?? value;
      latest.current.dispatch({ type: 'PROFILE', name: savedName, color: saved.catColor ?? color });
      setName(savedName);
      if (skipAfterName.current) {
        skipAfterName.current = false;
        scope();
      } else move('greet');
    } catch (thrown) {
      if (live()) setError(errorTextOr(thrown, 'errors.GENERIC'));
    } finally {
      requestLock.current = false;
      if (live()) setPending(false);
    }
  };
  const start = async () => {
    if (!selected || requestLock.current) return;
    requestLock.current = true;
    setPending(true);
    setError('');
    const gen = sessionGeneration();
    const live = () => mounted.current && sessionGeneration() === gen;
    try {
      if (!e.focus) throw new Error(t('onboardingStory.startPending'));
      const session = await e.focus.startSea(selected.islandId);
      if (!live()) return;
      // startSea 는 응답 유실 재시도에서 최신 current(null 포함)를 돌려준다.
      checkpoint('done');
      if (!session || session.kind !== 'sea') {
        latest.current.reset(session ? sessionRoute(session) : 'sea');
        return;
      }
      if (session.islandId !== selected.islandId) {
        latest.current.reset('sea');
        return;
      }
      // 목록 훅은 망원경을 닫으면 빈 목록을 돌려주므로 출항 목적지는 별도로 보관한다.
      setDeparting(selected);
      move('depart');
    } catch (thrown) {
      if (!live()) return;
      const code = (thrown as { code?: string }).code;
      if (code === 'STATE_CONFLICT') {
        const restored = await e.focus.recover().catch(() => null);
        if (!live()) return;
        if (restored) {
          checkpoint('done');
          latest.current.reset(restored);
          return;
        }
      }
      if (code === 'SEA_DESTINATION_UNAVAILABLE') {
        setSelectedId(null);
        list.reload();
        move('scope');
      }
      setError(errorTextOr(thrown, 'telescope.sailFailed'));
    } finally {
      requestLock.current = false;
      if (live()) setPending(false);
    }
  };
  const back = useRef<() => boolean>(() => false);
  back.current = () => {
    if (pending) return true;
    if (step === 'depart') {
      enterSea();
      return true;
    }
    if (step === 'choose') return false;
    if (step === 'scopeIntro') return true; // 체크포인트 이전으로 되돌려 프로필을 재저장하지 않는다
    if (step === 'scope' || step === 'ready') {
      move(step === 'ready' ? 'scope' : 'scopeIntro');
      return true;
    }
    move(storySteps[Math.max(0, storySteps.indexOf(step) - 1)]);
    return true;
  };
  useEffect(() => {
    if (!e.backOverride) return;
    const handler = () => back.current();
    e.backOverride.current = handler;
    return () => {
      if (e.backOverride.current === handler) e.backOverride.current = null;
    };
  }, [e.backOverride]);
  useEffect(() => {
    if (typing.complete && line) AccessibilityInfo.announceForAccessibility(line);
  }, [typing.complete, line]);
  const advance = () => {
    if (!typing.complete) typing.finish();
    else if (canAdvance) move(nextStoryStep(step));
  };
  const choose = () => {
    profileSaved.current = false;
    latest.current.dispatch({ type: 'PROFILE', color });
    move('arrival');
  };
  const cta = () => {
    if (nameStep) return saveName();
    if (step === 'invite') return scope();
    if (step === 'scopeIntro') return move('scope');
    if (step === 'ready') return start();
    if (step === 'depart') return enterSea();
  };
  const ctaText = nameStep
    ? pending
      ? 'saving'
      : 'nameCta'
    : step === 'invite'
      ? 'join'
      : step === 'scopeIntro'
        ? 'scopeCta'
        : step === 'ready'
          ? pending
            ? 'startPending'
            : 'start'
          : 'enterSea';

  if (step === 'choose')
    return (
      <ScrollView
        testID="onboarding-choose"
        contentContainerStyle={[styles.choosePage, { paddingTop: top, paddingBottom: bottom }]}
      >
        <Btn
          kind="ghost"
          title={t('onboardingStory.back')}
          onPress={e.back}
          style={{ alignSelf: 'flex-start' }}
        />
        <Txt accessibilityRole="header" style={[styles.heading, font]}>
          {t('onboardingStory.choose')}
        </Txt>
        <Txt style={[styles.muted, font]}>{t('onboardingStory.chooseHint')}</Txt>
        <View style={styles.catGrid}>
          {colors.map((cat) => (
            <Pressable
              key={cat}
              testID={`onboarding-cat-${cat}`}
              accessibilityRole="radio"
              accessibilityLabel={colorName(colors.indexOf(cat))}
              accessibilityState={{ checked: color === cat, selected: color === cat }}
              onPress={() => setColor(cat)}
              style={[styles.catCard, color === cat && styles.selected]}
            >
              <Image
                source={storyCats[cat]}
                resizeMode="contain"
                style={{ width: ui.catSize, height: ui.catSize }}
              />
              <Txt style={font}>{colorName(colors.indexOf(cat))}</Txt>
              {color === cat && (
                <Txt style={styles.check} accessible={false}>
                  ✓
                </Txt>
              )}
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        <Txt style={[styles.center, font]}>
          {t('onboardingStory.selectedCat', { color: colorName(colors.indexOf(color)) })}
        </Txt>
        <Btn
          id="onboarding-choose-next"
          dynamicHeight
          title={t('onboardingStory.chooseCta')}
          onPress={choose}
        />
      </ScrollView>
    );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center' }}
      >
        <View
          testID={`onboarding-${step}${step === 'name' ? '-scene' : ''}`}
          style={{ width, minHeight: height, backgroundColor: c.secondary }}
        >
          <Image
            source={seaAssets.background}
            resizeMode="cover"
            style={[StyleSheet.absoluteFill, { width, height }]}
            accessible={false}
          />
          {line !== '' && (
            <Pressable
              testID="onboarding-scene-tap"
              accessible={false}
              onPress={advance}
              style={StyleSheet.absoluteFill}
            />
          )}
          {step !== 'arrival' && (
            <Image
              source={seaAssets.gulls}
              resizeMode="contain"
              style={{
                position: 'absolute',
                top: height * 0.08,
                left: width * 0.16,
                width: space[16],
                height: space[8],
              }}
              accessible={false}
            />
          )}
          {line !== '' && (
            <Pressable
              testID="onboarding-advance"
              accessibilityRole="button"
              accessibilityLabel={line}
              accessibilityHint={t('onboardingStory.next')}
              onPress={advance}
              style={[
                styles.bubble,
                {
                  top: position(
                    scopeStep ? 0.16 : nameStep ? 0.3 : step === 'depart' ? 0.4 : ui.bubbleTop,
                  ),
                  maxWidth: width - space[12],
                  minWidth: ui.shortBubbleMin,
                  alignSelf: 'center',
                },
              ]}
            >
              <Txt accessible={false} style={[styles.line, font]}>
                {typing.text || ' '}
              </Txt>
              {!scopeStep && <View style={styles.tail} />}
            </Pressable>
          )}
          {!['arrival', 'scopeIntro', 'scope', 'ready', 'depart'].includes(step) && (
            <View style={{ position: 'absolute', top, right: space[4] }}>
              <Btn
                id="onboarding-skip"
                kind="ghost"
                title={t('onboardingStory.skip')}
                disabled={pending}
                onPress={skip}
              />
            </View>
          )}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: position(nameStep ? 0.46 : scopeStep ? 0.65 : ui.raftTop),
            }}
          >
            <StoryRaft color={color} pose={pose} width={width * (nameStep ? 0.55 : ui.raftWidth)} />
          </View>
          {scopeStep && (
            <View style={{ position: 'absolute', top: position(0.32), left: 0, right: 0 }}>
              {!previewItems && list.status === 'loading' ? (
                <Txt style={[styles.center, font]}>{t('onboardingStory.loading')}</Txt>
              ) : !previewItems && list.status === 'error' ? (
                <View style={styles.feedback}>
                  <Txt style={font}>{errorTextOr(list.error, 'telescope.loadFailed')}</Txt>
                  <Btn title={t('onboardingStory.retry')} onPress={list.reload} />
                </View>
              ) : items.length === 0 ? (
                <View style={styles.feedback}>
                  <Txt style={font}>{t('onboardingStory.empty')}</Txt>
                  <Btn title={t('onboardingStory.retry')} onPress={list.reload} />
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  contentContainerStyle={styles.islands}
                >
                  {items.map((item) => (
                    <Pressable
                      key={item.islandId}
                      testID={`onboarding-island-${item.islandId}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('onboardingStory.destination', {
                        name: item.name,
                        minutes: item.sailingMinutes,
                      })}
                      accessibilityState={{
                        selected: selectedId === item.islandId,
                        disabled: pending,
                      }}
                      disabled={pending}
                      onPress={() => {
                        setSelectedId(item.islandId);
                        move('ready');
                      }}
                      style={styles.island}
                    >
                      <Image
                        source={storyIslandArt}
                        style={{ width: width / 3, height: width / 3 }}
                        resizeMode="contain"
                      />
                      <Txt
                        style={[
                          styles.islandLabel,
                          font,
                          selectedId === item.islandId && styles.selected,
                        ]}
                      >
                        {t('onboardingStory.islandLabel', {
                          name: item.name,
                          minutes: item.sailingMinutes,
                        })}
                      </Txt>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
              {step === 'ready' && selected && (
                <View style={styles.destination}>
                  <Txt style={[styles.center, font]}>
                    {t('onboardingStory.destination', {
                      name: selected.name,
                      minutes: selected.sailingMinutes,
                    })}
                  </Txt>
                </View>
              )}
            </View>
          )}
          {step === 'depart' && selected && (
            <View style={{ position: 'absolute', top: position(0.18), alignSelf: 'center' }}>
              <Txt style={[styles.center, font]}>
                {t('onboardingStory.sailing', { name: selected.name })}
              </Txt>
              <Txt style={styles.clock}>
                <Ticking>
                  {(now) =>
                    seaClock(
                      (state.session?.seconds ?? 0) +
                        Math.max(
                          0,
                          Math.floor(
                            (now -
                              (state.session?.syncedAt ?? state.session?.startedAt ?? Date.now())) /
                              1000,
                          ),
                        ),
                    )
                  }
                </Ticking>
              </Txt>
              <Txt style={[styles.center, font]}>
                {t('onboardingStory.duration', { minutes: selected.sailingMinutes })}
              </Txt>
            </View>
          )}
          {hasCta && typing.complete && (
            <View style={[styles.footer, { bottom }, nameStep && styles.namePanel]}>
              {nameStep && (
                <>
                  <Txt style={font}>{t('onboardingStory.nameLabel')}</Txt>
                  <TextInput
                    testID="onboarding-name"
                    accessibilityLabel={t('onboardingStory.nameLabel')}
                    placeholder={t('onboardingStory.namePlaceholder')}
                    style={[k.field, font]}
                    value={name}
                    editable={!pending}
                    onChangeText={setName}
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                    onFocus={() => scroll.current?.scrollToEnd({ animated: true })}
                  />
                </>
              )}
              {!!error && (
                <Txt accessibilityRole="alert" style={styles.error}>
                  {error}
                </Txt>
              )}
              <Btn
                id="onboarding-continue"
                dynamicHeight
                title={t(`onboardingStory.${ctaText}`)}
                disabled={pending || (nameStep && !name.trim()) || (step === 'ready' && !selected)}
                onPress={cta}
              />
            </View>
          )}
          {error && !hasCta ? (
            <View style={[styles.footer, { bottom }]}>
              <Txt accessibilityRole="alert" style={styles.error}>
                {error}
              </Txt>
            </View>
          ) : null}
          {canAdvance && (
            <View style={[styles.footer, { bottom }]}>
              <Btn kind="ghost" dynamicHeight title={t('onboardingStory.next')} onPress={advance} />
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.secondary },
  choosePage: {
    flexGrow: 1,
    maxWidth: ui.maxWidth,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: space[6],
    gap: space[4],
    backgroundColor: c.canvas,
  },
  heading: { fontSize: primitiveTokens.fontSize.xl, lineHeight: space[10], color: c.text },
  muted: { color: c.textMuted },
  center: { textAlign: 'center' },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginVertical: space[8] },
  catCard: {
    width: '31%',
    minHeight: ui.catCardHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: semanticTokens.radius.card,
    borderWidth: semanticTokens.stroke.default,
    borderColor: c.divider,
    backgroundColor: c.surface,
  },
  selected: { borderColor: c.outline, backgroundColor: c.selected },
  check: { position: 'absolute', right: space[2], top: space[2], color: c.outline },
  bubble: {
    position: 'absolute',
    padding: space[6],
    borderWidth: semanticTokens.stroke.default,
    borderColor: c.outline,
    borderRadius: ui.bubbleRadius,
    backgroundColor: c.surface,
    zIndex: 2,
  },
  line: { fontSize: ui.bubbleFontSize, lineHeight: ui.bubbleLineHeight, textAlign: 'center' },
  tail: {
    position: 'absolute',
    bottom: -space[3],
    width: space[5],
    height: space[5],
    alignSelf: 'center',
    transform: [{ rotate: '45deg' }],
    backgroundColor: c.surface,
    borderRightWidth: semanticTokens.stroke.default,
    borderBottomWidth: semanticTokens.stroke.default,
    borderColor: c.outline,
  },
  footer: { position: 'absolute', left: space[6], right: space[6], gap: space[3] },
  namePanel: {
    padding: space[5],
    borderRadius: semanticTokens.radius.modal,
    backgroundColor: c.canvas,
    borderWidth: semanticTokens.stroke.default,
    borderColor: c.outline,
  },
  error: { color: c.danger },
  feedback: { padding: space[6], gap: space[3] },
  islands: { paddingHorizontal: space[2], gap: space[2] },
  island: { alignItems: 'center' },
  islandLabel: {
    padding: space[2],
    maxWidth: ui.canvasWidth / 3,
    borderRadius: semanticTokens.radius.control,
    backgroundColor: c.surface,
  },
  destination: {
    margin: space[6],
    padding: space[4],
    borderRadius: semanticTokens.radius.card,
    backgroundColor: c.surface,
  },
  clock: {
    fontSize: primitiveTokens.fontSize.display,
    lineHeight: space[12],
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
});
