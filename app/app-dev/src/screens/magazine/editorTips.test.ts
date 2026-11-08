import { MAGAZINE_TIP_COUNT } from '@/constants/magazineTips';

afterEach(() => jest.restoreAllMocks());

test('처음 펼칠 때 25개 문구 모두 선택될 수 있다', () => {
  const random = jest.spyOn(Math, 'random');
  const selected: number[] = [];
  for (let index = 0; index < MAGAZINE_TIP_COUNT; index++) {
    random.mockReturnValue((index + 0.5) / MAGAZINE_TIP_COUNT);
    jest.isolateModules(() => {
      const { pickEditorTip } = jest.requireActual('./editorTips');
      selected.push(pickEditorTip());
    });
  }
  expect(selected).toEqual(Array.from({ length: 25 }, (_, index) => index));
});

test('난수가 같아도 직전 문구는 제외하고 첫 번호·마지막 번호를 벗어나지 않는다', () => {
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  jest.isolateModules(() => {
    const { pickEditorTip } = jest.requireActual('./editorTips');
    expect(pickEditorTip()).toBe(0);
    expect(pickEditorTip()).toBe(1);
    random.mockReturnValue(0.999999);
    expect(pickEditorTip()).toBe(24);
    expect(pickEditorTip()).toBe(23);
    random.mockReturnValue(0);
    expect(pickEditorTip()).toBe(0);
  });
});
