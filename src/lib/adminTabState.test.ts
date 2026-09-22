import { describe, expect, it } from 'vitest';
import {
  isAdminTabAllowedForTier,
  normalizeAdminTabForTier,
  parseAdminTab,
} from './adminTabState';

describe('adminTabState', () => {
  it('keeps valid public admin tabs and normalizes unknown values', () => {
    expect(parseAdminTab('orders')).toBe('orders');
    expect(parseAdminTab('not-a-tab')).toBe('orders');
  });

  it('blocks super-only tabs for store admins', () => {
    expect(isAdminTabAllowedForTier('super', 'admin')).toBe(false);
    expect(isAdminTabAllowedForTier('billing', 'admin')).toBe(false);
    expect(normalizeAdminTabForTier('plans', 'admin')).toBe('orders');
  });

  it('blocks master-only tabs for store admins', () => {
    expect(isAdminTabAllowedForTier('admins', 'admin')).toBe(false);
    expect(isAdminTabAllowedForTier('multilojas', 'admin')).toBe(false);
  });

  it('allows master tabs for master users but still blocks super-only tabs', () => {
    expect(isAdminTabAllowedForTier('admins', 'master')).toBe(true);
    expect(isAdminTabAllowedForTier('multilojas', 'master')).toBe(true);
    expect(isAdminTabAllowedForTier('super', 'master')).toBe(false);
  });

  it('allows every known tab for super users', () => {
    expect(normalizeAdminTabForTier('super', 'super')).toBe('super');
    expect(normalizeAdminTabForTier('billing', 'super')).toBe('billing');
    expect(normalizeAdminTabForTier('orders', 'super')).toBe('orders');
  });
});
