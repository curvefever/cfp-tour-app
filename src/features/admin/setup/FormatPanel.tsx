import { useMemo } from 'react';
import {
  ODD_COUNT_STRATEGY_LABELS,
  TEAM_SCORING_RULE_LABELS,
  getGameFormat,
  resolveOddCountStrategy,
} from '../../../domain/tournament/formats';
import { SCORING_SYSTEM_OPTION_LABELS } from '../../../domain/tournament/scoring';
import type { PersistedSetup } from '../../../domain/tournament/types';
import { Alert, Button, ButtonRow, Input, SectionPanel, Select } from '../../../components/ui';
import { EditingTag } from '../../presence/EditingTag';
import { PresenceField } from '../../presence/PresenceField';
import { useTournamentApp } from '../../tournament/TournamentProvider';
import {
  DRAW_PUBLICATION_LABELS,
  ROUND_ROBIN_LABELS,
  gamesLabel,
  visibleFormatFields,
} from './format-fields';
import { GameFormatFields } from './GameFormatFields';
import { nextTeamScoringRule } from './game-format-choice';
import { setupDerived } from './setup-derived';
import { useSetupChange } from './useSetupChange';

/**
 * A format or odd-count-strategy change can make the currently-selected
 * schedule logic unavailable (its own `<option>` disappears from the
 * dropdown) without resetting the already-selected value -- shared by
 * `changeFormat` and `changeOddCountStrategy` so the two callers can't drift
 * apart. `headToHeadOnly` alone decides the Kings Valley branch since an
 * odd-count-strategy change never flips it (the gate is by format only).
 */
function reconcileScheduleLogicForFormat(
  current: PersistedSetup['scheduleLogic'],
  raceCompatible: boolean,
  headToHeadOnly: boolean,
): PersistedSetup['scheduleLogic'] {
  if (current === 'double-elimination' && !raceCompatible) return 'single-elimination';
  if (current === 'double-elimination-shared-final' && raceCompatible) return 'single-elimination';
  if (current === 'kings-valley' && headToHeadOnly) return 'single-elimination';
  return current;
}

