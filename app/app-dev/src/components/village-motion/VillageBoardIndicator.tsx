import React, { type ReactNode } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import { villageAssets } from '@/constants/village-assets';
import { semanticTokens } from '@/design-system/tokens';
import { VillageNotificationBadge } from './VillageNotificationBadge';

/** 게시판은 정지 이미지로 유지하고 새 소식이 있을 때만 표시를 붙인다. */
export function VillageBoardIndicator({
  hasUnread = false,
  hasNewComment = false,
  tooltip,
  showBoardImage = true,
  indicatorScale = 1,
  style,
  testID = 'village-board-indicator',
}: {
  hasUnread?: boolean;
  hasNewComment?: boolean;
  tooltip?: ReactNode;
  showBoardImage?: boolean;
  indicatorScale?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const hasNotice = hasUnread || hasNewComment;

  return (
    <View testID={testID} pointerEvents="none" style={[styles.root, style]}>
      {showBoardImage && (
        <Image
          testID="village-board-still-image"
          source={villageAssets['notice-board.png']}
          resizeMode="stretch"
          style={styles.frame}
        />
      )}
      {hasNotice && (
        <VillageNotificationBadge
          testID="village-board-new-indicator"
          accessibilityLabel={hasNewComment ? '새 댓글이 있습니다' : '읽지 않은 새 소식이 있습니다'}
          scale={indicatorScale}
          style={{ top: -11 * indicatorScale, right: 21 * indicatorScale }}
        />
      )}
      {hasNotice && tooltip != null && (
        <View testID="village-board-tooltip" style={styles.tooltip}>
          {tooltip}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', height: '100%', position: 'relative' },
  frame: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  tooltip: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: '100%',
    maxWidth: 180,
    paddingHorizontal: semanticTokens.spacing.control,
    paddingVertical: 8,
    backgroundColor: semanticTokens.color.surface,
    borderColor: semanticTokens.color.outline,
    borderWidth: 1.5,
    borderRadius: semanticTokens.radius.control,
  },
});
