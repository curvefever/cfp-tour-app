import type { TournamentState } from '../../../domain/tournament/types';
import {
  serializeWaterfallDraft,
  waterfallDraftFromRounds,
} from '../../../domain/tournament/waterfall-draft';
import { Panel, PanelTitle } from '../../../components/ui';
import { WaterfallGraphEditor } from './WaterfallGraphEditor';

/** Admin-only view of a running waterfall bracket's graph, rebuilt from `state.rounds` (the live source of truth), not the `settings.waterfallGraph` snapshot. */
export function RunningWaterfallPanel({ state }: { state: TournamentState }) {
  const roomSize = state.gamemodeConfig.roomSize;
  if (!roomSize) return null;
  const entryRound = state.rounds.find((round) => round.isWaterfall);
  const text = serializeWaterfallDraft(waterfallDraftFromRounds(state.rounds));
  return (
    <Panel>
      <PanelTitle>Waterfall bracket graph</PanelTitle>
      <WaterfallGraphEditor
        entrantCount={entryRound?.players ?? null}
        onChange={() => {}}
        readOnly
        roomSize={roomSize}
        text={text}
      />
    </Panel>
  );
}
