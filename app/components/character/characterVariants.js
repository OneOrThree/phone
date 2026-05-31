// ============================================================
// characterVariants.js — variant별 캐릭터 상태 설정
//
// 각 variant(상태)마다 눈 모양, 몸통 소품, 표정, 안경 여부 등을
// 한 곳에서 관리합니다.
//
// 새 variant를 추가하려면:
//   1. 여기 VARIANTS 객체에 새 키를 추가
//   2. LeftEye / RightEye: Eyes.js에 있는 컴포넌트 중 선택
//   3. Item: BodyItems.js에 있는 컴포넌트 중 선택 (없으면 null)
//   4. mouthType: 'smile' | 'bigSmile' | 'flat' | 'open' | 'tongue'
//   5. glasses, sweat, widePaws: true / false
// ============================================================

import { EyeNormal, EyeSquint, EyeCrescent, EyeStar } from './parts/Eyes';
import { BodyLaptop, BodyBook, BodyDumbbell, BodyPaper, BodyYogaAura } from './parts/BodyItems';

export const VARIANTS = {
  // 기본 상태: 평범한 눈, 미소, 소품 없음
  default: {
    LeftEye: EyeNormal, // 왼쪽 눈 컴포넌트
    RightEye: EyeNormal, // 오른쪽 눈 컴포넌트
    Item: null, // 몸통 소품 없음
    mouthType: 'smile', // 입 모양
    glasses: false, // 안경 착용 여부
    sweat: false, // 땀방울 표시 여부
    widePaws: false, // 발 간격 넓히기 여부 (yoga 전용)
  },

  // 집중 모드: 찡그린 눈, 노트북, 안경, 일자 입
  focus: {
    LeftEye: EyeSquint,
    RightEye: EyeSquint,
    Item: BodyLaptop,
    mouthType: 'flat',
    glasses: true,
    sweat: false,
    widePaws: false,
  },

  // 독서 모드: 평범한 눈, 책, 미소
  reading: {
    LeftEye: EyeNormal,
    RightEye: EyeNormal,
    Item: BodyBook,
    mouthType: 'smile',
    glasses: false,
    sweat: false,
    widePaws: false,
  },

  // 요가 모드: ^_^ 초승달 눈, 오라 장식, 크게 웃음, 발 간격 넓음
  yoga: {
    LeftEye: EyeCrescent,
    RightEye: EyeCrescent,
    Item: BodyYogaAura,
    mouthType: 'bigSmile',
    glasses: false,
    sweat: false,
    widePaws: true, // 요가 자세라 발을 넓게
  },

  // 운동 모드: 별 눈, 덤벨, 벌린 입, 땀방울
  exercise: {
    LeftEye: EyeStar,
    RightEye: EyeStar,
    Item: BodyDumbbell,
    mouthType: 'open',
    glasses: false,
    sweat: true, // 운동 중이라 땀 표시
    widePaws: false,
  },

  // 공부 모드: 한쪽만 찡그린 눈(집중+여유), 종이+연필, 혀 내밀기
  study: {
    LeftEye: EyeSquint, // 왼쪽만 찡그림 → 약간 삐딱한 느낌
    RightEye: EyeNormal,
    Item: BodyPaper,
    mouthType: 'tongue',
    glasses: false,
    sweat: false,
    widePaws: false,
  },
};
