import { createServerFn } from '@tanstack/react-start';
import { TOUR_BUILD_ID } from './build-id';

/** The build the server is running, public: a tab compares it with its own to learn a new version is live. */
export const getLiveBuild = createServerFn({ method: 'GET' }).handler(() => TOUR_BUILD_ID);
