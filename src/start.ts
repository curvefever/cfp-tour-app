import { createStart } from '@tanstack/react-start';
import { buildHeaderMiddleware } from './features/version/build-header.middleware';

export const startInstance = createStart(() => ({ functionMiddleware: [buildHeaderMiddleware] }));
