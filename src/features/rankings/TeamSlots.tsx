import { useState } from 'react';
import {
  fillTeamSlot,
  memberSwapRefusal,
  slotFillRefusal,
  swapTeamMember,
} from '../../domain/tournament/member-swaps';
import { renameTeamMember, setTeamDefender, updateTeam } from '../../domain/tournament/mutations';
import type { TeamMember, TournamentState, TournamentTeam } from '../../domain/tournament/types';
import { Button, Select } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { refuseUnstorableNames } from '../tournament/unstorable-names';
import { ConfirmToggle } from './ConfirmToggle';
import type { ConfirmationView } from './confirmation-view';
import { ICON_BUTTON } from './tool-buttons';

const SLOT_ROW = 'flex items-center justify-between gap-2 border-t border-surface-hover pt-1.5 text-xs';

/** Who can take a slot: an individual reserve from the list, or a new name typed in. */
function SlotControls({
  label,
  newPrompt,
  onNew,
  onReserve,
  reserves,
}: {
  label: string;
  newPrompt: string;
  onNew: (name: string) => void;
  onReserve: (reserve: TeamMember, index: number) => void;
  reserves: readonly TeamMember[];
}) {
  return (
    <span className='flex gap-1'>
      {reserves.length ? (
        <Select
          className='py-1 text-xs'
          aria-label={`Reserve for ${label}`}
          defaultValue=''
          onChange={(event) => {
            const index = Number.parseInt(event.target.value, 10);
            const reserve = reserves[index];
            if (reserve) onReserve(reserve, index);
          }}
        >
          <option value=''>— pick a reserve —</option>
          {reserves.map((reserve, index) => (
            <option key={`${reserve.name}-${index}`} value={index}>
              {reserve.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Button
        className='shrink-0 whitespace-nowrap'
        size='sm'
        variant='warning'
        onClick={() => {
          const value = window.prompt(newPrompt);
          if (value?.trim() && !refuseUnstorableNames([value])) onNew(value.trim());
        }}
      >
        ＋ New
      </Button>
    </span>
  );
}

/** A vacant slot of a team: filled from the individual reserves or with a new name, at any time. */
export function VacantSlot({
  memberIndex,
  state,
  team,
}: {
  memberIndex: number;
  state: TournamentState;
  team: TournamentTeam;
}) {
  const app = useTournamentApp();
  const fill = (member: TeamMember, reserveIndex?: number) => {
    const refusal = slotFillRefusal(state, team.teamId, memberIndex, member, reserveIndex);
    if (refusal) {
      window.alert(refusal);
      return;
    }
    app.updateState((current) => fillTeamSlot(current, team.teamId, memberIndex, member, reserveIndex));
  };
  return (
    <div className={SLOT_ROW}>
      <span className='text-muted'>Vacant slot</span>
      <SlotControls
        label={`${team.teamName} slot ${memberIndex + 1}`}
        newPrompt='Name of the new/walk-up player filling this slot:'
        onNew={(name) => fill({ name })}
        onReserve={fill}
        reserves={state.reserveIndividuals}
      />
    </div>
  );
}

/**
 * A member of a team: confirmation, the defender mark and button, rename, ⇄ swap (any time: it picks the newcomer
 * among the individual reserves or a new name, and the member who goes out becomes an individual reserve) and remove.
 */
export function TeamMemberRow({
  confirmations,
  defender,
  member,
  memberIndex,
  state,
  team,
}: {
  confirmations: ConfirmationView;
  /** The team's defender slot in the round in play. */
  defender: number;
  member: TeamMember;
  memberIndex: number;
  state: TournamentState;
  team: TournamentTeam;
}) {
  const app = useTournamentApp();
  const [swapping, setSwapping] = useState(false);
  const designated = state.gamemodeConfig.teamScoringRule === 'designated-player';
  const swapIn = (incoming: TeamMember, reserveIndex?: number) => {
    const refusal = memberSwapRefusal(state, team.teamId, memberIndex, incoming, reserveIndex);
    if (refusal) {
      window.alert(refusal);
      return;
    }
    app.updateState((current) => swapTeamMember(current, team.teamId, memberIndex, incoming, reserveIndex));
    setSwapping(false);
  };
  return (
    <>
      <div className={SLOT_ROW}>
        <span>
          {member.name}
          {designated && defender === memberIndex ? ' 🛡 Defender' : ''}
        </span>
        <span className='flex gap-1'>
          <ConfirmToggle mark={confirmations.toggle(member.name)} name={member.name} />
          {designated && defender !== memberIndex ? (
            <Button
              aria-label={`Make ${member.name} defender`}
              className={ICON_BUTTON}
              size='sm'
              title='Make defender'
              onClick={() => app.updateState((current) => setTeamDefender(current, team.teamId, memberIndex))}
            >
              🛡
            </Button>
          ) : null}
          <Button
            aria-label={`Rename ${member.name}`}
            className={ICON_BUTTON}
            size='sm'
            title='Rename member'
            onClick={() => {
              const value = window.prompt(`Rename "${member.name}" to:`, member.name);
              if (value?.trim() && !refuseUnstorableNames([value]))
                app.updateState((current) => renameTeamMember(current, team.teamId, memberIndex, value));
            }}
          >
            ✎
          </Button>
          <Button
            aria-expanded={swapping}
            aria-label={`Swap ${member.name}`}
            className={ICON_BUTTON}
            size='sm'
            title='Swap member'
            onClick={() => setSwapping((open) => !open)}
          >
            ⇄
          </Button>
          <Button
            aria-label={`Remove ${member.name}`}
            className={ICON_BUTTON}
            size='sm'
            title='Remove member'
            variant='danger'
            onClick={() => {
              if (
                window.confirm(`Remove "${member.name}" from team "${team.teamName}"? This cannot be undone.`)
              )
                app.updateState((current) =>
                  updateTeam(current, team.teamId, (entry) => ({
                    ...entry,
                    members: entry.members.map((item, index) => (index === memberIndex ? null : item)),
                  })),
                );
            }}
          >
            ✕
          </Button>
        </span>
      </div>
      {swapping ? (
        <div className='flex items-center justify-between gap-2 text-xs'>
          <span className='text-muted'>Swap {member.name} for</span>
          <SlotControls
            label={`${team.teamName} · ${member.name}`}
            newPrompt={`Name of the player taking ${member.name}'s place:`}
            onNew={(name) => swapIn({ name })}
            onReserve={(reserve, index) => swapIn(reserve, index)}
            reserves={state.reserveIndividuals}
          />
        </div>
      ) : null}
    </>
  );
}
