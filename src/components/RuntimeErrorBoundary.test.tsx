// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import RuntimeErrorBoundary from './RuntimeErrorBoundary';

const Boom = () => {
  throw new Error('boom');
};

describe('RuntimeErrorBoundary', () => {
  it('shows a recoverable fallback instead of clearing the UI', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <RuntimeErrorBoundary homeHref="/admin?tab=orders">
        <Boom />
      </RuntimeErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Não foi possível abrir esta tela')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voltar para uma área segura' }).getAttribute('href'))
      .toBe('/admin?tab=orders');

    errorSpy.mockRestore();
  });
});
