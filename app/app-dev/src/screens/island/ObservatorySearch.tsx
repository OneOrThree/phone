import {
  ObservatoryFrame,
  ObservatoryLedger,
  ObservatoryHeading,
  ObservatoryRow,
} from '@/screens/island/ObservatoryLayout';
import React, { useEffect, useState } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import { AccessibilityInfo, ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { Badge, Btn, Txt } from '@/design-system/patterns';
import { componentTokens, primitiveTokens, semanticTokens } from '@/design-system/tokens';
import { errorTextOr, t } from '@/i18n';
import { SearchField, st } from '@/screens/island/IslandSheet';
import { useIslandSearch } from '@/screens/island/useIslandSearch';
import { useTelescopePin, type TelescopePin } from '@/screens/island/useTelescopePin';
import type { IslandSummary } from '@/services/api/islands';
import { GOWUN } from './sceneKit';

const { space } = primitiveTokens;

const styles = StyleSheet.create({
  searchInput: { fontFamily: GOWUN, boxShadow: componentTokens.observatory.paperShadow },
  // 로딩·오류 안내 — 종이 목록 안에서 읽는다.
  panel: { alignItems: 'center', gap: space[3], paddingVertical: space[6] },
  center: { fontFamily: GOWUN, textAlign: 'center' },
  empty: { fontFamily: GOWUN, textAlign: 'center', paddingVertical: space[6] },
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
 * `tower`에서는 빈 검색어일 때 주간 랭킹을 보여 주고, `explore` 입구도 같은 고정 검색창을 쓴다.
 * 데모 모드는 `localResults`로 같은 UI 흐름을 검증하며 서버 API를 부르지 않는다.
 *
 * - 검색어는 300ms 멈추면 서버를 부른다(`useIslandSearch`). 비면 부르지 않고 안내만 보인다. 서버 검색은 이름만 본다 —
 *   초대 코드는 초대 링크 흐름이 맡는다.
 * - 행: 이름 · 소개 · 주민 {n}/{max}. 소속 섬은 «소속됨» 배지로 누를 수 없고(뗏목으로 바로 간다), 신청 중인 섬은 «신청 중» 배지가
 *   붙지만 넣을 수 있다. 섬 대표 그림은 왼쪽 원형에 확대하고, 배지는 이름 아래에 둔다. 그 밖의 섬을 누르면 확인창 → [망원경에 넣기](`useTelescopePin`).
 * - 로딩 · 빈 결과 · 오류(다시 시도)를 따로 그린다. 결과는 첫 페이지뿐이라 더 있으면 검색어를 좁히라고 알린다.
 */
export function ObservatorySearch({
  e,
  ranking,
  localResults,
  pinController,
}: {
  e: any;
  pinController?: TelescopePin;
  ranking?: React.ReactNode;
  localResults?: (query: string) => React.ReactNode;
}) {
  const [text, setText] = useState('');
  const search = useIslandSearch(localResults ? '' : text);
  const hasQuery = !!text.trim();
  const ownPin = useTelescopePin(e);
  const pin = pinController ?? ownPin;
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
    <ObservatoryFrame
      onBack={ranking === undefined ? e.back : undefined}
      onClose={e.home}
      header={
        <SearchField
          inputStyle={styles.searchInput}
          icon={
            <Svg
              width={semanticTokens.size.tapMin / 2}
              height={semanticTokens.size.tapMin / 2}
              viewBox="0 0 24 24"
              accessible={false}
            >
              <Circle
                cx="10.5"
                cy="10.5"
                r="6.5"
                fill="none"
                stroke={semanticTokens.color.outline}
                strokeWidth={semanticTokens.stroke.default}
              />
              <Path
                d="m15.5 15.5 5 5"
                fill="none"
                stroke={semanticTokens.color.outline}
                strokeWidth={semanticTokens.stroke.default}
                strokeLinecap="round"
              />
            </Svg>
          }
          value={text}
          onChange={setText}
          placeholder={t('observatory.searchPlaceholder')}
        />
      }
    >
      {!hasQuery && ranking !== undefined
        ? ranking
        : localResults && hasQuery
          ? localResults(text.trim())
          : hasQuery && (
              <ObservatoryLedger>
                <ObservatoryHeading />
                {search.status === 'loading' && (
                  <View testID="observatory-search-loading" style={styles.panel}>
                    <ActivityIndicator color={semanticTokens.color.outline} />
                    {/* 로딩 문구엔 live region 을 두지 않는다 — 입력마다 패널이 새로 떠서 TalkBack 이 키마다 되풀이해 읽는다 */}
                    <Txt kind="meta">{t('telescope.loading')}</Txt>
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
                    <View>
                      {search.items.map((island) => {
                        const joined = island.membershipStatus === 'active';
                        const state = stateText(island);
                        const sub = [
                          island.intro,
                          t('telescope.residents', {
                            count: island.memberCount,
                            max: island.maxMembers,
                          }),
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const badge = !!state && <Badge soft>{state}</Badge>;
                        return (
                          <ObservatoryRow
                            key={island.id}
                            title={island.name}
                            sub={sub}
                            label={[island.name, sub, state].filter(Boolean).join(', ')}
                            memberCount={island.memberCount}
                            below={badge}
                            disabled={pin.busy}
                            onPress={
                              joined
                                ? undefined
                                : () => pin.ask({ id: island.id, name: island.name })
                            }
                          />
                        );
                      })}
                    </View>
                    {search.more && (
                      <Txt
                        testID="observatory-search-more"
                        kind="meta"
                        style={[st.meta, styles.center]}
                      >
                        {t('observatory.searchMore')}
                      </Txt>
                    )}
                  </>
                )}
              </ObservatoryLedger>
            )}
    </ObservatoryFrame>
  );
}
