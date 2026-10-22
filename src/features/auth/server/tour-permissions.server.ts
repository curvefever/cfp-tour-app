import { getRequest } from "@tanstack/react-start/server";
import { ACCESS_TOKEN_KEY, PID_STORAGE_KEY, canAdminTour, type AuthSnapshot } from "../auth.shared";
import { readCookieValue } from "../../../lib/cookies";
import { requireCurrentBuild } from "../../version/build-guard.server";
import { getCachedAuthSnapshot } from "./auth-session-cache.server";

export async function requireTourAdminPermission(): Promise<AuthSnapshot> {
  // Every privileged write goes through here, so this is the one place an old tab is turned away.
  requireCurrentBuild();
  const request = getRequest();
  const cookies = request.headers.get("cookie") || undefined;
  const token = readCookieValue(cookies, ACCESS_TOKEN_KEY);
  if (!token) throw new Error("You must sign in with CFP to manage a tournament.");
  const snapshot = await getCachedAuthSnapshot({
    hostname: new URL(request.url).hostname,
    pid: readCookieValue(cookies, PID_STORAGE_KEY) || "",
    request,
    token,
  });
  if (!canAdminTour(snapshot.roles)) {
    throw new Error("Your CFP account does not have Tournament Hub admin access.");
  }
  return snapshot;
}
