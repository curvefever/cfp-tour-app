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

/** The short name of the time zone of the browser at `ms` ("CEST", "GMT+2"), for labelling a time an admin types. */
export function timeZoneLabel(ms: number, locale?: string): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short' }).formatToParts(new Date(ms));
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
}
