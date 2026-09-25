import { useState } from 'react';
import { waterfallFlowEdges, type WaterfallDraft } from '../../../domain/tournament/waterfall-draft';
import { Alert, Button } from '../../../components/ui';
import { describeFlowEdge, destinationColor, destinationName } from './waterfall-format';

export type GraphStatus = { ok: true } | { ok: false; error: string };

export function WaterfallSidePanel({
  draft,
  status,
  entrantCount,
  text,
}: {
  draft: WaterfallDraft;
  status: GraphStatus;
  entrantCount: number | null;
  text: string;
}) {
  // Remember which text was copied, so the label reverts once the graph changes.
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const copied = copiedText === text;
  const edges = waterfallFlowEdges(draft);
  const roomCountOf = (label: string) => draft.rounds.find((round) => round.label === label)?.roomCount ?? 1;
  const copyText = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopiedText(text))
      .catch(() => setCopiedText(null));
  };

  return (
    <div className='min-w-0'>
      {status.ok ? (
        <Alert tone='success'>
          <b>Ready to generate.</b>
          {entrantCount === null ? (
            <span className='mt-1 block text-xs'>
              Load a roster (and set "Advance to bracket") to also check the starting round against your
              entering players.
            </span>
          ) : null}
        </Alert>
      ) : (
        <Alert tone='danger'>
          <b>Next thing to fix</b>
          <span className='mt-1 block text-xs'>{status.error}</span>
        </Alert>
      )}

      <div className='mt-4 mb-2 text-[0.72rem] font-semibold tracking-[0.12em] text-muted uppercase'>
        Where everyone goes
      </div>
      {edges.length === 0 ? <p className='text-sm text-muted'>Nothing routed yet.</p> : null}
      {edges.map((edge) => (
        <div className='flex items-baseline gap-2 py-0.5 text-sm' key={`${edge.from}>${edge.to}`}>
          <span
            className='size-2.5 flex-none rounded-sm'
            style={{ background: destinationColor(draft, edge.to) }}
          />
          <span>
            <b>{edge.from}</b> → {destinationName(edge.to)}{' '}
            <span className='text-muted'>
              {edge.players} player{edge.players > 1 ? 's' : ''} ·{' '}
              {describeFlowEdge(edge, roomCountOf(edge.from))}
            </span>
          </span>
        </div>
      ))}

      <details className='mt-4'>
        <summary className='cursor-pointer text-sm text-muted'>View as text</summary>
        <pre className='mt-2 overflow-x-auto rounded-[5px] bg-background p-3 font-mono text-xs whitespace-pre-wrap'>
          {text}
        </pre>
        <Button onClick={copyText} size='sm'>
          {copied ? 'Copied' : 'Copy text'}
        </Button>
      </details>
    </div>
  );
}
