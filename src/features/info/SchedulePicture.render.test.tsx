// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { built } from '../../domain/tournament/__tests__/layered-test-support';
import { SchedulePicture } from './SchedulePicture';
import { modelOf } from './schedule-picture-test-support';

const drawn = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('./schedule-picture-draw', () => ({ buildSchedulePicture: drawn.build }));

const urls = { create: vi.fn(), revoke: vi.fn() };
let counter = 0;

beforeEach(() => {
  counter = 0;
  drawn.build.mockReset();
  drawn.build.mockImplementation(() => Promise.resolve({ blob: new Blob(['png']), width: 640, height: 300 }));
  urls.create.mockReset().mockImplementation(() => `blob:picture-${(counter += 1)}`);
  urls.revoke.mockReset();
  URL.createObjectURL = urls.create;
  URL.revokeObjectURL = urls.revoke;
});

afterEach(cleanup);

const settled = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });

describe('SchedulePicture', () => {
  it('shows the drawn picture as an image at its own size', async () => {
    const view = render(<SchedulePicture model={modelOf(built(31))} />);
    expect(view.container.querySelector('img')).toBeNull();
    await settled();
    const image = view.container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('blob:picture-1');
    expect(image?.getAttribute('width')).toBe('640');
    expect(image?.getAttribute('alt')).toMatch(/^The schedule of Test tournament/);
  });

  it('draws again only when the model says something new, and drops the old picture then', async () => {
    const model = modelOf(built(31));
    const view = render(<SchedulePicture model={model} />);
    await settled();
    view.rerender(<SchedulePicture model={structuredClone(model)} />);
    await settled();
    expect(drawn.build).toHaveBeenCalledTimes(1);

    view.rerender(<SchedulePicture model={{ ...model, header: { ...model.header, count: '30 players' } }} />);
    await settled();
    expect(drawn.build).toHaveBeenCalledTimes(2);
    expect(urls.revoke).toHaveBeenCalledWith('blob:picture-1');
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:picture-2');
  });

  it('keeps the previous picture while a new one is drawn', async () => {
    const model = modelOf(built(31));
    const view = render(<SchedulePicture model={model} />);
    await settled();
    drawn.build.mockImplementation(() => new Promise(() => {}));
    view.rerender(<SchedulePicture model={{ ...model, header: { ...model.header, count: '30 players' } }} />);
    await settled();
    expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:picture-1');
    expect(urls.revoke).not.toHaveBeenCalled();
  });

  it('shows nothing where nothing can be drawn, and frees the picture when it leaves', async () => {
    drawn.build.mockImplementation(() => Promise.resolve(null));
    const empty = render(<SchedulePicture model={modelOf(built(31))} />);
    await settled();
    expect(empty.container.querySelector('img')).toBeNull();
    empty.unmount();

    drawn.build.mockImplementation(() => Promise.resolve({ blob: new Blob(['png']), width: 10, height: 10 }));
    const shown = render(<SchedulePicture model={modelOf(built(31))} />);
    await settled();
    shown.unmount();
    expect(urls.revoke).toHaveBeenCalledWith('blob:picture-1');
  });

  it('never throws when drawing fails', async () => {
    drawn.build.mockImplementation(() => Promise.reject(new Error('no canvas')));
    const view = render(<SchedulePicture model={modelOf(built(31))} />);
    await settled();
    expect(view.container.querySelector('img')).toBeNull();
  });
});
