import { PRESENCE_REPEAT_MS } from './presence.shared';

export type SendPresence = (tournamentId: string, field: string | null) => Promise<unknown>;

/**
 * Tells the database which field of a tournament's Setup this admin is in: once on entering it, again every
 * `PRESENCE_REPEAT_MS` while they stay, and `null` on leaving. Nothing else is sent. The calls go one after the
 * other, so an older one can never land after a newer one, and a failed call is dropped (the others' tags
 * simply fade after `PRESENCE_STALE_MS`).
 */
export class PresenceSender {
  private field: string | null = null;
  private announced = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly tournamentId: string,
    private readonly send: SendPresence,
    /** Whether the admin is still in `field`; a field that went away without a blur ends the announcement. */
    private readonly stillIn: (field: string) => boolean = () => true,
    private readonly repeatMs: number = PRESENCE_REPEAT_MS,
  ) {}

  enter(field: string): void {
    this.field = field;
    this.announce();
    this.startRepeating();
  }

  /** The admin left `field`; a field they already left for another one is ignored. */
  leave(field: string): void {
    if (this.field !== field) return;
    this.field = null;
    this.stopRepeating();
    this.clear();
  }

  /** The tab is hidden or closing: the announcement is withdrawn, and resumes with `show` if the field is still the admin's. */
  hide(): void {
    this.stopRepeating();
    this.clear();
  }

  show(): void {
    if (!this.field) return;
    this.announce();
    this.startRepeating();
  }

  /** The tournament is unloaded or switched. */
  dispose(): void {
    this.field = null;
    this.stopRepeating();
    this.clear();
  }

  private announce(): void {
    if (!this.field) return;
    this.announced = true;
    this.post(this.field);
  }

  private clear(): void {
    if (!this.announced) return;
    this.announced = false;
    this.post(null);
  }

  private startRepeating(): void {
    this.stopRepeating();
    this.timer = setInterval(() => {
      if (this.field && !this.stillIn(this.field)) this.leave(this.field);
      else this.announce();
    }, this.repeatMs);
  }

  private stopRepeating(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private post(field: string | null): void {
    this.queue = this.queue.then(() => this.send(this.tournamentId, field)).catch(() => undefined);
  }
}
