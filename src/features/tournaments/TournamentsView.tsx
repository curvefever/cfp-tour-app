import { Badge, PageHeading, Panel, cn } from '../../components/ui';
import { ColumnTitleBar } from '../bracket/ColumnTitleBar';
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
  const ongoing = card.phase === 'ongoing';
  return (
    <li>
      <button
        className={cn(
          'flex w-full cursor-pointer flex-col items-start gap-1.5 rounded-xs bg-cfp-game-card px-4.5 py-4 text-left outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          ongoing ? 'outline-cfp-violet' : 'outline-cfp-game-frame',
        )}
        onClick={onOpen}
      >
        <span className='flex flex-wrap items-center gap-2'>
          <span className='text-[19px] font-bold'>{summary.title.trim() || 'Unnamed Tournament'}</span>
          {ongoing ? <Badge tone='now'>Now</Badge> : null}
          {card.startingSoon ? <Badge tone={PHASE_TONES[card.phase]}>Starting soon</Badge> : null}
          {summary.testRun ? <Badge className='text-muted'>Test run</Badge> : null}
        </span>
        <span className='text-[15px]'>
          {summary.scheduledAt === null
            ? 'Date to be announced'
            : formatScheduledAt(summary.scheduledAt, Date.now(), { relative: card.phase !== 'finished' })}
        </span>
        <span className='text-sm text-muted'>
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
    <section aria-label={title} className='flex flex-col gap-3'>
      <ColumnTitleBar title={title} />
      {cards.length ? (
        <ul className='grid grid-cols-[repeat(auto-fill,minmax(min(460px,100%),1fr))] gap-3.5'>
          {cards.map((card) => (
            <TournamentCardButton key={card.summary.id} card={card} onOpen={() => onOpen(card)} />
          ))}
        </ul>
      ) : (
        <p className='px-1 py-3.5 text-base text-muted'>{emptyText}</p>
      )}
    </section>
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
      <PageHeading title='Tournaments' />
      {ready ? (
        <div className='flex flex-col gap-6.5'>
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
        </div>
      ) : (
        <Panel>
          <p className='text-sm text-muted'>Loading the tournaments…</p>
        </Panel>
      )}
      {app.unlocked ? null : (
        <button
          className='fixed right-5 bottom-4.5 cursor-pointer text-sm font-bold text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary max-[700px]:static max-[700px]:mt-8 max-[700px]:block'
          onClick={onLogIn}
        >
          Log in as admin
        </button>
      )}
    </>
  );
}
