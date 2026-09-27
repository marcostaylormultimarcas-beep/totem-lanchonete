import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type FunctionDefinition = {
  file: string;
  sql: string;
};

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const migrationFiles = readdirSync(migrationsDir)
  .filter((entry) => entry.endsWith(".sql"))
  .sort();

function latestFunctionDefinition(name: string): FunctionDefinition {
  const needle = `create or replace function public.${name}(`;
  let latest: FunctionDefinition | null = null;

  for (const file of migrationFiles) {
    const fullSql = readFileSync(join(migrationsDir, file), "utf8");
    const lowerSql = fullSql.toLowerCase();
    const start = lowerSql.lastIndexOf(needle.toLowerCase());

    if (start < 0) continue;

    const nextFunction = lowerSql.indexOf(
      "\ncreate or replace function public.",
      start + needle.length,
    );

    latest = {
      file,
      sql: fullSql.slice(start, nextFunction >= 0 ? nextFunction : fullSql.length),
    };
  }

  if (!latest) {
    throw new Error(`Function ${name} was not found in migrations`);
  }

  return latest;
}

function normalized(sql: string) {
  return sql.toLowerCase().replace(/\s+/g, " ");
}

function canBothSpend(initial: number, firstNeed: number, secondNeed: number) {
  const afterFirst = initial - firstNeed;
  return firstNeed <= initial && secondNeed <= afterFirst;
}

const consume = latestFunctionDefinition("visionfood_consume_recipe_stock");
const restock = latestFunctionDefinition("visionfood_restock_recipe_stock");
const finalizeCancel = latestFunctionDefinition("visionfood_finalize_order_cancellation");

const consumeSql = normalized(consume.sql);
const restockSql = normalized(restock.sql);
const finalizeCancelSql = normalized(finalizeCancel.sql);
const allMigrationsSql = normalized(
  migrationFiles
    .map((file) => readFileSync(join(migrationsDir, file), "utf8"))
    .join("\n"),
);

describe("recipe stock concurrency SQL contract", () => {
  it("serial semantics allow only one weighted checkout when stock covers one request", () => {
    expect(canBothSpend(0.15, 0.1, 0.1)).toBe(false);
  });

  it("aggregates product usage before touching ingredient rows", () => {
    expect(consumeSql).toContain("with product_usage as (");
    expect(consumeSql).toContain("ingredient_need as (");
  });

  it("aggregates every recipe contribution for a shared ingredient before decrement", () => {
    expect(consumeSql).toContain(
      "group by coalesce(r.ingrediente_id,r.ingredient_id)",
    );
    expect(consumeSql).toContain(
      "sum(greatest(coalesce(r.quantidade,0),0)*u.multiplier)",
    );
  });

  it("locks ingredient rows in deterministic id order during consumption", () => {
    expect(consumeSql).toContain("order by i.id for update of i");
  });

  it("uses the same deterministic ingredient lock order during cancellation restock", () => {
    expect(restockSql).toContain("order by i.id for update of i");
  });

  it("aggregates shared ingredient restock instead of replaying stale duplicate snapshots", () => {
    expect(restockSql).toContain("with product_usage as (");
    expect(restockSql).toContain("ingredient_amount as (");
    expect(restockSql).toContain(
      "sum(greatest(coalesce(r.quantidade,0),0)*u.multiplier)",
    );
  });

  it("keeps sold_by_weight fail-closed instead of falling back to quantity=1", () => {
    expect(consumeSql).toContain(
      "if is_by_weight and (weight is null or weight<=0) then",
    );
    expect(restockSql).toContain(
      "if is_by_weight and (weight is null or weight<=0) then",
    );
  });

  it("keeps normal products on quantity while weighted products use weight_kg", () => {
    expect(consumeSql).toContain(
      "multiplier:=case when is_by_weight then weight else qty end;",
    );
    expect(restockSql).toContain(
      "multiplier:=case when is_by_weight then weight else qty end;",
    );
  });

  it("keeps recipe consumption inside the order insert transaction", () => {
    expect(allMigrationsSql).toContain(
      "create trigger trg_visionfood_consume_recipe_stock before insert on public.orders",
    );
    expect(consumeSql).toContain("new.ingredient_stock_committed_at:=now();");
  });

  it("keeps cancellation restock idempotent and reached from the protected cancellation trigger", () => {
    expect(restockSql).toContain("o.ingredient_stock_committed_at is null");
    expect(restockSql).toContain("o.ingredient_stock_restocked_at is not null");
    expect(restockSql).toContain("set ingredient_stock_restocked_at=now()");
    expect(finalizeCancelSql).toContain(
      "perform public.visionfood_restock_recipe_stock(new.id);",
    );
  });
});
