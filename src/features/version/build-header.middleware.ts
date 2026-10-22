import { createMiddleware } from '@tanstack/react-start';
import { BUILD_HEADER, TOUR_BUILD_ID } from './build-id';

/** Every server call says which build its tab was loaded with (`requireCurrentBuild` reads it). */
export const buildHeaderMiddleware = createMiddleware({ type: 'function' }).client(({ next }) =>
  next({ headers: { [BUILD_HEADER]: TOUR_BUILD_ID } }),
);
