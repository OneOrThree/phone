import { type Outfit } from '@/components/CatOutfitLayers';
import { componentTokens } from '@/design-system/tokens';
import { FishingCatArt } from '@/screens/focus/FishingIsland';
import { type FishingPeerActor } from '@/screens/focus/useFishingPeerActors';
import { CatInfoPopup } from '@/screens/island/CatInfoPopup';

export type FishingCatInfoTarget = { actor: FishingPeerActor; outfit?: Outfit };

/** 집중섬 다른 주민 정보창(GROMO-2474) — 낚시 자리와 같은 낚시 자세로 그린다. 주민 집중·낚시 구경이 같이 쓴다. */
export function FishingCatInfo({
  target,
  onClose,
}: {
  target: FishingCatInfoTarget;
  onClose: () => void;
}) {
  const { actor, outfit } = target;
  return (
    <CatInfoPopup
      key={actor.userId}
      userId={actor.userId}
      name={actor.name}
      catColor={actor.color}
      art={
        <FishingCatArt
          spot={actor.spot}
          color={actor.color}
          outfit={outfit}
          size={componentTokens.catInfoPopup.catSize}
        />
      }
      onClose={onClose}
    />
  );
}
