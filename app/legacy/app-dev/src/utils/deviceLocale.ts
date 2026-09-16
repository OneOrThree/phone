import * as Localization from 'expo-localization';

// 기기 로케일의 국가코드(ISO 3166-1 alpha-2, 예: "KR"·"JP"·"GB"). 확정 불가면 undefined.
// 서버가 이 값으로 유저 타임존(ZoneId)을 파생해 날짜를 산정한다(GROMO-561/663).
// 사용자 입력이 아니라 기기 로케일에서 파생되는 값이라 전송 시점에 읽어 쓴다.
export function getDeviceCountryCode(): string | undefined {
  return Localization.getLocales()[0]?.regionCode ?? undefined;
}
