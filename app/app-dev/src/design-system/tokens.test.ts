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
  });

  it('터치 영역과 UI kit 스케일을 보존한다', () => {
    expect(semanticTokens.size.tapMin).toBeGreaterThanOrEqual(44);
    expect(componentTokens.gramophone.touchMin).toBeGreaterThanOrEqual(44);
    expect(componentTokens.gramophone.rowMinHeight).toBeGreaterThanOrEqual(44);
    expect(primitiveTokens.space[4]).toBe(16);
    expect(primitiveTokens.radius.card).toBe(20);
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
  });
});
