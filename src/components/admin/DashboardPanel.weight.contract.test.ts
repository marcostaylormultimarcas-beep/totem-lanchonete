import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/admin/DashboardPanel.tsx', 'utf8');

describe('DashboardPanel weighted ranking contract', () => {
  it('accumulates valid weighted items in kg while preserving unit quantities and authoritative item totals', () => {
    expect(source).toMatch(/sold_by_weight\??:\s*boolean/);
    expect(source).toMatch(/weight_kg\??:\s*number/);
    expect(source).toContain('const weightKg = Number(it.weight_kg || 0);');
    expect(source).toContain('const isWeighted = it.sold_by_weight === true && weightKg > 0;');
    expect(source).toContain('const rankingQuantity = isWeighted ? weightKg : Number(it.quantity || 0);');
    expect(source).toContain('cur.quantity += rankingQuantity;');
    expect(source).toMatch(/it\.total\s*!=\s*null/);
    expect(source).toMatch(/isWeighted\s*\?\s*0\s*:/);
  });

  it('formats weighted ranking entries in kg and keeps sorting plus proportional bars quantity-based', () => {
    expect(source).toContain('p.quantity.toFixed(3)');
    expect(source).toContain(' kg');
    expect(source).toMatch(/\$\{p\.quantity\}x/);
    expect(source).toContain('.sort((a, b) => b.quantity - a.quantity)');
    expect(source).toContain('(p.quantity / maxQty) * 100');
  });
});
