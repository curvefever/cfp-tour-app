import { cn } from '../../components/ui';
import { ordinal } from '../../lib/ordinal';
import type { Medal, PodiumCard } from './ranking-podium';

const MEDAL_BAR: Record<Medal, string> = {
  gold: 'bg-cfp-gold',
  silver: 'bg-cfp-silver',
  bronze: 'bg-cfp-bronze',
};

const MEDAL_TEXT: Record<Medal, string> = {
  gold: 'text-cfp-gold',
  silver: 'text-cfp-silver',
  bronze: 'text-cfp-bronze',
};

function PodiumStep({ card }: { card: PodiumCard }) {
  const winner = card.rank === 1;
  return (
    <div className='min-w-60 flex-[0_1_300px] overflow-hidden rounded-xs bg-cfp-game-card outline-2 outline-cfp-game-frame'>
      <div className={cn('h-2.5', MEDAL_BAR[card.medal])} />
      <div
        className={cn(
          'flex flex-col items-center gap-1.5 px-4.5 text-center',
          winner ? 'pt-6.5 pb-7' : 'pt-4.5 pb-5',
        )}
      >
        <div
          className={cn(
            'leading-none font-extrabold',
            winner ? 'text-[52px]' : 'text-[40px]',
            MEDAL_TEXT[card.medal],
          )}
        >
          {ordinal(card.rank)}
        </div>
        <div className='text-2xl font-bold'>{card.label}</div>
        {card.members?.length ? <div className='text-sm text-muted'>{card.members.join(' · ')}</div> : null}
        <div className='text-sm text-muted'>{card.line}</div>
      </div>
    </div>
  );
}

/** The first three places, second · first · third, each under a gold, silver or bronze bar. */
export function Podium({ cards }: { cards: PodiumCard[] }) {
  return (
    <section aria-label='Podium' className='flex flex-wrap items-end justify-center gap-4.5 pt-2 pb-1.5'>
      {cards.map((card) => (
        <PodiumStep card={card} key={card.key} />
      ))}
    </section>
  );
}
