import type { TournamentDescription } from '../tournaments/tournament-summary';

/**
 * What a sync reads from and writes to the stored tournament: a multi-path update of the fields edited here (and, with
 * it, the tournament-list fields that changed), and a subscription to the stored value. `Patch` is what the update
 * carries: the Setup form sends text fields only, the tournament state sends any value.
 */
export interface PatchTransport<Patch> {
  update(tournamentId: string, patch: Patch, summary?: Partial<TournamentDescription>): Promise<void>;
  subscribe(
    tournamentId: string,
    onValue: (payload: unknown) => void,
    onError: (error: unknown) => void,
  ): () => void;
}
