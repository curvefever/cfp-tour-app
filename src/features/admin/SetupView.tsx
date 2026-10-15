import { useState } from 'react';
import { createDefaultInfo } from '../../domain/tournament/state-defaults';
import { generateTournament } from '../../domain/tournament/generation';
import { applyTournamentSettings } from '../../domain/tournament/tournament-settings';
import type { TournamentSettings } from '../../domain/tournament/types';
import { TwoColumnGrid } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { CopySettingsPanel } from './copy-settings/CopySettingsPanel';
import { InfoContentPanel } from './InfoContentPanel';
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

  function applyCopiedSettings(settings: TournamentSettings, sourceTitle: string, rulesText: string): string {
    const previousGameFormat = setup.gameFormat;
    updateSetup((current) => applyTournamentSettings(current, settings));
    if (rulesText) {
      updateState((current) => ({
        ...current,
        info: { ...(current.info ?? createDefaultInfo()), rulesText },
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
    <div id='panel-setup'>
      <TournamentPanel />
      <InfoContentPanel />
      <CopySettingsPanel onApply={applyCopiedSettings} />
      <TwoColumnGrid>
        <FormatPanel
          error={error}
          lbQualifiers={lbQualifiers}
          onGenerate={generate}
          setLbQualifiers={setLbQualifiers}
        />
        <RosterPanel onLoaded={() => setError('')} />
      </TwoColumnGrid>
      <WaterfallPanel lbQualifiers={lbQualifiers} />
      <SchedulePreviewPanel />
    </div>
  );
}
