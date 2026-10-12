import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Badge, Btn, Txt } from '@/design-system/patterns';
import { primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import {
  IslandSheet,
  IslandThumb,
  SearchField,
  SheetGroup,
  SheetRow,
  st,
} from '@/screens/island/IslandSheet';
import { useIslandSearch } from '@/screens/island/useIslandSearch';
import { useTelescopePin } from '@/screens/island/useTelescopePin';
import type { IslandSummary } from '@/services/api/islands';

const { space } = primitiveTokens;

const styles = StyleSheet.create({
  // 로딩·오류 안내 — 시트 가운데에 쌓는다.
  panel: { alignItems: 'center', gap: space[3], paddingVertical: space[6] },
  center: { textAlign: 'center' },
  empty: { textAlign: 'center', paddingVertical: space[6] },
  // 배지는 기본이 왼쪽 위 정렬(DESIGN §7.5) — 행 안에서는 세로 가운데에 둔다.
  badge: { alignSelf: 'center' },
});

/** 행 오른쪽 배지 글 — 소속 섬은 «소속됨»(누를 수 없다), 가입 신청 중인 섬은 «신청 중»(그래도 넣을 수 있다). */
const stateText = (island: IslandSummary) =>
  island.membershipStatus === 'active'
    ? t('observatory.joined')
    : island.membershipStatus === 'pending'
      ? t('telescope.pending')
      : '';

/**
 * 전망대 섬 찾기(GROMO-2269) — 섬 이름으로 서버를 검색하고, 고른 섬을 망원경에 넣는다.
 * 서버 모드의 `explore` 화면이다(로컬 목업 필터는 `Screens.tsx` 가 서버 없는 모드에서 그대로 그린다).
 *
 * - 검색어는 300ms 멈추면 서버를 부른다(`useIslandSearch`). 비면 부르지 않고 안내만 보인다. 서버 검색은 이름만 본다 —
 *   초대 코드는 초대 링크 흐름이 맡는다.
 * - 행: 이름 · 소개 · 주민 {n}/{max}. 소속 섬은 «소속됨» 배지로 누를 수 없고(뗏목으로 바로 간다), 신청 중인 섬은 «신청 중» 배지가
 *   붙지만 넣을 수 있다. 그 밖의 섬을 누르면 확인창 → [망원경에 넣기](`useTelescopePin`).
 * - 로딩 · 빈 결과 · 오류(다시 시도)를 따로 그린다. 결과는 첫 페이지뿐이라 더 있으면 검색어를 좁히라고 알린다.
 */
export function ObservatorySearch({ e }: { e: any }) {
  const [text, setText] = useState('');
  const search = useIslandSearch(text);
  const pin = useTelescopePin(e);
  const errorText =
    search.status === 'error' ? errorTextOr(search.error, 'observatory.searchFailed') : null;
  const empty = search.status === 'ready' && search.items.length === 0;
  // 실패·빈 결과 안내가 뜨면 한 번 알린다 — 안드로이드는 아래 문구의 live region 이, iOS 는 여기서 직접(Telescope 와 같은 방식)
  const announcement = errorText ?? (empty ? t('observatory.searchEmpty') : null);
  useEffect(() => {
    if (announcement && Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(announcement);
  }, [announcement]);

  return (
    <IslandSheet
      bg="tower"
      sign="bld/observatory"
      title={t('observatory.searchTitle')}
      tall
      onBack={e.back}
      onClose={e.home}
    >
      <SearchField
        value={text}
        onChange={setText}
        placeholder={t('observatory.searchPlaceholder')}
      />
      <Txt kind="meta" style={st.meta}>
        {t('observatory.searchGuide')}
      </Txt>
      {search.status === 'loading' && (
        <View testID="observatory-search-loading" style={styles.panel}>
          <ActivityIndicator color={semanticTokens.color.outline} />
          <Txt kind="meta" accessibilityLiveRegion="polite">
            {t('telescope.loading')}
          </Txt>
        </View>
      )}
      {search.status === 'error' && (
        <View testID="observatory-search-error" style={styles.panel}>
          <Txt accessibilityLiveRegion="polite" style={styles.center}>
            {errorText}
          </Txt>
          <Btn
            kind="sec"
            dynamicHeight
            id="observatory-search-retry"
            title={t('common.retry')}
            onPress={search.retry}
          />
        </View>
      )}
      {empty && (
        <Txt
          testID="observatory-search-empty"
          kind="meta"
          accessibilityLiveRegion="polite"
          style={[st.meta, styles.empty]}
        >
          {t('observatory.searchEmpty')}
        </Txt>
      )}
      {search.status === 'ready' && search.items.length > 0 && (
        <>
          <SheetGroup>
            {search.items.map((island) => {
              const joined = island.membershipStatus === 'active';
              const state = stateText(island);
              const sub = [
                island.intro,
                t('telescope.residents', { count: island.memberCount, max: island.maxMembers }),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <SheetRow
                  key={island.id}
                  title={island.name}
                  sub={sub}
                  label={[island.name, sub, state].filter(Boolean).join(', ')}
                  chevron={!joined}
                  tail={
                    <>
                      {!!state && (
                        <Badge soft style={styles.badge}>
                          {state}
                        </Badge>
                      )}
                      <IslandThumb />
                    </>
                  }
                  disabled={pin.busy}
                  onPress={joined ? undefined : () => pin.ask({ id: island.id, name: island.name })}
                />
              );
            })}
          </SheetGroup>
          {search.more && (
            <Txt testID="observatory-search-more" kind="meta" style={[st.meta, styles.center]}>
              {t('observatory.searchMore')}
            </Txt>
          )}
        </>
      )}
    </IslandSheet>
  );
}
