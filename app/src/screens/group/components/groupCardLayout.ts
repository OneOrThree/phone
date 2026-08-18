import { Platform, type TextStyle } from 'react-native';

/** 앞면·뒷면·탐색 카드·로딩 스켈레톤이 공유하는 덱 페이지 높이. */
export const GROUP_CARD_HEIGHT = 520;

/**
 * iOS의 기본 시스템 글꼴은 한 Text 안에서도 Latin과 한글을 서로 다른 family로 fallback한다.
 * 사용자 입력이 그대로 보이는 그룹 카드에서는 두 스크립트를 모두 가진 Apple SD Gothic Neo를
 * 명시해 혼합 이름·소개가 한 글꼴로 보이게 한다. Android/Web은 플랫폼 기본 sans를 유지한다.
 */
export const GROUP_CARD_USER_TEXT: Pick<TextStyle, 'fontFamily'> = {
  fontFamily: Platform.select({ ios: 'Apple SD Gothic Neo', default: undefined }),
};
