import { Route } from '@/services/model';

export const shouldGateScreenTimeBoard = (
  route: Route,
  options: { isIOS: boolean; isAndroid?: boolean; promptSeen: boolean; visiting: boolean },
) =>
  ['board', 'quest'].includes(route) &&
  (options.isIOS || options.isAndroid === true) &&
  !options.visiting &&
  !options.promptSeen;
