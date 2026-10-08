import { NEED_TUNING } from '../tunables.ts';

/** Threat from one neighbour (VISION.md "Needs"; NEED_TUNING): believed `ratio` times as strong as the strength it is
 *  judged against, and disliked (none without dislike; fully at an opinion of −hostileAt or below). Shared by the
 *  needs (`perception.ts`) and the army a realm keeps (`army.ts`). */
export const threatOf = (ratio: number, opinion: number) =>
  Math.max(0, Math.min(1, (ratio - 1) / (NEED_TUNING.threatScale - 1))) * Math.max(0, Math.min(1, -opinion / NEED_TUNING.hostileAt));
