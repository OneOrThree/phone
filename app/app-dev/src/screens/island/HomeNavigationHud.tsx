import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Txt } from '@/design-system/patterns';
import { CatAvatar } from '@/components/CatAvatar';
import type { Outfit } from '@/components/CatOutfitLayers';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { RowIcon } from './IslandSheet';
import { t } from '@/i18n';
import type { Color, Route } from '@/services/model';

const c = componentTokens.homeNavigation;

/** 왼쪽 위 내 고양이 — 누르면 꾸미기. 홈(프로필 패널 안)과 바다 표류(GROMO-2404)가 같은 모양을 쓴다. */
export function HudAvatarButton({
  color,
  outfit,
  go,
}: {
  color: Color;
  outfit?: Outfit;
  go: (route: Route) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('home.hud.customize')}
      onPress={() => go('wardrobe')}
      style={styles.avatarButton}
    >
      <View style={styles.avatar}>
        <CatAvatar
          color={color}
          outfit={outfit}
          size={c.avatarSize - 2 * semanticTokens.stroke.default}
        />
      </View>
    </Pressable>
  );
}

/** 오른쪽 위 친구(받은 요청 수 배지)·설정 둥근 버튼. 홈과 바다 표류가 같이 쓴다. */
export function HudActions({ requests, go }: { requests: number; go: (route: Route) => void }) {
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          requests ? t('home.hud.friendsRequests', { count: requests }) : t('home.hud.friends')
        }
        onPress={() => go('friends')}
        style={styles.action}
      >
        <RowIcon name="group" />
        {requests > 0 && (
          <View style={styles.badge} pointerEvents="none" accessible={false}>
            <Txt style={styles.badgeText}>{requests > 99 ? '99+' : requests}</Txt>
          </View>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('home.hud.settings')}
        onPress={() => go('settings')}
        style={styles.action}
      >
        <RowIcon name="gear" />
      </Pressable>
    </View>
  );
}

/** 프로필·섬 정보는 한 표면에, 친구·설정은 같은 중심선에 둔다. */
export function HomeNavigationHud({
  name,
  clock,
  color,
  outfit,
  requests,
  go,
  interactive = true,
}: {
  name: string;
  clock: string;
  color: Color;
  outfit?: Outfit;
  requests: number;
  go: (route: Route) => void;
  interactive?: boolean;
}) {
  return (
    <View style={styles.row} pointerEvents={interactive ? 'auto' : 'none'}>
      <View style={styles.profile} testID="home-profile-panel">
        {interactive && <HudAvatarButton color={color} outfit={outfit} go={go} />}
        <View
          accessible
          accessibilityLabel={t('home.a11y.todayFocusClock', { name, clock })}
          style={styles.info}
        >
          <Txt numberOfLines={1} ellipsizeMode="tail" style={styles.title}>
            {name}
          </Txt>
          <Txt style={styles.clock}>{t('home.hud.todayFocusWithClock', { clock })}</Txt>
        </View>
      </View>
      {interactive && <HudActions requests={requests} go={go} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: c.gap, width: '100%' },
  profile: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: c.gap,
    paddingVertical: c.paddingVertical,
    paddingHorizontal: c.paddingHorizontal,
    backgroundColor: c.background,
    borderWidth: semanticTokens.stroke.subtle,
    borderColor: c.border,
    borderRadius: c.radius,
  },
  avatarButton: {
    width: semanticTokens.size.tapMin,
    height: semanticTokens.size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    overflow: 'hidden',
    borderRadius: semanticTokens.radius.full,
    borderWidth: semanticTokens.stroke.default,
    borderColor: semanticTokens.color.outline,
    backgroundColor: semanticTokens.color.surface,
  },
  info: { flex: 1, minWidth: 0 },
  title: {
    fontSize: c.titleSize,
    lineHeight: c.titleSize * 1.4,
    fontWeight: semanticTokens.typography.semibold,
  },
  clock: {
    fontSize: c.clockSize,
    lineHeight: c.clockSize * 1.4,
    fontWeight: semanticTokens.typography.regular,
    fontVariant: ['tabular-nums'],
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: c.gap },
  action: {
    width: semanticTokens.size.tapMin,
    height: semanticTokens.size.tapMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: semanticTokens.radius.full,
    backgroundColor: componentTokens.button.glassBackground,
    borderWidth: semanticTokens.stroke.default,
    borderColor: semanticTokens.color.outline,
    boxShadow: `0px ${c.shadowOffset}px 0px ${c.shadowColor}`,
  },
  badge: {
    position: 'absolute',
    right: c.badgeOffset,
    top: c.badgeOffset,
    minWidth: c.badgeSize,
    minHeight: c.badgeSize,
    paddingHorizontal: c.paddingVertical,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: semanticTokens.radius.full,
    backgroundColor: semanticTokens.color.primary,
    borderWidth: semanticTokens.stroke.subtle,
    borderColor: semanticTokens.color.outline,
  },
  badgeText: {
    fontSize: c.clockSize,
    lineHeight: c.badgeSize,
    fontWeight: semanticTokens.typography.bold,
  },
});
