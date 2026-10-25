import { Fragment } from 'react';
import { cn } from '../../components/ui';
import { parseRulesText, type RulesInline } from './rules-text';

function Inline({ part }: { part: RulesInline }) {
  if (part.kind === 'bold') return <strong>{part.text}</strong>;
  if (part.kind === 'link') {
    return (
      <a className='text-primary underline' href={part.href} rel='noopener noreferrer' target='_blank'>
        {part.text}
      </a>
    );
  }
  return <>{part.text}</>;
}

export function Inlines({ parts }: { parts: RulesInline[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Inline key={index} part={part} />
      ))}
    </>
  );
}

/** A tournament's rules text, built as React elements from the parsed text: nothing in it is ever treated as HTML. */
export function RulesText({ className, text }: { className?: string; text: string }) {
  return (
    <div className={cn('flex flex-col gap-3 text-sm leading-relaxed', className)}>
      {parseRulesText(text).map((block, index) =>
        block.kind === 'list' ? (
          <ul key={index} className='list-disc pl-5'>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <Inlines parts={line} />
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
