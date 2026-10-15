import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type AlertTone = 'info' | 'success' | 'danger' | 'warning';
const alertTone: Record<AlertTone, string> = {
  info: 'border-primary/55 bg-primary-soft text-foreground',
  success: 'border-success/55 bg-success/10 text-cfp-green-text',
  danger: 'border-danger/55 bg-danger-soft text-cfp-danger-text',
  warning: 'border-warning/55 bg-warning/10 text-cfp-orange-text',
};

export function Alert({
  className,
  tone = 'info',
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: AlertTone }) {
  return (
    <div
      className={cn(
        'rounded-(--app-radius-button) border-2 px-3.5 py-2.5 text-sm leading-relaxed',
        alertTone[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Modal({
  children,
  className,
  title,
  titleId,
}: {
  children: ReactNode;
  className?: string;
  title: ReactNode;
  titleId?: string;
}) {
  return (
    <div
      className='fixed inset-0 z-1000 flex items-center justify-center bg-black/75 p-5'
      role='presentation'
    >
      <div
        aria-labelledby={titleId}
        aria-modal='true'
        className={cn(
          'w-full max-w-110 rounded-md border border-surface-hover bg-surface p-5.5 shadow-[0_20px_80px_var(--shadow-floating)]',
          className,
        )}
        role='dialog'
      >
        <div className='mb-3.5 text-xl font-bold text-primary' id={titleId}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalActions({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-4 flex flex-wrap justify-end gap-2.5', className)} {...props} />;
}
