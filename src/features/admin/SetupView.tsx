import { useState } from 'react';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { generateTournament } from '../../domain/tournament/generation';
import { applyTournamentSettings } from '../../domain/tournament/tournament-settings';
import type { RoundNotes, TournamentSettings } from '../../domain/tournament/types';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { InfoContentPanel } from './InfoContentPanel';
import { ConfirmStartBar } from './setup/ConfirmStartBar';
import { FormatPanel } from './setup/FormatPanel';
import { RosterPanel } from './setup/RosterPanel';
import { SchedulePreviewPanel } from './setup/SchedulePreviewPanel';
import { TournamentPanel } from './setup/TournamentPanel';
import { WaterfallPanel } from './setup/WaterfallPanel';

export function SetupView() {
  const { state, setup, runtime, updateSetup, updateState } = useTournamentApp();
  const [error, setError] = useState('');
  const [lbQualifiers, setLbQualifiers] = useState('2');

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
    rulesText: string,
    roundNotes: RoundNotes | undefined,
  ): string {
    const previousGameFormat = setup.gameFormat;
    updateSetup((current) => applyTournamentSettings(current, settings));
    if (rulesText || roundNotes) {
      updateState((current) => ({
        ...current,
        info: {
          ...(current.info ?? createDefaultInfo()),
          ...(rulesText ? { rulesText } : {}),
          ...(roundNotes ? { roundNotes } : {}),
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
    return message;
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
        <WaterfallPanel lbQualifiers={lbQualifiers} />
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
