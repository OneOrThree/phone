// inviteLink.ts 유닛 테스트 — 명세 docs/app/group-plan.md §11(정상/UUID 아님/스킴 다름/쿼리 없음).
// 초대 링크는 비공개방의 유일한 입구라, 파싱이 조용히 틀리면 초대 전체가 죽는다.
import { buildInviteLink, parseInviteLink } from './inviteLink';

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55'; // UUID v7 형식

describe('buildInviteLink', () => {
  test('외부 공유용은 https 웹 랜딩 링크다(커스텀 스킴이 아님)', () => {
    expect(buildInviteLink(GROUP_ID)).toBe(
      `https://oneorthree.github.io/phone/join.html?g=${GROUP_ID}`,
    );
  });

  test('만든 링크는 그대로 다시 파싱된다(왕복)', () => {
    expect(parseInviteLink(buildInviteLink(GROUP_ID))).toBe(GROUP_ID);
  });
});

describe('parseInviteLink', () => {
  test('커스텀 스킴 링크에서 groupId를 뽑는다', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}`)).toBe(GROUP_ID);
  });

  // iOS·카톡 인앱 브라우저가 URL을 정규화하며 슬래시를 바꾸는 경우 대비(§11 실기기 미검증 구간).
  test('슬래시 변형(gromo://join/? · gromo:///join?)도 받는다', () => {
    expect(parseInviteLink(`gromo://join/?g=${GROUP_ID}`)).toBe(GROUP_ID);
    expect(parseInviteLink(`gromo:///join?g=${GROUP_ID}`)).toBe(GROUP_ID);
  });

  test('경로가 join으로 시작만 하는 다른 스킴 링크는 null', () => {
    expect(parseInviteLink(`gromo://joinery?g=${GROUP_ID}`)).toBeNull();
  });

  test('다른 파라미터가 섞여 있어도 g를 찾는다', () => {
    expect(parseInviteLink(`gromo://join?from=kakao&g=${GROUP_ID}`)).toBe(GROUP_ID);
  });

  test('프래그먼트는 값에 섞이지 않는다', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}#top`)).toBe(GROUP_ID);
  });

  test('UUID 형식이 아니면 null', () => {
    expect(parseInviteLink('gromo://join?g=abc')).toBeNull();
  });

  test('g 파라미터가 없으면 null', () => {
    expect(parseInviteLink('gromo://join?x=1')).toBeNull();
  });

  test('쿼리스트링이 없으면 null', () => {
    expect(parseInviteLink('gromo://join')).toBeNull();
  });

  test('다른 딥링크 경로는 null(league·focus 매핑을 침범하지 않는다)', () => {
    expect(parseInviteLink(`gromo://league?g=${GROUP_ID}`)).toBeNull();
  });

  test('우리 도메인이 아닌 https 링크는 null', () => {
    expect(parseInviteLink(`https://evil.example.com/join.html?g=${GROUP_ID}`)).toBeNull();
  });
});
