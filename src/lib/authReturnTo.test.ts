import { describe, expect, it } from 'vitest';
import { sanitizeAuthReturnTo } from '@/lib/authReturnTo';

describe('sanitizeAuthReturnTo', () => {
  const origin = 'https://visionfood.example';

  it('preserves internal return paths', () => {
    expect(sanitizeAuthReturnTo('/cardapio/loja-a?pedido=1#fim', '/', origin))
      .toBe('/cardapio/loja-a?pedido=1#fim');
  });

  it('normalizes same-origin absolute URLs to internal paths', () => {
    expect(sanitizeAuthReturnTo('https://visionfood.example/admin?tab=orders', '/', origin))
      .toBe('/admin?tab=orders');
  });

  it('rejects external and protocol-relative destinations', () => {
    expect(sanitizeAuthReturnTo('https://example.org/phishing', '/cardapio/seguro', origin))
      .toBe('/cardapio/seguro');
    expect(sanitizeAuthReturnTo('//example.org/phishing', '/cardapio/seguro', origin))
      .toBe('/cardapio/seguro');
  });

  it('rejects non-http application destinations such as javascript URLs', () => {
    expect(sanitizeAuthReturnTo('javascript:alert(1)', '/', origin)).toBe('/');
  });
});
