import { getGameFormat } from '../../../domain/tournament/formats';
import { finalsMatchOf } from '../../../domain/tournament/waterfall-draft';
import { SectionPanel } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { WaterfallGraphEditor } from '../waterfall/WaterfallGraphEditor';
import { setupDerived } from './setup-derived';
import { useSetupChange } from './useSetupChange';

/** The waterfall bracket graph, for a tournament whose schedule logic is the waterfall bracket. */
export function WaterfallPanel({ lbQualifiers }: { lbQualifiers: string }) {
  const { state, setup } = useTournamentApp();
  const change = useSetupChange();
  const format = getGameFormat(setup.gameFormat);
  const { derivedRoomSize, isWaterfallBracket, waterfallEntrantCount, waterfallStandingsSource } =
    setupDerived(setup, state, lbQualifiers);
  if (!isWaterfallBracket || !format) return null;
  return (
    <SectionPanel
      hint='route the ranks of every room that go on; the rest are out'
      title='CUSTOM BRACKET GRAPH'
    >
      <WaterfallGraphEditor
        entrantCount={waterfallEntrantCount}
        finalsMatch={finalsMatchOf(
          Number.parseInt(setup.finalsGames, 10) || undefined,
          Number.parseInt(setup.finalsBestOf, 10) || undefined,
        )}
        onChange={(text) => change('waterfallGraph', text)}
        roomSize={derivedRoomSize}
        standingsSource={waterfallStandingsSource}
        text={setup.waterfallGraph}
      />
      <p className='mt-3 text-xs text-muted'>
        Every round, room count/size, and rank routing is set up here, and can still be corrected from the
        Admin tab while the tournament is running. There's no automatic reseeding beyond that, no automatic
        bye/lucky-loser handling, and reserves can't be added once a tournament starts on this schedule logic.
      </p>
    </SectionPanel>
  );
}
