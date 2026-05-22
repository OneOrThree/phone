import { EyeNormal, EyeSquint, EyeCrescent, EyeStar } from './parts/Eyes';
import { BodyLaptop, BodyBook, BodyDumbbell, BodyPaper, BodyYogaAura } from './parts/BodyItems';

export const VARIANTS = {
  default:  { LeftEye: EyeNormal,   RightEye: EyeNormal,   Item: null,         mouthType: 'smile',    glasses: false, sweat: false, widePaws: false },
  focus:    { LeftEye: EyeSquint,   RightEye: EyeSquint,   Item: BodyLaptop,   mouthType: 'flat',     glasses: true,  sweat: false, widePaws: false },
  reading:  { LeftEye: EyeNormal,   RightEye: EyeNormal,   Item: BodyBook,     mouthType: 'smile',    glasses: false, sweat: false, widePaws: false },
  yoga:     { LeftEye: EyeCrescent, RightEye: EyeCrescent, Item: BodyYogaAura, mouthType: 'bigSmile', glasses: false, sweat: false, widePaws: true  },
  exercise: { LeftEye: EyeStar,     RightEye: EyeStar,     Item: BodyDumbbell, mouthType: 'open',     glasses: false, sweat: true,  widePaws: false },
  study:    { LeftEye: EyeSquint,   RightEye: EyeNormal,   Item: BodyPaper,    mouthType: 'tongue',   glasses: false, sweat: false, widePaws: false },
};
