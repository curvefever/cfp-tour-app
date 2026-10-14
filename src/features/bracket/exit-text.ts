import { bracketRoundLabels } from '../../domain/tournament/bracket';

/** The name of a round as a destination: "Semis", "Round 5", "R1C". */
export function destinationLabel(roundIndex: number, labels: ReturnType<typeof bracketRoundLabels>): string {
  return labels[roundIndex]?.label ?? `Round ${roundIndex + 1}`;
}
