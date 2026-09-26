import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type DayNight = 'day' | 'night';

export function dayNightAt(date: Date): DayNight {
  const hour = date.getHours();
  return hour >= 6 && hour < 18 ? 'day' : 'night';
}

function demoDayNight(): DayNight | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('demo')) return null;
  return params.has('night') ? 'night' : 'day';
}

/** A parent may supply the authoritative value so its overlays and map frames stay in sync. */
export function useDayNightState(authoritative?: DayNight): DayNight {
  const [localDayNight, setLocalDayNight] = useState<DayNight>(
    () => demoDayNight() ?? dayNightAt(new Date()),
  );

  useEffect(() => {
    if (authoritative || demoDayNight()) return;
    const update = () => setLocalDayNight(dayNightAt(new Date()));
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [authoritative]);

  return authoritative ?? localDayNight;
}
