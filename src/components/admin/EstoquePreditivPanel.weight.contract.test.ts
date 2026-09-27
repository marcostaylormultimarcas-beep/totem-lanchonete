import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/admin/EstoquePreditivPanel.tsx', 'utf8');

describe('EstoquePreditivPanel weighted consumption contract', () => {
  it('uses valid sold_by_weight + weight_kg as the recipe consumption multiplier', () => {
    expect(source).toMatch(/sold_by_weight/);
    expect(source).toMatch(/weight_kg/);
    expect(source).toContain('const weightKg = Number(it?.weight_kg || 0);');
    expect(source).toContain('const isWeighted = it?.sold_by_weight === true && weightKg > 0;');
    expect(source).toContain('const qty = isWeighted ? weightKg : Number(it?.quantity || 1);');
    expect(source).toContain('const totalIng = r.qtd * qty;');
  });

  it('keeps unit quantity as the fallback and does not multiply weighted sales by quantity=1', () => {
    expect(source).toMatch(/isWeighted\s*\?\s*weightKg\s*:\s*Number\(it\?\.quantity\s*\|\|\s*1\)/);
    expect(source).not.toContain('const qty = Number(it?.quantity || 1);');
  });
});
