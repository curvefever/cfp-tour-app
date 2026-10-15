import { Badge, PageHeading, Panel, cn } from '../../components/ui';
import { ColumnTitleBar } from '../bracket/ColumnTitleBar';
import type { TournamentWinner } from '../../domain/tournament/rankings';
import { getTourEnvironment } from '../sync/firebase-paths';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { PHASE_TONES } from './phase-display';
import { scheduledParts, tournamentFormatLine } from './tournament-info';
import {
  EMPTY_SECTION_TEXTS,
  tournamentSections,
  type TournamentCard,
  type TournamentSections,
} from './tournaments-list';

/** The bottom of a finished card: a green marker, "WINNER", and the name with a team's members under it (a tie shows each). */
function WinnerRow({ winners }: { winners: TournamentWinner[] }) {
  return (
    <span className='mt-1.5 flex w-full items-center gap-3 border-t border-cfp-game-fold pt-3'>
      <span aria-hidden='true' className='min-h-6 w-1.25 shrink-0 self-stretch rounded-xs bg-cfp-green' />
      <span className='shrink-0 text-[11px] leading-none font-extrabold tracking-[0.08em] text-muted'>
        WINNER
      </span>
      <span className='flex min-w-0 flex-1 flex-wrap gap-x-8 gap-y-2'>
        {winners.map((winner) => (
          <span className='flex min-w-0 flex-col gap-0.5' key={winner.label}>
            <span className='text-base font-bold'>{winner.label}</span>
            {winner.members?.length ? (
              <span className='text-sm leading-snug text-muted'>{winner.members.join(' · ')}</span>
            ) : null}
          </span>
        ))}
      </span>
    </span>
  );
}

/** The card's date in bold, and how far away it is in light blue ("Sat 18 Oct, 20:00 · in 5 days"). */
function ScheduledLine({
  phase,
  scheduledAt,
}: {
  phase: TournamentCard['phase'];
  scheduledAt: number | null;
}) {
  if (scheduledAt === null) return <span className='text-[15px] font-bold'>Date to be announced</span>;
  const { date, relative } = scheduledParts(scheduledAt, Date.now(), { relative: phase !== 'finished' });
  return (
    <span className='text-[15px]'>
      <span className='font-bold'>{date}</span>
      {relative ? <span className='text-cfp-sky'> · {relative}</span> : null}
    </span>
  );
}

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
        <ScheduledLine phase={card.phase} scheduledAt={summary.scheduledAt} />
        <span className='text-sm text-muted'>
          {tournamentFormatLine(summary)} · {card.unitLabel}
        </span>
        {card.phase === 'finished' && summary.winners?.length ? (
          <WinnerRow winners={summary.winners} />
        ) : null}
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
        <div className='flex flex-col gap-6.5 pb-10'>
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
