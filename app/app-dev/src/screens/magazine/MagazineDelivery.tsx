import React, { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Btn } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { t } from '@/i18n';
import type { MagazineToday } from '@/services/api/magazine';
import { MAGAZINE_UI } from '@/constants/magazineAssets';
import { GuideBox } from '@/screens/island/NpcGuide';
import { FOCUS_BUTTON_SIZE, focusButtonInset } from '@/screens/island/WorldMap';
import { useAppLayout } from '@/utils/layout';
import { MagazineRack } from './MagazineRack';
import { magazineUnread, markDelivered, sendReceipt, wasDelivered } from './useMagazineToday';

const O = componentTokens.magazineReader.object;

/**
 * 섬 홈의 잡지 배달(GROMO-2289 · B2, 구현계획 5-6).
 *
 * - 오늘 호가 나와 있고 아직 받은 적 없으면 펠리컨이 한 번 알린다. 띄우는 순간 받음(ISLAND)을 보내 다른 기기·다음 실행에서
 *   다시 띄우지 않는다. 구경 중·집중 중·다른 안내가 떠 있으면(blocked) 띄우지 않는다.
 * - 우체통이 있는 섬: 「우체통에 고양이 잡지가 왔어요!」 [나중에] [우체통 열어보기].
 *   우체통이 없는 섬: 「고양이 잡지 왔어요!」 [나중에 읽기] [잡지 펼치기]. 나중에는 「나중에」(deferred)를 적는다.
 * - 우체통이 없는 섬은 가장 최근 호가 있는 동안(발행이 늦어 지난 호뿐이어도) 홈 「집중 시작」 버튼 바로 위에 잡지 물건을 둔다(P20 —
 *   계획의 「왼쪽 아래」는 이른 섬에 늘 있는 건설 카드와 겹쳐 옮겼다). 누르면 그 호, 길게 누르면 꽂이, 지금 호를 안 읽었으면 빨간 점.
 */
export function MagazineHomeLayer({
  today,
  hasMailbox,
  blocked,
  go,
}: {
  today: MagazineToday | null;
  hasMailbox: boolean;
  blocked: boolean;
  go: (route: string, id?: string) => void;
}) {
  const L = useAppLayout();
  // 지금 띄운 호. 한 번 알린 호는 세션 동안(markDelivered) 다시 띄우지 않는다 — 받음 기록이 실패해 receipt 가 비어도
  const [delivered, setDelivered] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const [rack, setRack] = useState(false);
  // 펠리컨은 지금 나와 있는 호만 알린다. 잡지 물건은 가장 최근 호가 있는 동안 늘 둔다 — 발행이 늦어 어제 호뿐이어도
  // 우체통 없는 섬에서는 물건 길게 누르기가 꽂이로 가는 유일한 길이다
  const latest = today?.issue ?? null;
  const issue = latest?.current ? latest : null;

  useEffect(() => {
    if (blocked || !issue || today?.receipt || wasDelivered(issue.issueId)) return;
    markDelivered(issue.issueId);
    setDelivered(issue.issueId);
    setShowing(true);
    sendReceipt(issue.issueId, { place: 'ISLAND' }).catch(() => {});
  }, [blocked, issue, today?.receipt]);

  const later = () => {
    setShowing(false);
    if (delivered) sendReceipt(delivered, { place: 'ISLAND', deferred: true }).catch(() => {});
  };
  const open = () => {
    setShowing(false);
    if (hasMailbox) go('mail');
    else if (delivered) go('magazine', delivered);
  };
  const w = L.compact ? Math.min(L.floatingWidth, 374) : L.floatingWidth;
  const unread = magazineUnread(today);

  return (
    <>
      {!hasMailbox && latest && !blocked && (
        <Pressable
          testID="magazine-home-object"
          accessibilityRole="button"
          accessibilityLabel={t(
            unread ? 'magazine.delivery.objectUnread' : 'magazine.delivery.object',
            { no: latest.issueNo },
          )}
          accessibilityHint={t('magazine.delivery.objectHint')}
          accessibilityActions={[{ name: 'longpress', label: t('magazine.rack.open') }]}
          onAccessibilityAction={(ev) => ev.nativeEvent.actionName === 'longpress' && setRack(true)}
          onPress={() => go('magazine', latest.issueId)}
          onLongPress={() => setRack(true)}
          style={{
            position: 'absolute',
            // 「집중 시작」 버튼 바로 위 — 왼쪽 아래는 우체통 없는 이른 섬에 늘 있는 건설 카드 자리라 겹친다
            right: focusButtonInset(L).right + (FOCUS_BUTTON_SIZE - O.width) / 2,
            bottom: focusButtonInset(L).bottom + FOCUS_BUTTON_SIZE + primitiveTokens.space[2],
            width: O.width,
            height: O.height,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Image source={MAGAZINE_UI.cover} resizeMode="contain" style={O.art} />
          {unread && (
            <View
              testID="magazine-home-object-dot"
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: componentTokens.magazineReader.unreadDot,
                height: componentTokens.magazineReader.unreadDot,
                borderRadius: componentTokens.magazineReader.unreadDot / 2,
                borderWidth: semanticTokens.stroke.strong,
                borderColor: semanticTokens.color.surface,
                backgroundColor: semanticTokens.color.danger,
              }}
            />
          )}
        </Pressable>
      )}
      {showing && !blocked && (
        <GuideBox
          character="pelican"
          text={t(hasMailbox ? 'magazine.delivery.mailbox' : 'magazine.delivery.noMailbox')}
          style={{
            left: (L.width - w) / 2,
            width: w,
            // 건설 카드·집중 시작 버튼 위(회관 안내와 같은 자리)
            bottom: L.compact ? 110 : L.insets.bottom + 118,
          }}
          onSkip={later}
          skipTitle={t(hasMailbox ? 'magazine.delivery.later' : 'magazine.delivery.readLater')}
        >
          <Btn
            id="magazine-delivery-open"
            small
            title={t(hasMailbox ? 'magazine.delivery.openMailbox' : 'magazine.delivery.open')}
            style={{ minWidth: 96 }}
            onPress={open}
          />
        </GuideBox>
      )}
      <MagazineRack
        visible={rack}
        onClose={() => setRack(false)}
        onOpen={(id) => {
          setRack(false);
          go('magazine', id);
        }}
      />
    </>
  );
}