/** The game format, schedule logic, pooling and scoring settings, and the Generate Schedule button. */
export function FormatPanel({
  error,
  lbQualifiers,
  onGenerate,
  setLbQualifiers,
}: {
  error: string;
  lbQualifiers: string;
  onGenerate: () => void;
  setLbQualifiers: (value: string) => void;
}) {
  const { state, setup, updateSetup } = useTournamentApp();
  const change = useSetupChange();
  const format = getGameFormat(setup.gameFormat);
  const shown = visibleFormatFields(setup);
  const raceCompatible = format?.idealRoomSize === 2 && setup.oddCountStrategy !== 'flex';
  const scheduleOptions = useMemo(
    () =>
      raceCompatible
        ? [{ value: 'double-elimination', label: 'Double elimination' }]
        : [{ value: 'double-elimination-shared-final', label: 'Double elimination — FFA/Team' }],
    [raceCompatible],
  );
  // Swiss fold-pairing and Group Stage round-robin scheduling both only make
  // sense for a head-to-head (exactly 2 units per room) format — neither can
  // represent a multi-way FFA/team room.
  const headToHeadOnly = format?.idealRoomSize === 2;
  const poolingPhaseOptions = useMemo(
    () => [
      { value: 'none', label: 'None — standard elimination from R1' },
      { value: 'qual-table', label: 'Qualification Table — R1/R2/R3 feed cumulative table' },
      ...(headToHeadOnly
        ? [
            { value: 'swiss', label: 'Swiss — fold-paired rounds feed cumulative standings' },
            { value: 'group-stage', label: 'Group Stage — round-robin groups, top finishers advance' },
          ]
        : []),
    ],
    [headToHeadOnly],
  );

  // Odd-count strategy alone can flip raceCompatible (e.g. picking 'flex')
  // without the game format changing — reconcile scheduleLogic here too,
  // the same way changeFormat() does, so a stale 'double-elimination'
  // selection can never survive its own option disappearing from the list.
  function changeOddCountStrategy(value: string) {
    const compatible = format?.idealRoomSize === 2 && value !== 'flex';
    updateSetup((current) => ({
      ...current,
      oddCountStrategy: value as PersistedSetup['oddCountStrategy'],
      scheduleLogic: reconcileScheduleLogicForFormat(
        current.scheduleLogic,
        compatible,
        format?.idealRoomSize === 2,
      ),
    }));
  }

  function changeFormat(value: PersistedSetup['gameFormat']) {
    const nextFormat = getGameFormat(value);
    const defaultOdd = (nextFormat && resolveOddCountStrategy(nextFormat, '')) ?? '';
    const compatible = nextFormat?.idealRoomSize === 2 && defaultOdd !== 'flex';
    updateSetup((current) => ({
      ...current,
      gameFormat: value,
      oddCountStrategy: defaultOdd,
      teamScoringRule: nextTeamScoringRule(current, nextFormat?.teamSize),
      scheduleLogic: reconcileScheduleLogicForFormat(
        current.scheduleLogic,
        compatible,
        nextFormat?.idealRoomSize === 2,
      ),
      poolingPhase:
        (current.poolingPhase === 'group-stage' || current.poolingPhase === 'swiss') &&
        nextFormat?.idealRoomSize !== 2
          ? 'none'
          : current.poolingPhase,
    }));
  }

  const { derivedAdvance, isShared, sharedFinalShare, totalPoolingRounds, waterfallStandingsSource } =
    setupDerived(setup, state, lbQualifiers);
  return (
    <SectionPanel title='FORMAT'>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-x-4'>
        <GameFormatFields gameFormat={setup.gameFormat} onChange={changeFormat} />
        <PresenceField htmlFor='cfg-schedule-logic' label='Schedule logic'>
          <Select
            id='cfg-schedule-logic'
            value={setup.scheduleLogic}
            onChange={(e) => change('scheduleLogic', e.target.value)}
          >
            <option value='single-elimination'>Single elimination</option>
            {scheduleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {headToHeadOnly ? null : <option value='kings-valley'>Kings Valley</option>}
            <option value='waterfall-bracket'>Waterfall bracket (organiser-authored)</option>
          </Select>
        </PresenceField>
        {shown.has('teamScoringRule') ? (
          <PresenceField htmlFor='cfg-team-scoring-rule' label='Team scoring'>
            <Select
              id='cfg-team-scoring-rule'
              value={setup.teamScoringRule || 'sum-members'}
              onChange={(e) => change('teamScoringRule', e.target.value)}
            >
              {Object.entries(TEAM_SCORING_RULE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </Select>
          </PresenceField>
        ) : null}
        <PresenceField htmlFor='cfg-pooling-phase' label='Pooling phase'>
          <Select
            id='cfg-pooling-phase'
            value={setup.poolingPhase}
            onChange={(e) => change('poolingPhase', e.target.value)}
          >
            {poolingPhaseOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </PresenceField>
        {shown.has('drawPublication') ? (
          <PresenceField htmlFor='cfg-draw-publication' label='Draw publication'>
            <Select
              id='cfg-draw-publication'
              value={setup.drawPublication}
              onChange={(e) => change('drawPublication', e.target.value)}
            >
              <option value='adaptive'>{DRAW_PUBLICATION_LABELS.adaptive}</option>
              <option value='fixed'>{DRAW_PUBLICATION_LABELS.fixed}</option>
            </Select>
            {setup.drawPublication === 'fixed' ? (
              <p className='mt-1 text-xs text-muted'>
                Every round's room assignment is fixed at generation time from roster order, with rematch
                avoidance where mathematically possible — never adjusted based on live scores. Reserves can't
                be added once a tournament starts in this mode.
              </p>
            ) : null}
          </PresenceField>
        ) : null}
        {shown.has('groupSize') ? (
          <>
            <PresenceField htmlFor='cfg-group-size' label='Group size'>
              <Input
                id='cfg-group-size'
                type='number'
                min='3'
                max='5'
                value={setup.groupSize}
                onChange={(e) => change('groupSize', e.target.value)}
              />
            </PresenceField>
            <PresenceField htmlFor='cfg-round-robin-mode' label='Round-robin'>
              <Select
                id='cfg-round-robin-mode'
                value={setup.roundRobinMode}
                onChange={(e) => change('roundRobinMode', e.target.value)}
              >
                <option value='single'>{ROUND_ROBIN_LABELS.single}</option>
                <option value='double'>{ROUND_ROBIN_LABELS.double}</option>
              </Select>
            </PresenceField>
            <PresenceField htmlFor='cfg-qualifiers-per-group' label='Qualifiers per group'>
              <Input
                id='cfg-qualifiers-per-group'
                type='number'
                min='1'
                value={setup.qualifiersPerGroup}
                onChange={(e) => change('qualifiersPerGroup', e.target.value)}
              />
            </PresenceField>
          </>
        ) : null}
        {shown.has('qualAdv') ? (
          <>
            {waterfallStandingsSource ? (
              <PresenceField htmlFor='cfg-qual-adv' label='Advance to bracket'>
                <p className='text-sm' id='cfg-qual-adv'>
                  {derivedAdvance > 0
                    ? `${derivedAdvance}, set by the waterfall graph`
                    : 'not set yet — route ranks of the qualification table in the waterfall graph below'}
                </p>
              </PresenceField>
            ) : (
              <PresenceField htmlFor='cfg-qual-adv' label='Advance to bracket'>
                <Input
                  id='cfg-qual-adv'
                  type='number'
                  min='1'
                  value={setup.qualAdv}
                  onChange={(e) => change('qualAdv', e.target.value)}
                />
              </PresenceField>
            )}
            <PresenceField htmlFor='cfg-non-counting-rounds' label='Non-counting rounds (optional)'>
              <Input
                id='cfg-non-counting-rounds'
                type='number'
                min='0'
                max={Math.max(0, totalPoolingRounds - 1)}
                value={setup.nonCountingRounds}
                onChange={(e) => change('nonCountingRounds', e.target.value)}
              />
            </PresenceField>
          </>
        ) : null}
        {format?.supportedOddCountStrategies && shown.has('oddCountStrategy') ? (
          <PresenceField htmlFor='cfg-odd-count-strategy' label='Odd-count strategy'>
            <Select
              id='cfg-odd-count-strategy'
              value={resolveOddCountStrategy(format, setup.oddCountStrategy)}
              onChange={(e) => changeOddCountStrategy(e.target.value)}
            >
              {format.supportedOddCountStrategies.map((key) => (
                <option key={key} value={key}>
                  {ODD_COUNT_STRATEGY_LABELS[key]}
                </option>
              ))}
            </Select>
          </PresenceField>
        ) : null}
        {setup.poolingPhase !== 'none' ? (
          <>
            <PresenceField htmlFor='cfg-scoring' label='Scoring system'>
              <Select
                id='cfg-scoring'
                value={setup.scoring}
                onChange={(e) => change('scoring', e.target.value)}
              >
                <option value='fairpoints'>{SCORING_SYSTEM_OPTION_LABELS.fairpoints}</option>
                <option value='positional-points'>{SCORING_SYSTEM_OPTION_LABELS['positional-points']}</option>
              </Select>
            </PresenceField>
            {shown.has('positionalPointsTable') ? (
              <PresenceField
                htmlFor='cfg-positional-points-table'
                label={
                  <>
                    Custom points table{' '}
                    <span className='font-normal normal-case tracking-normal text-muted'>
                      — one entry per rank, highest rank first, e.g. "10,8,6,5,4,3,2,1"
                    </span>
                  </>
                }
              >
                <Input
                  id='cfg-positional-points-table'
                  type='text'
                  placeholder='e.g. 10,8,6,5,4,3,2,1'
                  value={setup.positionalPointsTable}
                  onChange={(e) => change('positionalPointsTable', e.target.value)}
                />
                <p className='mt-1 text-xs text-muted'>
                  Points must not increase from rank to rank, and the table needs at least one entry per unit
                  in the largest room this format can produce — points are summed across every counted round.
                </p>
              </PresenceField>
            ) : null}
          </>
        ) : (
          <PresenceField htmlFor='cfg-scoring' label='Scoring system'>
            <Select id='cfg-scoring' value='fairpoints' disabled>
              <option value='fairpoints'>{SCORING_SYSTEM_OPTION_LABELS.fairpoints}</option>
            </Select>
          </PresenceField>
        )}
        {shown.has('finalsGames') ? (
          <PresenceField htmlFor='cfg-finals-games' label='Finals format'>
            <Select
              id='cfg-finals-games'
              value={setup.finalsGames}
              onChange={(e) => change('finalsGames', e.target.value)}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {gamesLabel(n)}
                </option>
              ))}
            </Select>
          </PresenceField>
        ) : (
          <PresenceField
            htmlFor='cfg-grand-final-wb-target'
            label={
              <>
                Grand Final — wins needed to take the title
                <EditingTag field='grandFinalLbTarget' />
              </>
            }
          >
            <div className='flex gap-2.5'>
              <Input
                id='cfg-grand-final-wb-target'
                aria-label='Winners bracket target'
                type='number'
                min='1'
                value={setup.grandFinalWbTarget}
                onChange={(e) => change('grandFinalWbTarget', e.target.value)}
              />
              <Input
                id='cfg-grand-final-lb-target'
                aria-label='Losers bracket target'
                type='number'
                min='1'
                value={setup.grandFinalLbTarget}
                onChange={(e) => change('grandFinalLbTarget', e.target.value)}
              />
            </div>
          </PresenceField>
        )}
        {shown.has('semisGames') ? (
          <>
            <PresenceField htmlFor='cfg-semis-override' label='Semis size override (optional)'>
              <Input
                id='cfg-semis-override'
                type='number'
                min='1'
                placeholder='derived'
                value={setup.semisOverride}
                onChange={(e) => change('semisOverride', e.target.value)}
              />
            </PresenceField>
            <PresenceField htmlFor='cfg-semis-games' label='Semis format'>
              <Select
                id='cfg-semis-games'
                value={setup.semisGames}
                onChange={(e) => change('semisGames', e.target.value)}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {gamesLabel(n)}
                  </option>
                ))}
              </Select>
            </PresenceField>
          </>
        ) : null}
        {shown.has('lbQualifiers') ? (
          <PresenceField htmlFor='cfg-lb-qualifiers' label='LB qualifiers into the Final'>
            <Input
              id='cfg-lb-qualifiers'
              type='number'
              min='1'
              value={lbQualifiers}
              onChange={(e) => setLbQualifiers(e.target.value)}
            />
          </PresenceField>
        ) : null}
        {shown.has('finalOverride') ? (
          <PresenceField htmlFor='cfg-final-override' label='Final size override (optional)'>
            <Input
              id='cfg-final-override'
              type='number'
              min='1'
              placeholder='derived'
              value={setup.finalOverride}
              onChange={(e) => change('finalOverride', e.target.value)}
            />
          </PresenceField>
        ) : null}
      </div>
      {shown.has('qualRoundsOverride') ||
      shown.has('swissRoundsOverride') ||
      shown.has('eliminationRoundTargets') ? (
        <details className='group'>
          <summary className='w-fit cursor-pointer list-none text-sm font-bold text-cfp-sky select-none hover:underline [&::-webkit-details-marker]:hidden'>
            Advanced round overrides <span className='inline-block transition group-open:rotate-90'>›</span>
          </summary>
          <div className='mt-3'>
            {shown.has('qualRoundsOverride') ? (
              <PresenceField
                htmlFor='cfg-qual-rounds-override'
                label='Qualification Table round count override'
              >
                <Input
                  id='cfg-qual-rounds-override'
                  type='number'
                  min='1'
                  max='12'
                  placeholder='derived'
                  value={setup.qualRoundsOverride}
                  onChange={(e) => change('qualRoundsOverride', e.target.value)}
                />
              </PresenceField>
            ) : null}
            {shown.has('swissRoundsOverride') ? (
              <PresenceField htmlFor='cfg-swiss-rounds-override' label='Swiss round count override'>
                <Input
                  id='cfg-swiss-rounds-override'
                  type='number'
                  min='1'
                  max='12'
                  placeholder='derived'
                  value={setup.swissRoundsOverride}
                  onChange={(e) => change('swissRoundsOverride', e.target.value)}
                />
              </PresenceField>
            ) : null}
            {shown.has('eliminationRoundTargets') ? (
              <>
                <PresenceField
                  htmlFor='cfg-elimination-round-targets'
                  label={
                    <>
                      Elimination round targets{' '}
                      <span className='font-normal normal-case tracking-normal text-muted'>
                        — ordered survivor counts, can repeat if a round eliminates no one, e.g. "24,24,12,6"
                      </span>
                    </>
                  }
                >
                  <Input
                    id='cfg-elimination-round-targets'
                    type='text'
                    placeholder='e.g. 24,24,12,6'
                    value={setup.eliminationRoundTargets}
                    onChange={(e) => change('eliminationRoundTargets', e.target.value)}
                  />
                  {isShared ? (
                    <p className='mt-1 text-xs text-muted'>
                      The list is the whole winners bracket and must end at the Final's winners-bracket share
                      (Final size − LB qualifiers
                      {sharedFinalShare >= 1 ? `, currently ${sharedFinalShare}` : ''}).
                    </p>
                  ) : null}
                </PresenceField>
                <PresenceField
                  htmlFor='cfg-elimination-seeding-overrides'
                  label={
                    <>
                      Elimination seeding overrides{' '}
                      <span className='font-normal normal-case tracking-normal text-muted'>
                        — one per target above, comma-separated; leave an entry blank for automatic
                      </span>
                    </>
                  }
                >
                  <Input
                    id='cfg-elimination-seeding-overrides'
                    type='text'
                    placeholder={
                      setup.eliminationRoundTargets.trim()
                        ? 'e.g. ,diversity,balance'
                        : 'set round targets above first'
                    }
                    disabled={!setup.eliminationRoundTargets.trim()}
                    value={setup.eliminationSeedingOverrides}
                    onChange={(e) => change('eliminationSeedingOverrides', e.target.value)}
                  />
                  <p className='mt-1 text-xs text-muted'>
                    Options: <strong>diversity</strong> (spread players who've faced each other into different
                    rooms), <strong>balance</strong> (balance apparent skill/seed across rooms),{' '}
                    <strong>random</strong> (shuffle rooms, ignoring both history and skill). Blank keeps the
                    automatic taper for that round.
                  </p>
                </PresenceField>
              </>
            ) : null}
          </div>
        </details>
      ) : null}
      {error ? (
        <Alert id='generate-error' tone='danger'>
          {error}
        </Alert>
      ) : null}
      <ButtonRow>
        <Button variant='primary' onClick={onGenerate}>
          ▶ Generate Schedule
        </Button>
      </ButtonRow>
    </SectionPanel>
  );
}
