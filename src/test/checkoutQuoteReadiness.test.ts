import { describe, expect, it } from 'vitest';
import { isCheckoutQuoteReady } from '../lib/checkoutQuoteReadiness';

describe('isCheckoutQuoteReady', () => {
  it('blocks web checkout while the server quote is loading', () => {
    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: false,
      demoMode: false,
      quoteLoading: true,
      quoteError: '',
      serverQuote: { total: 41 },
    })).toBe(false);
  });

  it('blocks web checkout when the quote failed or is missing', () => {
    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: false,
      demoMode: false,
      quoteLoading: false,
      quoteError: 'network error',
      serverQuote: null,
    })).toBe(false);

    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: false,
      demoMode: false,
      quoteLoading: false,
      quoteError: '',
      serverQuote: null,
    })).toBe(false);
  });

  it('allows web checkout only after an authoritative quote exists', () => {
    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: false,
      demoMode: false,
      quoteLoading: false,
      quoteError: '',
      serverQuote: { total: 41 },
    })).toBe(true);
  });

  it('preserves device-owned offline and demo flows', () => {
    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: true,
      demoMode: false,
      quoteLoading: true,
      quoteError: 'offline',
      serverQuote: null,
    })).toBe(true);

    expect(isCheckoutQuoteReady({
      deviceOwnedKiosk: false,
      demoMode: true,
      quoteLoading: true,
      quoteError: '',
      serverQuote: null,
    })).toBe(true);
  });
});
