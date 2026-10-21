/** 화면 번호가 바뀌어도 복구·건너뛰기는 장면 ID로 결정한다. */
export const storySteps = [
  'choose',
  'arrival',
  'silence',
  'hello',
  'name',
  'greet',
  'resolve',
  'settle',
  'promise',
  'islandFriends',
  'islandLife',
  'invite',
  'scopeIntro',
  'scope',
  'ready',
  'depart',
] as const;
export type StoryStep = (typeof storySteps)[number];
export type StoryCheckpoint = 'intro' | 'scope' | 'done';
export const firstStoryStep = (checkpoint?: StoryCheckpoint): StoryStep =>
  checkpoint === 'scope' ? 'scopeIntro' : 'choose';
export const nextStoryStep = (step: StoryStep): StoryStep =>
  storySteps[Math.min(storySteps.indexOf(step) + 1, storySteps.length - 1)];
export const storyHasLine = (step: StoryStep) => !['choose', 'arrival'].includes(step);
export const storyPose = (step: StoryStep, complete: boolean): 'sleep' | 'sit' | 'scope' => {
  if (['scopeIntro', 'scope', 'ready'].includes(step)) return 'scope';
  if (storySteps.indexOf(step) < storySteps.indexOf('resolve') || (step === 'resolve' && !complete))
    return 'sleep';
  return 'sit';
};
