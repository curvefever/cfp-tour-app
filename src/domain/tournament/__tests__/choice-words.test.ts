import { expect, it } from 'vitest';
import { POOLING_PHASE_WORDS, SCHEDULE_LOGIC_WORDS } from '../formats';

// The three wordings as they were written in three places (formats.ts, FormatPanel.tsx, tournament-info.ts) before the table.
const RECAP_SCHEDULE = {
  'single-elimination': 'Single elimination',
  'double-elimination': 'Double elimination',
  'double-elimination-shared-final': 'Double elimination — FFA/Team',
  'kings-valley': 'Kings Valley',
  'waterfall-bracket': 'Custom bracket (organiser-authored)',
  'upper-lower': 'Upper and lower bracket',
};
const RECAP_POOLING = {
  none: 'None — standard elimination from R1',
  'qual-table': 'Qualification Table',
  swiss: 'Swiss',
  'group-stage': 'Group Stage',
};
const SETUP_SCHEDULE = {
  'single-elimination': 'Single elimination',
  'double-elimination': 'Double elimination',
  'double-elimination-shared-final': 'Double elimination — FFA/Team',
  'kings-valley': 'Kings Valley',
  'upper-lower': 'Upper and lower bracket',
  'waterfall-bracket': 'Custom bracket (organiser-authored)',
};
const SETUP_POOLING = {
  none: 'None — standard elimination from R1',
  'qual-table': 'Qualification Table — R1/R2/R3 feed cumulative table',
  swiss: 'Swiss — fold-paired rounds feed cumulative standings',
  'group-stage': 'Group Stage — round-robin groups, top finishers advance',
};
const LIST_POOLING = {
  none: null,
  'qual-table': 'Qualification table',
  swiss: 'Swiss',
  'group-stage': 'Group stage',
};
const LIST_SCHEDULE = {
  'single-elimination': 'Single elimination',
  'double-elimination': 'Double elimination',
  'double-elimination-shared-final': 'Double elimination',
  'kings-valley': 'Kings Valley',
  'waterfall-bracket': 'Custom bracket',
  'upper-lower': 'Upper and lower bracket',
};

it("the table holds today's three wordings for every choice", () => {
  for (const [key, words] of Object.entries(SCHEDULE_LOGIC_WORDS)) {
    expect(words.recap).toBe(RECAP_SCHEDULE[key as keyof typeof RECAP_SCHEDULE]);
    expect(words.setup).toBe(SETUP_SCHEDULE[key as keyof typeof SETUP_SCHEDULE]);
    expect(words.list).toBe(LIST_SCHEDULE[key as keyof typeof LIST_SCHEDULE]);
  }
  for (const [key, words] of Object.entries(POOLING_PHASE_WORDS)) {
    expect(words.recap).toBe(RECAP_POOLING[key as keyof typeof RECAP_POOLING]);
    expect(words.setup).toBe(SETUP_POOLING[key as keyof typeof SETUP_POOLING]);
    expect(words.list).toBe(LIST_POOLING[key as keyof typeof LIST_POOLING]);
  }
  expect(Object.keys(SCHEDULE_LOGIC_WORDS)).toHaveLength(6);
  expect(Object.keys(POOLING_PHASE_WORDS)).toHaveLength(4);
});
