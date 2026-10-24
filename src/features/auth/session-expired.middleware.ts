import { createMiddleware } from '@tanstack/react-start';
import { isSessionExpiredError } from './auth.shared';
import { signalSessionExpired } from './session-expired-signal';

/** Every server call passes here, so an ended CFP session is noticed once for all of them, then rethrown. */
export const sessionExpiredMiddleware = createMiddleware({ type: 'function' }).client(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (isSessionExpiredError(error)) signalSessionExpired();
    throw error;
  }
});
