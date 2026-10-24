export const ACCESS_TOKEN_KEY = "accessTokenTourHub";
export const USERNAME_STORAGE_KEY = "cf-tour-username";
export const PID_STORAGE_KEY = "pid";
export const NET_VERSION = -1;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
/** CFP's code for a token it no longer accepts. */
export const CFP_INVALID_TOKEN_CODE = 700;
/** What the server throws when the organiser's CFP session has ended (no cookie, or a token CFP refuses). */
export const SESSION_EXPIRED_MESSAGE = "Your CFP session has expired — sign in again.";

/** What `checkSession` answers: `unknown` is any failure that is not CFP refusing the token. */
export type SessionCheck = 'valid' | 'expired' | 'unknown';

/** Recognised by message: that is all that survives a server function's error serialisation. */
export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message === SESSION_EXPIRED_MESSAGE;
}

export enum Role {
  ADMIN = 0,
  MOD = 1,
  BOT = 3,
  ARTIST = 6,
  // Legacy champion role IDs 2, 4, 5, 10 and 11 are reserved.
  CONTEST_WINNER = 7,
  LEAD_MOD = 8,
  DEVELOPER = 9,
  TOUR_HOST = 20,
  LEAD_TOUR_HOST = 21,
  SOCIAL_MEDIA_MANAGER = 25,
  LEAD_SOCIAL_MEDIA = 26,
  CONTENT_CREATOR = 27,
  MARKETING_MANAGER = 28,
  WIKI_EDITOR = 30,
  TRANSLATOR = 31,
}

export const TOUR_ADMIN_ROLE_IDS = [
  Role.ADMIN,
  Role.MOD,
  Role.LEAD_MOD,
  Role.DEVELOPER,
  Role.TOUR_HOST,
  Role.LEAD_TOUR_HOST,
] as const;

const TOUR_ADMIN_ROLE_ID_SET = new Set<number>(TOUR_ADMIN_ROLE_IDS);

export type AccountRoleID = number;

export type AuthSnapshot = {
  roles: AccountRoleID[];
  status: "anonymous" | "authenticated";
  userId: string;
  username: string;
};

export type AuthRolePayload = {
  accountID?: unknown;
  accountId?: unknown;
  accountRoles?: unknown;
  id?: unknown;
  roleIDs?: unknown;
  roles?: unknown;
  userID?: unknown;
  userId?: unknown;
};

function normalizeRoleID(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return normalizeRoleID(record.role ?? record.id ?? record.roleID ?? record.type);
  }
  return undefined;
}

function normalizeRoleList(value: unknown): AccountRoleID[] {
  if (!Array.isArray(value)) return [];
  const roles = new Set<AccountRoleID>();
  for (const valueRole of value) {
    const role = normalizeRoleID(valueRole);
    if (role !== undefined) roles.add(role);
  }
  return [...roles];
}

export function extractAccountRoles(payload: AuthRolePayload): AccountRoleID[] {
  const roles = new Set<AccountRoleID>();
  for (const list of [payload.accountRoles, payload.roles, payload.roleIDs]) {
    for (const role of normalizeRoleList(list)) roles.add(role);
  }
  return [...roles];
}

export function getUsernameFromPayload(username: string | undefined, fallback = ""): string {
  return username?.trim() || fallback.trim();
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

export function getUserIdFromPayload(payload: AuthRolePayload, fallback = ""): string {
  for (const value of [payload.userId, payload.userID, payload.accountId, payload.accountID, payload.id]) {
    const identifier = normalizeIdentifier(value);
    if (identifier) return identifier;
  }
  return fallback.trim();
}

export function getAnonymousAuthSnapshot(): AuthSnapshot {
  return { roles: [], status: "anonymous", userId: "", username: "" };
}

export function canAdminTour(roles: readonly AccountRoleID[]): boolean {
  return roles.some((role) => TOUR_ADMIN_ROLE_ID_SET.has(role));
}

export function formatAccountRole(role: AccountRoleID): string {
  const label = Role[role];
  if (!label) return `Role ${role}`;
  return label
    .toLowerCase()
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}
