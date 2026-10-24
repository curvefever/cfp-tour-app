import { createServerFn } from '@tanstack/react-start';
import type { SessionCheck } from '../auth.shared';
import { answerSessionCheck } from './session-check.server';

/** Public, like `getInitialAuth`: an admin tab asks whether its CFP session is still accepted. Answers, never throws. */
export const checkSession = createServerFn({ method: 'GET' }).handler((): Promise<SessionCheck> =>
  answerSessionCheck(),
);
