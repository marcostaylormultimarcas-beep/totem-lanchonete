// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getKioskCompanionTablesMock } = vi.hoisted(() => ({
  getKioskCompanionTablesMock: vi.fn(),
}));

vi.mock('@/lib/kioskCompanionClient', () => ({
  getKioskCompanionTables: getKioskCompanionTablesMock,
}));

import TableSelect from '@/components/kiosk/TableSelect';

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('TableSelect request ordering', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (container?.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.restoreAllMocks();
  });

  it('keeps the newest table list when an older refresh resolves afterwards', async () => {
    let resolveOlder!: (value: any) => void;
    let resolveNewer!: (value: any) => void;

    getKioskCompanionTablesMock
      .mockResolvedValueOnce({
        ok: true,
        stale: false,
        saved_at: '2026-09-25T20:00:00Z',
        tables: [{ id: 'mesa-base', label: 'Mesa Base', in_service: false }],
      })
      .mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { resolveNewer = resolve; }));

    await act(async () => {
      root.render(
        <TableSelect
          onSelectTable={vi.fn()}
          onBalcony={vi.fn()}
          onBack={vi.fn()}
        />,
      );
      await flushAsync();
    });

    const refresh = container.querySelector(
      'button[aria-label="Atualizar mesas"]',
    ) as HTMLButtonElement | null;
    expect(refresh).toBeTruthy();
    expect(refresh!.disabled).toBe(false);

    await act(async () => {
      refresh!.click();
      refresh!.click();
      await flushAsync();
    });

    expect(getKioskCompanionTablesMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      resolveNewer({
        ok: true,
        stale: false,
        saved_at: '2026-09-25T20:02:00Z',
        tables: [{ id: 'mesa-nova', label: 'Mesa Nova', in_service: true }],
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('Mesa Nova');
    expect(container.textContent).not.toContain('Mesa Antiga');

    await act(async () => {
      resolveOlder({
        ok: true,
        stale: false,
        saved_at: '2026-09-25T20:01:00Z',
        tables: [{ id: 'mesa-antiga', label: 'Mesa Antiga', in_service: false }],
      });
      await flushAsync();
    });

    expect(container.textContent).toContain('Mesa Nova');
    expect(container.textContent).not.toContain('Mesa Antiga');
  });
});
