import { C, componentTokens, primitiveTokens, semanticTokens } from './tokens';

// WCAG 상대 휘도 대비: sRGB 선형화 후 (L1+0.05)/(L2+0.05)
const luminance = (hex: string) =>
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))
    .reduce((l, v, i) => l + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('design system tokens', () => {
  it('확정된 딸기 소다 팔레트를 semantic token으로 연결한다', () => {
    expect(semanticTokens.color.primary).toBe(primitiveTokens.color.pink);
    expect(semanticTokens.color.secondary).toBe(primitiveTokens.color.sky);
    expect(semanticTokens.color.accent).toBe(primitiveTokens.color.butter);
    expect(semanticTokens.color.canvas).toBe(primitiveTokens.color.cream);
    expect(semanticTokens.color.surface).toBe(primitiveTokens.color.paper);
  });

  it('기존 C 별칭과 새 semantic token이 어긋나지 않는다', () => {
    expect(C.pink).toBe(semanticTokens.color.primary);
    expect(C.ink).toBe(semanticTokens.color.text);
    expect(C.brown).toBe(semanticTokens.color.outline);
    expect(C.soft).toBe(semanticTokens.color.selected);
  });

  it('공용 컴포넌트가 semantic token을 참조한다', () => {
    expect(componentTokens.button.background).toBe(semanticTokens.color.primary);
    expect(componentTokens.card.background).toBe(semanticTokens.color.surface);
    expect(componentTokens.input.border).toBe(semanticTokens.color.outline);
    expect(componentTokens.progress.fill).toBe(semanticTokens.color.primary);
    expect(componentTokens.homeQuestIndicator.contentPaddingLeft).toBe(primitiveTokens.space[4]);
    expect(componentTokens.homeQuestIndicator.contentPaddingRight).toBe(primitiveTokens.space[12]);
    expect(componentTokens.homeQuestIndicator.shadow).toContain(semanticTokens.color.outline);
    expect(componentTokens.gramophone.panelBackground).toBe(primitiveTokens.color.gramophonePanel);
    expect(componentTokens.gramophone.recordGroove).toBe(
      primitiveTokens.color.gramophoneRecordGroove,
    );
    expect(componentTokens.fishingScene.splashDrop).toBe(primitiveTokens.color.fishingSplash);
    expect(componentTokens.fishingScene.radius).toBe(semanticTokens.radius.full);
    expect(componentTokens.restCampfire.glowBackColor).toBe(primitiveTokens.color.restFireGlowBack);
    expect(componentTokens.restCampfire.sparkLight).toBe(primitiveTokens.color.restFireSparkLight);
  });

  it('터치 영역과 UI kit 스케일을 보존한다', () => {
    expect(semanticTokens.size.tapMin).toBeGreaterThanOrEqual(44);
    expect(componentTokens.gramophone.touchMin).toBeGreaterThanOrEqual(44);
    expect(componentTokens.gramophone.rowMinHeight).toBeGreaterThanOrEqual(44);
    expect(primitiveTokens.space[4]).toBe(16);
    expect(primitiveTokens.radius.card).toBe(20);
  });

  it('큰 글자 임계값은 semantic token 한 곳이고 component token 에 복제하지 않는다(GROMO-2281)', () => {
    expect(semanticTokens.typography.largeTextThreshold).toBe(1.3);
    // 다른 판정(1.2)인 raftDestinations 만 자기 값을 가진다 — 그 밖의 그룹에 되살리면 복제다(중첩 객체까지 훑는다)
    const collect = (o: unknown, path: string[] = []): string[] =>
      typeof o === 'object' && o !== null
        ? Object.entries(o).flatMap(([k, v]) =>
            k === 'largeTextThreshold' ? [[...path, k].join('.')] : collect(v, [...path, k]),
          )
        : [];
    expect(collect(componentTokens)).toEqual(['raftDestinations.largeTextThreshold']);
    expect(componentTokens.raftDestinations.largeTextThreshold).toBe(1.2);
  });

  it('고양이 이름표 색은 한 곳이다(GROMO-2475)', () => {
    expect(componentTokens.nameplate).toEqual({
      ink: '#493B39',
      outline: '#8B6956',
      me: '#246A8A',
      shadow: '#FFFDFA',
    });
  });

  it('placeholder는 surface 위 대비 4.5:1 이상의 textMuted를 쓴다', () => {
    expect(componentTokens.input.placeholder).toBe(semanticTokens.color.textMuted);
    expect(
      contrast(componentTokens.input.placeholder, semanticTokens.color.surface),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('축음기 텍스트는 표시되는 모든 배경에서 4.5:1 이상의 대비를 갖는다', () => {
    const gramophone = componentTokens.gramophone;
    expect(contrast(gramophone.foreground, gramophone.panelBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(gramophone.foregroundMuted, gramophone.panelBackground)).toBeGreaterThanOrEqual(
      4.5,
    );
    for (const background of [gramophone.signStart, gramophone.signCenter, gramophone.signEnd]) {
      expect(contrast(gramophone.signForeground, background)).toBeGreaterThanOrEqual(4.5);
    }
    for (const background of [
      semanticTokens.color.primary,
      semanticTokens.color.surface,
      semanticTokens.color.accent,
    ]) {
      expect(contrast(gramophone.rowForeground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('badge default/soft가 명세 매핑을 따른다', () => {
    expect(componentTokens.badge.default.background).toBe(semanticTokens.color.accent);
    expect(componentTokens.badge.default.foreground).toBe(semanticTokens.color.text);
    expect(componentTokens.badge.default.border).toBe(semanticTokens.color.outline);
    expect(componentTokens.badge.soft.background).toBe(semanticTokens.color.surface);
    expect(componentTokens.badge.soft.foreground).toBe(semanticTokens.color.textMuted);
    expect(componentTokens.badge.soft.border).toBe(primitiveTokens.color.controlIdle);
    expect(componentTokens.badge.radius).toBe(semanticTokens.radius.full);
  });

  it('마을 새 소식 배지 치수를 전용 component token으로 관리한다', () => {
    expect(componentTokens.villageNotificationBadge).toEqual({
      diameter: 25,
      radius: 13,
      borderWidth: semanticTokens.stroke.default,
      topOffset: -11,
      rightOffset: 21,
    });
    expect(componentTokens.villageNotificationTooltip).toEqual({
      maxWidth: 180,
      paddingVertical: primitiveTokens.space[2],
      borderWidth: semanticTokens.stroke.default,
    });
    expect(componentTokens.villageBuildingThemeTint).toEqual({ color: '#d7829b', opacity: 0.3 });
  });
});
