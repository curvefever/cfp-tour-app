import { useState } from 'react';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { generateTournament } from '../../domain/tournament/generation';
import { rosterKeys } from '../../domain/tournament/roster';
import { infoWithRenamedRounds } from '../../domain/tournament/round-notes';
import { applyTournamentSettings } from '../../domain/tournament/tournament-settings';
import type { TournamentSettings } from '../../domain/tournament/types';
import { renumberWaterfallDefaults } from '../../domain/tournament/waterfall-numbering';
import { useTournamentApp } from '../tournament/TournamentProvider';
import type { CopyOutcome } from './copy-settings/CopySettingsPanel';
import type { CopiedInfo } from './copy-settings/past-tournament-settings';
import { InfoContentPanel } from './InfoContentPanel';
import { ConfirmStartBar } from './setup/ConfirmStartBar';
import { FormatPanel } from './setup/FormatPanel';
import { RosterPanel } from './setup/RosterPanel';
import { SchedulePreviewPanel } from './setup/SchedulePreviewPanel';
import { TournamentPanel } from './setup/TournamentPanel';
import { useWaterfallNumbering } from './setup/useWaterfallNumbering';
import { WaterfallPanel } from './setup/WaterfallPanel';

/** The two settings a renumbering rewrites. */
function numberedGraphOf({ graph, numberedFrom }: { graph: string; numberedFrom: string }) {
  return { waterfallGraph: graph, waterfallNumberedFrom: numberedFrom };
}

export function SetupView() {
  const { state, setup, runtime, updateSetup, updateState } = useTournamentApp();
  const [error, setError] = useState('');
  const [lbQualifiers, setLbQualifiers] = useState('2');
  const numbering = useWaterfallNumbering();

  function generate() {
    const result = generateTournament(state, { ...setup, lbQualifiers }, runtime);
    if (result.status === 'invalid') {
      setError(result.message);
      return;
    }
    setError('');
    updateState(result.state);
  }

  function applyCopiedSettings(
    settings: TournamentSettings,
    sourceTitle: string,
    { rulesText, roundNotes, gameNotes }: CopiedInfo,
  ): CopyOutcome {
    const previousGameFormat = setup.gameFormat;
    // The copied graph's default names ("Round 4") are numbered for the source's pooling rounds: renumber them for
    // this tournament's, with the copied notes. The pictures arrive later, under the source's names.
    const renumbering = renumberWaterfallDefaults(
      applyTournamentSettings(setup, settings),
      rosterKeys(state.players).length,
    );
    const renames = renumbering?.renames ?? new Map<string, string>();
    const copied = renumbering ? { ...settings, ...numberedGraphOf(renumbering) } : settings;
    updateSetup((current) => applyTournamentSettings(current, copied));
    if (rulesText || roundNotes || gameNotes) {
      const carried = infoWithRenamedRounds({ ...createDefaultInfo(), roundNotes, gameNotes }, renames);
      updateState((current) => ({
        ...current,
        info: {
          ...(current.info ?? createDefaultInfo()),
          ...(rulesText ? { rulesText } : {}),
          ...(carried.roundNotes ? { roundNotes: carried.roundNotes } : {}),
          ...(carried.gameNotes ? { gameNotes: carried.gameNotes } : {}),
        },
      }));
    }
    setLbQualifiers(settings.lbQualifiers);
    let message = `Copied settings from "${sourceTitle}".`;
    if (state.rounds.length && !state.started) {
      message += ' Generate the schedule again: the preview below still uses the previous settings.';
    }
    if (state.confirmedCount !== null && settings.gameFormat !== previousGameFormat) {
      message += ' The game format changed: load the roster again.';
    }
    return {
      message,
      ...(renames.size > 0 ? { movePictures: () => numbering.movePictures(renames) } : {}),
    };
  }

  return (
    <div className='flex flex-wrap items-start gap-5' id='panel-setup'>
      <div className='flex min-w-0 flex-[999_1_560px] flex-col gap-4.5 [&>*]:mb-0'>
        <TournamentPanel onApplyCopiedSettings={applyCopiedSettings} />
        <FormatPanel
          error={error}
          lbQualifiers={lbQualifiers}
          onGenerate={generate}
          setLbQualifiers={setLbQualifiers}
        />
        <WaterfallPanel lbQualifiers={lbQualifiers} numbering={numbering} />
        <InfoContentPanel />
        <RosterPanel onLoaded={() => setError('')} />
      </div>
      <aside className='flex min-w-0 flex-[1_1_340px] flex-col gap-3.5 [&>*]:mb-0'>
        <SchedulePreviewPanel />
      </aside>
      <ConfirmStartBar pinned />
    </div>
  );
}
