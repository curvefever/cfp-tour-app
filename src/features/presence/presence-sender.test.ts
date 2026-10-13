import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceSender } from './presence-sender';
import { PRESENCE_REPEAT_MS } from './presence.shared';

describe('PresenceSender', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(stillIn?: (field: string) => boolean) {
    const send = vi.fn().mockResolvedValue(undefined);
    const sender = new PresenceSender('t1', send, stillIn);
    return { send, sender };
  }

  it('announces the field on entering it, and sends nothing else before the first repeat', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS - 1);
    expect(send.mock.calls).toEqual([['t1', 'roster']]);
  });

  it('repeats every 15 seconds while the admin stays', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS * 3);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send.mock.calls.every(([, field]) => field === 'roster')).toBe(true);
  });

  it('clears on leaving and stops repeating', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    sender.leave('roster');
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS * 3);
    expect(send.mock.calls).toEqual([
      ['t1', 'roster'],
      ['t1', null],
    ]);
  });

  it('ignores leaving a field the admin is no longer in', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    sender.enter('title');
    sender.leave('roster');
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls).toEqual([
      ['t1', 'roster'],
      ['t1', 'title'],
    ]);
  });

  it('sends nothing when it leaves without ever having entered', async () => {
    const { send, sender } = setup();
    sender.leave('roster');
    sender.dispose();
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS);
    expect(send).not.toHaveBeenCalled();
  });

  it('withdraws when the tab is hidden and resumes when it is shown with the field still entered', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    sender.hide();
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS * 2);
    expect(send.mock.calls).toEqual([
      ['t1', 'roster'],
      ['t1', null],
    ]);
    sender.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.at(-1)).toEqual(['t1', 'roster']);
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('does not resume when the field was left while hidden', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    sender.hide();
    sender.leave('roster');
    sender.show();
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('clears on dispose, once', async () => {
    const { send, sender } = setup();
    sender.enter('roster');
    sender.dispose();
    sender.dispose();
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS * 2);
    expect(send.mock.calls).toEqual([
      ['t1', 'roster'],
      ['t1', null],
    ]);
  });

  it('ends the announcement when the field went away without a blur', async () => {
    let present = true;
    const { send, sender } = setup(() => present);
    sender.enter('roster');
    present = false;
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS);
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS * 2);
    expect(send.mock.calls).toEqual([
      ['t1', 'roster'],
      ['t1', null],
    ]);
  });

  it('sends one call after the other, in order, even when one is slow', async () => {
    const finished: string[] = [];
    let release: () => void = () => undefined;
    const send = vi.fn((_id: string, field: string | null) => {
      const name = field ?? 'null';
      if (field === 'roster') {
        return new Promise<void>((resolve) => {
          release = () => {
            finished.push(name);
            resolve();
          };
        });
      }
      finished.push(name);
      return Promise.resolve();
    });
    const sender = new PresenceSender('t1', send);
    sender.enter('roster');
    sender.leave('roster');
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toEqual(['roster', 'null']);
  });

  it('keeps going after a failed call', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const sender = new PresenceSender('t1', send);
    sender.enter('roster');
    await vi.advanceTimersByTimeAsync(PRESENCE_REPEAT_MS);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
