import { getRequest } from "@tanstack/react-start/server";
import {
  ACCESS_TOKEN_KEY,
  PID_STORAGE_KEY,
  SESSION_EXPIRED_MESSAGE,
  canAdminTour,
  type AuthSnapshot,
} from "../auth.shared";
import { readCookieValue } from "../../../lib/cookies";
import { requireCurrentBuild } from "../../version/build-guard.server";
import { getCachedAuthSnapshot, isInvalidTokenError } from "./auth-session-cache.server";

export async function requireTourAdminPermission(): Promise<AuthSnapshot> {
  // Every privileged write goes through here, so this is the one place an old tab is turned away.
  requireCurrentBuild();
  const request = getRequest();
  const cookies = request.headers.get("cookie") || undefined;
  const token = readCookieValue(cookies, ACCESS_TOKEN_KEY);
  if (!token) throw new Error(SESSION_EXPIRED_MESSAGE);
  const snapshot = await getCachedAuthSnapshot({
    hostname: new URL(request.url).hostname,
    pid: readCookieValue(cookies, PID_STORAGE_KEY) || "",
    request,
    token,
  }).catch((error: unknown) => {
    // Only CFP's own "invalid token" answer is an expiry; a network failure or a CFP 5xx is not.
    if (isInvalidTokenError(error)) throw new Error(SESSION_EXPIRED_MESSAGE);
    throw error;
  });
  if (!canAdminTour(snapshot.roles)) {
    throw new Error("Your CFP account does not have Tournament Hub admin access.");
  }
  return snapshot;
}
