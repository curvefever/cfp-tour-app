import { getGameFormat } from '../../../domain/tournament/formats';
import { finalsMatchOf } from '../../../domain/tournament/waterfall-draft';
import { Alert, SectionPanel } from '../../../components/ui';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import { WaterfallGraphEditor } from '../waterfall/WaterfallGraphEditor';
import { setupDerived } from './setup-derived';
import { useSetupNumbering } from './useWaterfallNumbering';

/** The waterfall bracket graph, for a tournament whose schedule logic is the waterfall bracket. */
export function WaterfallPanel({ lbQualifiers }: { lbQualifiers: string }) {
  const { state, setup } = useTournamentApp();
  const numbering = useSetupNumbering();
  const format = getGameFormat(setup.gameFormat);
  const {
    derivedRoomSize,
    isWaterfallBracket,
    waterfallEntrantCount,
    waterfallGroupSizes,
    waterfallStandingsKind,
    waterfallStandingsSource,
  } = setupDerived(setup, state, lbQualifiers);
  if (!isWaterfallBracket || !format || !numbering) return null;
  return (
    <SectionPanel
      hint='route the ranks of every room that go on; the rest are out'
      title='CUSTOM BRACKET GRAPH'
    >
      <WaterfallGraphEditor
        entrantCount={waterfallEntrantCount}
        groupExit={setup.groupExit}
        groupSizes={waterfallGroupSizes}
        finalsMatch={finalsMatchOf(
          Number.parseInt(setup.finalsGames, 10) || undefined,
          Number.parseInt(setup.finalsBestOf, 10) || undefined,
        )}
        firstRoundNumber={numbering.firstRoundNumber}
        onChange={numbering.changeGraph}
        roomSize={derivedRoomSize}
        standingsKind={waterfallStandingsKind ?? undefined}
        standingsSource={waterfallStandingsSource}
        text={setup.waterfallGraph}
      />
      {numbering.pictureError ? (
        <Alert className='mt-3' id='waterfall-picture-error' tone='danger'>
          The settings pictures could not follow the renamed rounds: {numbering.pictureError}
        </Alert>
      ) : null}
      <p className='mt-3 text-xs text-muted'>
        Every round, room count/size, and rank routing is set up here, and can still be corrected from the
        Admin tab while the tournament is running. There's no automatic reseeding beyond that, no automatic
        bye/lucky-loser handling, and reserves can't be added once a tournament starts on this schedule logic.
      </p>
    </SectionPanel>
  );
}
