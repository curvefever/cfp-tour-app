import type { InputHTMLAttributes } from 'react';
import { Input } from '../../../components/ui';

/** What the app has to say about a number field: the number it would use, and whether the field is typed. */
export interface AppValue {
  /** Null when there is no plan to read it from. */
  value: string | null;
  typed: boolean;
}

/** "app: 4", or the field's own words when there is no number to show. */
export const appPlaceholder = (app: AppValue, fallback: string): string =>
  app.value === null ? fallback : `app: ${app.value}`;

/** Under a typed number: what the app would use in its place. */
export function WouldUseLine({ app }: { app: AppValue }) {
  if (!app.typed || app.value === null) return null;
  return <p className='mt-1 text-xs text-muted'>The app would use {app.value}.</p>;
}

/**
 * A field whose number the app works out while it is empty: the app's number as its placeholder, and under a typed one
 * the number the app would use. `fallback` is the placeholder while there is no number.
 */
export function AppValueInput({
  app,
  fallback,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { app: AppValue; fallback?: string }) {
  return (
    <>
      <Input {...input} placeholder={appPlaceholder(app, fallback ?? '')} />
      <WouldUseLine app={app} />
    </>
  );
}
