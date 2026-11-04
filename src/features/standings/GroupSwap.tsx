import { useState } from 'react';
import { groupSwapWindow, swapBetweenGroups } from '../../domain/tournament/group-swap';
import { standingsKind } from '../../domain/tournament/standings-display';
import type { TournamentState } from '../../domain/tournament/types';
import { Alert, Button } from '../../components/ui';
import { useTournamentApp } from '../tournament/TournamentProvider';
import { swapConfirmText, swapHint, swapStatus } from './group-swap-text';

/** What a group table needs to make its rows pickable: the unit picked so far and what a click does. */
export interface GroupSwapPicking {
  picked: string | null;
  pick(name: string): void;
}

const groupLabelOf = (state: TournamentState, name: string) =>
  state.groups.find((group) => group.members.includes(name))?.label;

/**
 * The "⇄ Swap groups" toggle of the Standings tab and its picking state. Available to a signed-in admin of a
 * tournament that is not finished while the swap window is open (`groupSwapWindow`); `picking` is null unless the
 * toggle is on.
 */
export function useGroupSwap() {
  const app = useTournamentApp();
  const { state } = app;
  const [on, setOn] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState('');
  const available =
    app.unlocked &&
    !app.isViewer &&
    !app.readOnly &&
    standingsKind(state) === 'groups' &&
    groupSwapWindow(state) === null;
  const active = available && on;
  const livePick = active && picked !== null && groupLabelOf(state, picked) !== undefined ? picked : null;

  function toggle() {
    setOn(!on);
    setPicked(null);
    setError('');
  }

  function swap(first: string, second: string) {
    const question = swapConfirmText(state, first, second);
    if (question && !window.confirm(question)) return;
    const result = swapBetweenGroups(state, first, second);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    app.updateState(result.state);
    setPicked(null);
  }

  function pick(name: string) {
    setError('');
    if (livePick === name) setPicked(null);
    else if (livePick === null || groupLabelOf(state, livePick) === groupLabelOf(state, name))
      setPicked(name);
    else swap(livePick, name);
  }

  return {
    available,
    active,
    toggle,
    error,
    state,
    picked: livePick,
    picking: active ? ({ picked: livePick, pick } satisfies GroupSwapPicking) : null,
  };
}

/** The toggle, its hint, the status and a refusal, above the group tables. */
export function GroupSwapBar({ control }: { control: ReturnType<typeof useGroupSwap> }) {
  if (!control.available) return null;
  const { active, state } = control;
  return (
    <section className='flex flex-col gap-2' data-group-swap>
      <div className='flex flex-wrap items-center gap-3'>
        <Button aria-pressed={active} onClick={control.toggle} variant={active ? 'primary' : 'secondary'}>
          ⇄ Swap groups
        </Button>
        {active ? <p className='text-sm text-muted'>{swapStatus(state, control.picked)}</p> : null}
      </div>
      {active ? <p className='text-sm text-muted'>{swapHint(state)}</p> : null}
      {control.error ? <Alert tone='danger'>{control.error}</Alert> : null}
    </section>
  );
}
