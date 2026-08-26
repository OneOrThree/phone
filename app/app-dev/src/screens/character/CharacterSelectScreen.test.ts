// 캐릭터 변경 화면 — 못 쓰는 누끼가 장착 확정되지 않는지 검증.
//
// 배경: 누끼는 앱 컨테이너 절대경로로 저장되는데, 그 경로가 죽으면(파일 없음) 카드가 기본 그로몬으로
// 폴백돼 그려진다. 겉보기엔 "빈 칸"인데 탭하면 선택·장착까지 돼서, 확정하는 순간 홈·집중·축하 화면의
// 캐릭터가 전부 기본으로 돌아간다. 아무것도 안 고르고 '변경하기'를 눌렀을 때 확정되는 값이 곧
// resolveEquippedChoice 의 결과라, 여기서 'custom'이 새어 나가지 않는 것이 이 수정의 핵심이다.
// 화면 모듈을 import 하면 CharacterContext → UserContext → Firebase analytics 까지 딸려와
// 네이티브 모듈이 없는 jest 환경에서 터진다. 판정 함수만 필요하므로 그 체인을 끊는다.
jest.mock('@/store/CharacterContext', () => ({}));

import { resolveEquippedChoice } from './CharacterSelectScreen';

describe('resolveEquippedChoice', () => {
  it('쓸 수 있는 누끼를 장착 중이면 custom 그대로', () => {
    expect(resolveEquippedChoice('custom', 'file:///ok.png', false)).toBe('custom');
  });

  it('그림을 못 그리는 누끼면 기본 그로몬으로 본다', () => {
    expect(resolveEquippedChoice('custom', 'file:///gone.png', true)).toBe('default');
  });

  it('누끼 경로 자체가 없으면 기본 그로몬', () => {
    expect(resolveEquippedChoice('custom', null, false)).toBe('default');
  });

  it('기본을 장착 중이면 누끼 상태와 무관하게 기본', () => {
    expect(resolveEquippedChoice('default', 'file:///ok.png', false)).toBe('default');
  });
});
