import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { subscribePresence, subscribeServerClockOffset } from '../sync/firebase-client';
import { PresenceSender } from './presence-sender';
import { activeEditors, fieldOfControl, type PresenceMap } from './presence.shared';
import { setSetupPresence } from './presence.server-fns';

const CLOCK_TICK_MS = 5000;

interface PresenceContextValue {
  /** The names of the other admins who are in each field right now. */
  editors: Record<string, string[]>;
}

const NO_EDITORS: PresenceContextValue = { editors: {} };

const PresenceContext = createContext<PresenceContextValue>(NO_EDITORS);

/** Who else is in which field; nobody outside a `PresenceProvider`. */
export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

/** The other admins who are in each field of the tournament, kept current; the age of an announcement is read on the database clock. */
function useEditors(tournamentId: string): Record<string, string[]> {
  const { userId } = useAuth();
  const [presence, setPresence] = useState<PresenceMap>({});
  const [clockOffset, setClockOffset] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tournamentId) return;
    const stopPresence = subscribePresence(tournamentId, setPresence);
    const stopClock = subscribeServerClockOffset(setClockOffset);
    // Nobody sends anything to end an announcement, so staleness is checked on a clock too.
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => {
      stopPresence?.();
      stopClock?.();
      clearInterval(timer);
      setPresence({});
    };
  }, [tournamentId]);
  return useMemo(
    () => activeEditors(presence, userId, now + clockOffset),
    [presence, userId, now, clockOffset],
  );
}

function fieldInFocus(): string | null {
  return fieldOfControl(document.activeElement?.id);
}

/** Announces the field this admin is in, and withdraws it when they leave it, hide the tab or close it. */
function usePresenceSender(tournamentId: string) {
  const sender = useRef<PresenceSender | null>(null);
  useEffect(() => {
    if (!tournamentId) return;
    const created = new PresenceSender(
      tournamentId,
      (id, field) => setSetupPresence({ data: { tournamentId: id, field } }),
      (field) => fieldInFocus() === field,
    );
    sender.current = created;
    const onVisibility = () => (document.visibilityState === 'hidden' ? created.hide() : created.show());
    const onPageHide = () => created.hide();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      created.dispose();
      sender.current = null;
    };
  }, [tournamentId]);
  const onFocus = useCallback((event: FocusEvent) => {
    const field = fieldOfControl((event.target as HTMLElement).id);
    if (field) sender.current?.enter(field);
  }, []);
  const onBlur = useCallback((event: FocusEvent) => {
    const field = fieldOfControl((event.target as HTMLElement).id);
    if (field) sender.current?.leave(field);
  }, []);
  return { onFocus, onBlur };
}

/**
 * Around the admin screen of a loaded tournament: the focus of every form control inside it is announced to the
 * other admins, and the announcements of theirs are shown as tags (see `PresenceField`). Presence is only shown:
 * it never goes through the tournament's or the Setup form's sync.
 */
export function PresenceProvider({ tournamentId, children }: { tournamentId: string; children: ReactNode }) {
  const editors = useEditors(tournamentId);
  const { onFocus, onBlur } = usePresenceSender(tournamentId);
  const value = useMemo(() => ({ editors }), [editors]);
  return (
    <PresenceContext.Provider value={value}>
      <div onFocus={onFocus} onBlur={onBlur}>
        {children}
      </div>
    </PresenceContext.Provider>
  );
}
