const pad = (value: number) => String(value).padStart(2, '0');

/** The text a `datetime-local` input holds for `ms`, in the time zone of the browser; empty when there is no time. */
export function toDateTimeLocalValue(ms: number | null): string {
  if (ms === null) return '';
  const date = new Date(ms);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The epoch milliseconds a `datetime-local` input text means in the time zone of the browser; null when it is empty or invalid. */
export function fromDateTimeLocalValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** A name that is only an offset ("GMT+2", "GMT-4"), not a lettered zone name. */
const OFFSET_NAME = /^(GMT|UTC)[+-]/;

function zoneName(ms: number, locale: string, style: 'short' | 'shortOffset', timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style }).formatToParts(
    new Date(ms),
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}

/**
 * The short name of a time zone at `ms`, the browser's own by default: a lettered name when British or American English
 * has one ("CEST", "BST", "EDT"), else the GMT offset ("GMT+5:30"). The browser's language doesn't change it.
 */
export function timeZoneLabel(ms: number, timeZone?: string): string {
  const lettered = ['en-GB', 'en-US']
    .map((locale) => zoneName(ms, locale, 'short', timeZone))
    .find((name) => name !== '' && !OFFSET_NAME.test(name));
  return lettered ?? zoneName(ms, 'en-GB', 'shortOffset', timeZone);
}
