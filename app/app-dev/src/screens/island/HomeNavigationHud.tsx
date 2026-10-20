import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Pic, Txt } from '@/design-system/patterns';
import { componentTokens, semanticTokens } from '@/design-system/tokens';
import { RowIcon } from './IslandSheet';
import { t } from '@/i18n';
import type { Color, Route } from '@/services/model';

const c = componentTokens.homeNavigation;

/** 프로필·섬 정보는 한 표면에, 친구·설정은 같은 중심선에 둔다. */
export function HomeNavigationHud({
  name,
  clock,
  color,
  requests,
  go,
  interactive = true,
}: {
  name: string;
  clock: string;
  color: Color;
  requests: number;
  go: (route: Route) => void;
  interactive?: boolean;
}) {
  return (
    <View style={styles.row} pointerEvents={interactive ? 'auto' : 'none'}>
      <View style={styles.profile} testID="home-profile-panel">
        {interactive && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.hud.customize')}
            onPress={() => go('wardrobe')}
            style={styles.avatarButton}
          >
            <Pic id={'avatar/' + color} w={c.avatarSize} h={c.avatarSize} style={styles.avatar} />
          </Pressable>
        )}
        <View
          accessible
          accessibilityLabel={t('home.a11y.todayFocusClock', { name, clock })}
          style={styles.info}
        >
          <Txt numberOfLines={1} style={styles.title}>
            {name}
          </Txt>
          <Txt style={styles.clock}>{t('home.hud.todayFocusWithClock', { clock })}</Txt>
        </View>
      </View>
      {interactive && (
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
      )}
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
    borderRadius: semanticTokens.radius.full,
    borderWidth: semanticTokens.stroke.default,
    borderColor: semanticTokens.color.outline,
    backgroundColor: semanticTokens.color.surface,
  },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: c.titleSize, lineHeight: c.titleSize * 1.4, fontWeight: '600' },
  clock: {
    fontSize: c.clockSize,
    lineHeight: c.clockSize * 1.4,
    fontWeight: '400',
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
    boxShadow: `0px 2px 0px ${semanticTokens.color.outline}4D`,
  },
  badge: {
    position: 'absolute',
    right: -2,
    top: -2,
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
  badgeText: { fontSize: c.clockSize, lineHeight: c.badgeSize, fontWeight: '700' },
});
