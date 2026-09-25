import React from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { villageAssets } from '@/constants/village-assets';
import { Text } from '@/design-system/typography';
import { semanticTokens } from '@/design-system/tokens';

/** 게시판은 정지 이미지로 유지하고 새 소식이 있을 때만 표시를 붙인다. */
export function VillageBoardIndicator({
  hasUnread = false,
  hasNewComment = false,
  indicatorScale = 1,
  style,
  testID = 'village-board-indicator',
}: {
  hasUnread?: boolean;
  hasNewComment?: boolean;
  indicatorScale?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const hasNotice = hasUnread || hasNewComment;

  return (
    <View testID={testID} pointerEvents="none" style={[styles.root, style]}>
      <Image
        testID="village-board-still-image"
        source={villageAssets['notice-board.png']}
        resizeMode="stretch"
        style={styles.frame}
      />
      {hasNotice && (
        <View
          testID="village-board-new-indicator"
          accessibilityLabel={hasNewComment ? '새 댓글이 있습니다' : '읽지 않은 새 소식이 있습니다'}
          style={[
            styles.badge,
            {
              width: 25 * indicatorScale,
              height: 25 * indicatorScale,
              top: -11 * indicatorScale,
              right: 21 * indicatorScale,
              borderRadius: 13 * indicatorScale,
            },
          ]}
        >
          <Text style={[styles.badgeText, { fontSize: 17 * indicatorScale }]}>!</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: semanticTokens.color.accent,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
  },
  badgeText: { color: semanticTokens.color.text, fontWeight: '800', lineHeight: 20, textAlign: 'center' },
});
