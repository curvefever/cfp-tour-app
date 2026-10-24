import { createStart } from '@tanstack/react-start';
import { sessionExpiredMiddleware } from './features/auth/session-expired.middleware';
import { buildHeaderMiddleware } from './features/version/build-header.middleware';

export const startInstance = createStart(() => ({
  functionMiddleware: [buildHeaderMiddleware, sessionExpiredMiddleware],
}));
