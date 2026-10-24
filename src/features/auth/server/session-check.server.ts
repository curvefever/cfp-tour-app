import { getRequest } from '@tanstack/react-start/server';
import { ACCESS_TOKEN_KEY, PID_STORAGE_KEY, type SessionCheck } from '../auth.shared';
import { readCookieValue } from '../../../lib/cookies';
import { getCachedAuthSnapshot, isInvalidTokenError } from './auth-session-cache.server';

/** Whether CFP still accepts this tab's session: no cookie or a refused token is `expired`, a CFP outage `unknown`. */
export async function answerSessionCheck(): Promise<SessionCheck> {
  const request = getRequest();
  const cookies = request.headers.get('cookie') || undefined;
  const token = readCookieValue(cookies, ACCESS_TOKEN_KEY);
  if (!token) return 'expired';
  try {
    await getCachedAuthSnapshot({
      hostname: new URL(request.url).hostname,
      pid: readCookieValue(cookies, PID_STORAGE_KEY) || '',
      request,
      token,
    });
    return 'valid';
  } catch (error) {
    return isInvalidTokenError(error) ? 'expired' : 'unknown';
  }
}
