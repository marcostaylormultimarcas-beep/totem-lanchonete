import { describe, expect, it } from 'vitest';
import { parseAdminTab, withAdminTabSearchParams } from '@/lib/adminTabState';

describe('admin tab URL state', () => {
  it('restores a valid admin section from the URL', () => {
    expect(parseAdminTab('crm')).toBe('crm');
    expect(parseAdminTab('area_cep')).toBe('area_cep');
    expect(parseAdminTab('loyalty')).toBe('loyalty');
  });

  it('falls back safely when the URL contains an unknown section', () => {
    expect(parseAdminTab('nao-existe')).toBe('orders');
    expect(parseAdminTab(null)).toBe('orders');
  });

  it('persists the selected tab without dropping other query parameters', () => {
    const current = new URLSearchParams('foo=bar&tab=orders');
    const next = withAdminTabSearchParams(current, 'crm');

    expect(next.get('tab')).toBe('crm');
    expect(next.get('foo')).toBe('bar');
    expect(current.get('tab')).toBe('orders');
  });
});
