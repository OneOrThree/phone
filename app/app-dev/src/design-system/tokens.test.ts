import { C, componentTokens, primitiveTokens, semanticTokens } from './tokens';

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
  });

  it('터치 영역과 UI kit 스케일을 보존한다', () => {
    expect(semanticTokens.size.tapMin).toBeGreaterThanOrEqual(44);
    expect(primitiveTokens.space[4]).toBe(16);
    expect(primitiveTokens.radius.card).toBe(20);
  });
});
