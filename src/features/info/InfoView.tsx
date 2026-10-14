import { useEffect, useState } from 'react';
import { Panel, PanelTitle } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { formatScheduledAt, tournamentFormatLine } from '../tournaments/tournament-info';
import { RulesText } from './RulesText';
import { ScreenshotGallery } from './ScreenshotGallery';

export const GENERAL_RULES_URL = 'https://info.curvefever.pro/tournaments/tournament-rules';

/** The scheduled time in the time zone of the viewer; empty until the page is in the browser, where that zone is known. */
function useScheduledText(scheduledAt: number | null): string | null {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (scheduledAt === null) return;
    const refresh = () => setText(formatScheduledAt(scheduledAt, Date.now()));
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [scheduledAt]);
  return scheduledAt === null ? null : text;
}

/** Leaves the loaded tournament. Only here: a player could read "Exit tournament" as unregistering. */
function ExitTournamentButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      className='flex h-10 cursor-pointer items-center gap-2 rounded border border-input-border px-3.5 text-sm font-bold whitespace-nowrap text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
      onClick={onExit}
    >
      <span aria-hidden='true' className='text-[15px]'>
        ✕
      </span>
      Exit tournament view
    </button>
  );
}

/** The Info tab: what a visitor needs to know before and during the tournament. */
export function InfoView() {
  const { exitTournament, state, tournaments } = useTournamentApp();
  const summary = tournaments.summaries.find((entry) => entry.id === state.tournamentId);
  const scheduledAt = state.info?.scheduledAt ?? null;
  const scheduledText = useScheduledText(scheduledAt);
  const format = summary ?? {
    gameFormat: state.gameFormat,
    poolingPhase: state.cfg.poolingPhase ?? 'none',
    scheduleLogic: state.scheduleLogic,
  };
  const title = state.title.trim() || summary?.title.trim() || 'Unnamed Tournament';
  const rulesText = state.info?.rulesText.trim() ?? '';
  const imageIds = state.info?.screenshots ?? [];
  return (
    <>
      <div className='mb-4 flex justify-end'>
        <ExitTournamentButton onExit={() => void exitTournament()} />
      </div>
      <Panel>
        <PanelTitle>{title}</PanelTitle>
        <p className='mb-1 text-lg font-semibold' suppressHydrationWarning>
          {scheduledAt === null ? 'Date to be announced' : (scheduledText ?? '\u00a0')}
        </p>
        <p className='text-sm text-muted'>{tournamentFormatLine(format)}</p>
      </Panel>
      {state.tournamentId && imageIds.length ? (
        <Panel>
          <PanelTitle>Lobby</PanelTitle>
          <ScreenshotGallery tournamentId={state.tournamentId} imageIds={imageIds} />
        </Panel>
      ) : null}
      {rulesText ? (
        <Panel>
          <PanelTitle>Rules</PanelTitle>
          <RulesText text={rulesText} />
        </Panel>
      ) : null}
      <Panel>
        <p className='text-sm'>
          <a
            className='text-primary underline'
            href={GENERAL_RULES_URL}
            target='_blank'
            rel='noopener noreferrer'
          >
            General tournament rules
          </a>
        </p>
      </Panel>
    </>
  );
}
