import { useState } from 'react';
import {
  ODD_COUNT_STRATEGY_LABELS,
  POOLING_PHASE_LABELS,
  SCHEDULE_LOGIC_LABELS,
  TEAM_SCORING_RULE_LABELS,
  getGameFormat,
} from '../../domain/tournament/formats';
import type { TournamentState } from '../../domain/tournament/types';
import {
  Button,
  ButtonRow,
  Field,
  FieldDisplay,
  Input,
  Panel,
  PanelTitle,
  TwoColumnGrid,
} from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';

function gamesLabel(n: number) {
  return n === 1 ? 'Single game' : `${n} games (sum)`;
}

export function TournamentSettingsRecap({ state }: { state: TournamentState }) {
  const format = getGameFormat(state.gameFormat);
  const config = state.gamemodeConfig;
  const isRace = state.scheduleLogic === 'double-elimination';
  const isSingle = state.scheduleLogic === 'single-elimination';
  const poolingPhase = config.poolingPhase ?? state.cfg.poolingPhase ?? 'none';
  return (
    <Panel>
      <PanelTitle>Tournament Settings</PanelTitle>
      <TwoColumnGrid>
        <Field label='Game format'>
          <FieldDisplay>{format?.label ?? state.gameFormat}</FieldDisplay>
        </Field>
        <Field label='Schedule logic'>
          <FieldDisplay>{SCHEDULE_LOGIC_LABELS[state.scheduleLogic]}</FieldDisplay>
        </Field>
        {format?.teamSize ? (
          <Field label='Team scoring'>
            <FieldDisplay>{TEAM_SCORING_RULE_LABELS[config.teamScoringRule ?? 'sum-members']}</FieldDisplay>
          </Field>
        ) : null}
        <Field label='Pooling phase'>
          <FieldDisplay>{POOLING_PHASE_LABELS[poolingPhase]}</FieldDisplay>
        </Field>
        {poolingPhase === 'group-stage' ? (
          <>
            <Field label='Group size'>
              <FieldDisplay>{config.groupSize ?? '—'}</FieldDisplay>
            </Field>
            <Field label='Round-robin'>
              <FieldDisplay>
                {config.roundRobinMode === 'double'
                  ? 'Double — every pair meets twice'
                  : 'Single — every pair meets once'}
              </FieldDisplay>
            </Field>
            <Field label='Qualifiers per group'>
              <FieldDisplay>{config.qualifiersPerGroup ?? '—'}</FieldDisplay>
            </Field>
          </>
        ) : poolingPhase !== 'none' ? (
          <Field label='Advance to bracket'>
            <FieldDisplay>{state.cfg.qualAdv ?? '—'}</FieldDisplay>
          </Field>
        ) : null}
        {config.oddCountStrategy ? (
          <Field label='Odd-count strategy'>
            <FieldDisplay>{ODD_COUNT_STRATEGY_LABELS[config.oddCountStrategy]}</FieldDisplay>
          </Field>
        ) : null}
        <Field label='Scoring system'>
          <FieldDisplay>Fair Points (rank − score ÷ 100000)</FieldDisplay>
        </Field>
        {isRace ? (
          <Field label='Grand Final — wins needed'>
            <FieldDisplay>
              {config.grandFinalWbTarget ?? '—'} / {config.grandFinalLbTarget ?? '—'}
            </FieldDisplay>
          </Field>
        ) : (
          <Field label='Finals format'>
            <FieldDisplay>{gamesLabel(config.finalsGames ?? 1)}</FieldDisplay>
          </Field>
        )}
        {isSingle ? (
          <Field label='Semis format'>
            <FieldDisplay>{gamesLabel(config.semisGames ?? 1)}</FieldDisplay>
          </Field>
        ) : null}
      </TwoColumnGrid>
    </Panel>
  );
}

export function LiveSyncCard() {
  const app = useTournamentApp();
  const [copied, setCopied] = useState(false);
  if (!app.state.tournamentId) return null;
  const url = `${window.location.origin}${window.location.pathname}?t=${encodeURIComponent(app.state.tournamentId)}`;
  const status =
    app.syncStatus.kind === 'unavailable' ? (
      <span className='text-danger'>
        ⚪ Live sync unavailable (couldn&apos;t reach the sync service) — viewers need to refresh manually,
        same as before.
      </span>
    ) : app.syncStatus.kind === 'error' ? (
      <span className='text-danger'>
        🔴 Sync error — viewers may be seeing stale data ({app.syncStatus.message})
      </span>
    ) : app.syncStatus.kind === 'active' ? (
      <span className='text-success'>🟢 Live sync active</span>
    ) : (
      <span className='text-muted'>🔄 Connecting…</span>
    );
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      window.prompt('Copy this link:', url);
    }
  }
  return (
    <Panel id='sync-status-panel'>
      <PanelTitle>Live Sync — viewer link</PanelTitle>
      <Field className='mb-2' label='Viewer link'>
        <Input type='text' readOnly value={url} onClick={(event) => event.currentTarget.select()} />
      </Field>
      <ButtonRow className='items-center gap-2.5'>
        <Button onClick={() => void copy()}>📋 Copy Live Link</Button>
        {copied ? <span className='text-xs text-success'>Copied!</span> : null}
      </ButtonRow>
      <div className='mt-2 text-xs'>{status}</div>
    </Panel>
  );
}
