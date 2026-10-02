import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('supabase/functions/print-agent/index.ts', 'utf8');

describe('print-agent weighted receipt contract', () => {
  it('prints sold_by_weight + weight_kg as kg while preserving quantity fallback and authoritative totals', () => {
    expect(source).toMatch(/sold_by_weight/);
    expect(source).toMatch(/weight_kg/);
    expect(source).toMatch(/toFixed\(3\)/);
    expect(source).toMatch(/kg/);
    expect(source).toMatch(/\$\{qty\}x/);

    expect(source).toContain('const tot = Number(it.total || 0);');
    expect(source).toContain('subtotal += tot;');
    expect(source).toContain('const removed: string[] = it.removedIngredients || [];');
    expect(source).toContain("const extras = (it.extras || it.selectedExtras || []).map");
  });

  it('keeps the weighted item label width-aware instead of extending the paper line', () => {
    expect(source).toMatch(/W\s*-\s*quantityLabel\.length\s*-\s*amount\.length\s*-\s*1/);
  });
});
