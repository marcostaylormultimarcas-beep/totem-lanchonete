// @vitest-environment jsdom
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RuntimeErrorBoundary from './RuntimeErrorBoundary';

const Boom = () => {
  throw new Error('boom');
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RuntimeErrorBoundary', () => {
  it('shows a recoverable fallback instead of clearing the UI', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(
          <RuntimeErrorBoundary homeHref="/admin?tab=orders">
            <Boom />
          </RuntimeErrorBoundary>,
        );
      });

      const alert = container.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert?.textContent).toContain('Não foi possível abrir esta tela');
      expect(
        container
          .querySelector<HTMLAnchorElement>('a[href="/admin?tab=orders"]')
          ?.textContent,
      ).toContain('Voltar para uma área segura');
    } finally {
      await act(async () => {
        root.unmount();
      });
      errorSpy.mockRestore();
    }
  });
});
