// inviteLink.ts 유닛 테스트 — 계약 정본은 초대 링크 스펙 §4-1(URL 3형식).
// 초대 링크는 비공개방의 유일한 입구라, 파싱이 조용히 틀리면 초대 전체가 죽는다.
import { parseInviteLink } from './inviteLink';

const GROUP_ID = '0197e0c3-4d1b-7a2e-9f60-3b7c1f2a8d55'; // UUID v7 형식
const SLUG = 'ab23cd45';

describe('parseInviteLink — 스펙 §4-1 3형식', () => {
  test('Universal Link 형식에서 groupId와 slug를 뽑는다', () => {
    expect(parseInviteLink(`https://link.oneorthree.world/l/${SLUG}?g=${GROUP_ID}`)).toEqual({
      groupId: GROUP_ID,
      slug: SLUG,
    });
  });

  test('커스텀 스킴 형식(g+s)에서 groupId와 slug를 뽑는다', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}&s=${SLUG}`)).toEqual({
      groupId: GROUP_ID,
      slug: SLUG,
    });
  });

  // 구형 링크(§4-1) — 이미 배포된 앱이 만들어 돌아다니는 형태라 계속 받아야 한다.
  test('구형 스킴(s 없음)은 slug가 null이다', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}`)).toEqual({
      groupId: GROUP_ID,
      slug: null,
    });
  });
});

describe('parseInviteLink — 기존 방어 로직 유지', () => {
  // iOS·카톡 인앱 브라우저가 URL을 정규화하며 슬래시를 바꾸는 경우 대비.
  test('슬래시 변형(gromo://join/? · gromo:///join?)도 받는다', () => {
    expect(parseInviteLink(`gromo://join/?g=${GROUP_ID}`)).toEqual({
      groupId: GROUP_ID,
      slug: null,
    });
    expect(parseInviteLink(`gromo:///join?g=${GROUP_ID}&s=${SLUG}`)).toEqual({
      groupId: GROUP_ID,
      slug: SLUG,
    });
  });

  test('경로가 join으로 시작만 하는 다른 스킴 링크는 null', () => {
    expect(parseInviteLink(`gromo://joinery?g=${GROUP_ID}`)).toBeNull();
  });

  test('다른 파라미터가 섞여 있어도 g·s를 찾는다', () => {
    expect(parseInviteLink(`gromo://join?from=kakao&g=${GROUP_ID}&s=${SLUG}`)).toEqual({
      groupId: GROUP_ID,
      slug: SLUG,
    });
  });

  test('프래그먼트는 값에 섞이지 않는다', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}&s=${SLUG}#top`)).toEqual({
      groupId: GROUP_ID,
      slug: SLUG,
    });
  });

  test('UUID 형식이 아니면 null', () => {
    expect(parseInviteLink('gromo://join?g=abc')).toBeNull();
  });

  // decodeURIComponent가 URIError를 던지는 입력 — 실행 중 링크 수신 콜백엔 예외 경계가 없어
  // 던지면 그대로 앱이 죽는다. 잘못된 링크는 조용히 무시한다.
  test('손상된 percent-encoding은 예외 대신 null', () => {
    expect(parseInviteLink('gromo://join?g=%')).toBeNull();
    expect(parseInviteLink('gromo://join?g=%zz')).toBeNull();
    expect(parseInviteLink('gromo://join?g=%E0%A4%A')).toBeNull();
  });

  test('g 파라미터가 없으면 null', () => {
    expect(parseInviteLink('gromo://join?x=1')).toBeNull();
    expect(parseInviteLink(`https://link.oneorthree.world/l/${SLUG}`)).toBeNull();
  });

  test('쿼리스트링이 없으면 null', () => {
    expect(parseInviteLink('gromo://join')).toBeNull();
  });

  test('다른 딥링크 경로는 null(league·focus 매핑을 침범하지 않는다)', () => {
    expect(parseInviteLink(`gromo://league?g=${GROUP_ID}`)).toBeNull();
  });

  test('우리 링크 도메인이 아닌 https 링크는 null', () => {
    expect(parseInviteLink(`https://evil.example.com/l/${SLUG}?g=${GROUP_ID}`)).toBeNull();
    // 도메인이 접두어로만 겹치는 경우(link.oneorthree.world.evil.com)도 막는다.
    expect(
      parseInviteLink(`https://link.oneorthree.world.evil.com/l/${SLUG}?g=${GROUP_ID}`),
    ).toBeNull();
  });

  // 죽은 랜딩(github.io)은 이번 규격에서 빠졌다 — 살려두면 서버가 모르는 링크를 계속 받는다.
  test('구 웹 랜딩(github.io) 링크는 더 이상 받지 않는다', () => {
    expect(parseInviteLink(`https://oneorthree.github.io/phone/join.html?g=${GROUP_ID}`)).toBeNull();
  });
});

describe('parseInviteLink — slug 형식 관대 처리', () => {
  // slug는 어트리뷰션 파라미터일 뿐이고 groupId가 초대의 본체다.
  // slug만 이상하면 초대를 죽이지 않고 slug만 버린다(스펙 §4-1 "slug만 버리고 join은 진행").
  test('UL 경로 slug가 허용 문자 밖이면 slug만 null', () => {
    expect(parseInviteLink(`https://link.oneorthree.world/l/AB!!01?g=${GROUP_ID}`)).toEqual({
      groupId: GROUP_ID,
      slug: null,
    });
  });

  test('스킴 s 파라미터가 허용 문자 밖이면 slug만 null', () => {
    expect(parseInviteLink(`gromo://join?g=${GROUP_ID}&s=zzz!!`)).toEqual({
      groupId: GROUP_ID,
      slug: null,
    });
  });
});
