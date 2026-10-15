import type { ReactNode } from 'react';
import { panelLabelClassName } from '../../components/ui/typography';

/** A part of the Tournament progress section under its stage list: a small caps title, an optional hint, a body. */
export function ProgressSubsection({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <div className='flex flex-col gap-3.5 border-t border-surface-hover px-5 pt-4.5 pb-5'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
        <h3 className={panelLabelClassName}>{title}</h3>
        {hint ? <div className='text-[13px] text-muted'>{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
