import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { NavBtn, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { useAppLayout } from '@/utils/layout';
import { t } from '@/i18n';
import Svg, { Path } from 'react-native-svg';
import { ObservatoryIslandPortrait } from './ObservatoryIslandPortrait';
import { ObservatoryOcean, ObservatoryRaft } from './ObservatoryScenery';
import { GOWUN, useGowun } from './sceneKit';

const token = componentTokens.observatory;
const color = semanticTokens.color;
const type = semanticTokens.typography;
const styles = StyleSheet.create({
  room: { flex: 1 },
  background: { backgroundColor: color.secondary },
  fixedHeader: {
    width: '100%',
    maxWidth: token.contentMaxWidth,
    alignSelf: 'center',
    paddingHorizontal: token.pagePadding,
    paddingBottom: token.rowPadding,
  },
  ledger: {
    backgroundColor: color.canvas,
    borderColor: color.outline,
    borderWidth: semanticTokens.stroke.strong,
    borderRadius: semanticTokens.radius.card,
    boxShadow: token.paperShadow,
    paddingHorizontal: token.paperPadding,
    paddingVertical: token.introGap,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: token.rowGap,
    paddingHorizontal: token.pagePadding,
    paddingVertical: token.rowPadding,
  },
  toolbarTitle: {
    fontFamily: GOWUN,
    flex: 1,
    fontWeight: type.bold,
    color: color.text,
    fontSize: token.toolbarSize,
    lineHeight: token.toolbarLineHeight,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: token.pagePadding,
    gap: token.sectionGap,
    alignSelf: 'center',
    width: '100%',
    maxWidth: token.contentMaxWidth,
  },
  heading: { paddingTop: token.rowPadding },
  title: {
    fontFamily: GOWUN,
    fontSize: token.headingSize,
    lineHeight: token.headingLineHeight,
    fontWeight: type.extraBold,
    color: color.text,
  },
  row: {
    minHeight: token.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: token.rowGap,
    paddingVertical: token.rowPadding,
    borderBottomWidth: semanticTokens.stroke.subtle,
    borderBottomColor: color.divider,
  },
  current: {
    backgroundColor: color.subtle,
    borderBottomColor: 'transparent',
    borderRadius: semanticTokens.radius.control,
  },
  body: { flex: 1, minWidth: 0, gap: token.introGap },
  name: {
    fontFamily: GOWUN,
    fontSize: type.body,
    lineHeight: type.body * 1.45,
    fontWeight: type.bold,
  },
  sub: { fontFamily: GOWUN, color: color.textMuted },
  below: { alignItems: 'flex-start', marginTop: token.introGap },
  pressed: { opacity: 0.7 },
});

/** 검색은 상단에 고정하고, 랭킹과 검색 결과는 동일한 넓은 지면에서 읽는다. */
export function ObservatoryFrame({
  children,
  onBack,
  onClose,
  header,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  const layout = useAppLayout();
  useGowun();
  return (
    <KeyboardAvoidingView
      style={[StyleSheet.absoluteFill, styles.room, styles.background]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ObservatoryOcean />
      <View
        style={[
          styles.room,
          {
            paddingTop: layout.insets.top,
            paddingLeft: layout.insets.left,
            paddingRight: layout.insets.right,
          },
        ]}
      >
        <View style={styles.toolbar}>
          {onBack && <NavBtn label={t('common.back')} onPress={onBack} />}
          <Txt style={styles.toolbarTitle}>{t('observatory.title')}</Txt>
          <NavBtn label={t('common.close')} onPress={onClose} close />
        </View>
        {!!header && <View style={styles.fixedHeader}>{header}</View>}
        <ScrollView
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: layout.insets.bottom + token.sectionGap },
          ]}
        >
          {children}
          <ObservatoryRaft />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

export function ObservatoryLedger({
  children,
  visible = true,
}: {
  children: React.ReactNode;
  visible?: boolean;
}) {
  if (!visible) return null;
  return <View style={styles.ledger}>{children}</View>;
}

export function ObservatoryHeading() {
  return (
    <View style={styles.heading}>
      <Txt accessibilityRole="header" style={styles.title}>
        {t('observatory.searchTitle')}
      </Txt>
    </View>
  );
}

/** 등수·섬·이름 순서로 읽고 평균 시간과 상태 배지는 이름 아래에 둔다. */
export function ObservatoryRow({
  title,
  sub,
  rank,
  average,
  memberCount,
  below,
  label,
  current = false,
  disabled = false,
  onPress,
}: {
  title: string;
  sub?: string;
  rank?: number;
  average?: string;
  memberCount?: number;
  below?: React.ReactNode;
  label: string;
  current?: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      <ObservatoryIslandPortrait rank={rank} memberCount={memberCount} />
      <View style={styles.body}>
        <Txt style={styles.name}>{title}</Txt>
        {!!sub && (
          <Txt kind="meta" style={styles.sub}>
            {sub}
          </Txt>
        )}
        {!!average && (
          <Txt kind="meta" style={styles.sub}>
            {average}
          </Txt>
        )}
        {!!below && <View style={styles.below}>{below}</View>}
      </View>
      {!!onPress && (
        <Svg
          width={token.chevronWidth}
          height={token.chevronHeight}
          viewBox="0 0 16 20"
          accessible={false}
        >
          <Path
            d="m5 5 5 5-5 5"
            fill="none"
            stroke={color.outline}
            strokeWidth={semanticTokens.stroke.strong}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      )}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, current && styles.current, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} style={[styles.row, current && styles.current]}>
      {content}
    </View>
  );
}
