import { Badge, Panel, PanelTitle } from '../../components/ui';
import { getTourEnvironment } from '../sync/firebase-paths';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { PHASE_TONES } from './phase-display';
import { formatScheduledAt, tournamentFormatLine } from './tournament-info';
import {
  EMPTY_SECTION_TEXTS,
  tournamentSections,
  type TournamentCard,
  type TournamentSections,
} from './tournaments-list';

function TournamentCardButton({ card, onOpen }: { card: TournamentCard; onOpen(): void }) {
  const { summary } = card;
  return (
    <li>
      <button
        className='flex w-full cursor-pointer flex-col items-start gap-1 rounded-lg border border-surface-hover bg-surface-low px-3.5 py-2.5 text-left transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
        onClick={onOpen}
      >
        <span className='font-semibold'>{summary.title.trim() || 'Unnamed Tournament'}</span>
        <span className='flex flex-wrap items-center gap-2 text-xs text-muted'>
          {card.startingSoon ? <Badge tone={PHASE_TONES[card.phase]}>Starting soon</Badge> : null}
          {summary.testRun ? <Badge>Test run</Badge> : null}
          <span>
            {summary.scheduledAt === null
              ? 'Date to be announced'
              : formatScheduledAt(summary.scheduledAt, Date.now(), { relative: card.phase !== 'finished' })}
          </span>
        </span>
        <span className='text-xs text-muted'>
          {tournamentFormatLine(summary)} · {card.unitLabel}
        </span>
      </button>
    </li>
  );
}

function Section({
  title,
  emptyText,
  cards,
  onOpen,
}: {
  title: string;
  emptyText: string;
  cards: TournamentCard[];
  onOpen(card: TournamentCard): void;
}) {
  return (
    <Panel>
      <PanelTitle>{title}</PanelTitle>
      {cards.length ? (
        <ul className='flex flex-col gap-2'>
          {cards.map((card) => (
            <TournamentCardButton key={card.summary.id} card={card} onOpen={() => onOpen(card)} />
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted'>{emptyText}</p>
      )}
    </Panel>
  );
}

/** The Tournaments tab: what is ongoing, what is coming and what is done, and the way to sign in as an admin. */
export function TournamentsView({ onLogIn }: { onLogIn: () => void }) {
  const app = useTournamentApp();
  const ready = app.visitResolved && app.tournaments.status !== 'loading';
  const sections: TournamentSections = tournamentSections(app.tournaments.summaries, {
    env: getTourEnvironment(typeof window === 'undefined' ? undefined : window.location.hostname),
    nowMs: Date.now(),
    isAdmin: app.unlocked,
  });
  const open = (card: TournamentCard) => void app.openTournament(card.summary);
  return (
    <>
      {ready ? (
        <>
          <Section
            title='Ongoing'
            emptyText={EMPTY_SECTION_TEXTS.ongoing}
            cards={sections.ongoing}
            onOpen={open}
          />
          <Section
            title='Upcoming'
            emptyText={EMPTY_SECTION_TEXTS.upcoming}
            cards={sections.upcoming}
            onOpen={open}
          />
          <Section
            title='Finished'
            emptyText={EMPTY_SECTION_TEXTS.finished}
            cards={sections.finished}
            onOpen={open}
          />
        </>
      ) : (
        <Panel>
          <p className='text-sm text-muted'>Loading the tournaments…</p>
        </Panel>
      )}
      {app.unlocked ? null : (
        <button
          className='fixed right-4 bottom-4 cursor-pointer text-xs text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
          onClick={onLogIn}
        >
          Log in as admin
        </button>
      )}
    </>
  );
}
