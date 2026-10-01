// Run with PGLITE_MODULE pointing to @electric-sql/pglite/dist/index.js (0.3.14).
// Disposable PostgreSQL WASM; no remote DB, no pg_cron/multi-session simulation.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.PGLITE_MODULE);
const db = new PGlite();
const migration = readFileSync('supabase/migrations/20261001150000_visionfood_v2_onesignal_durable_outbox_observability_backpressure_phase10.sql','utf8');
const start = migration.indexOf('create or replace function private.visionfood_onesignal_outbox_cleanup(');
const cleanup = migration.slice(start,migration.indexOf('\n$$;',start)+4);
await db.exec(`
create schema private; create schema net; create schema vault; create schema cron;
create role anon; create role authenticated; create role service_role;
create table private.onesignal_outbox(id bigint primary key, status text, created_at timestamptz, delivered_at timestamptz, failed_at timestamptz, config_generation_id bigint, padding text);
create table private.onesignal_outbox_attempts(id bigint primary key,outbox_id bigint,created_at timestamptz,submitted_at timestamptz,result_observed_at timestamptz,pg_net_request_id bigint,error_text text,semantic_outcome text,padding text);
create table private.onesignal_config_generations(id bigint,api_key_secret_id bigint,created_at timestamptz);
create table private.onesignal_settings(config_generation_id bigint,api_key_secret_id bigint);
create table net.http_request_queue(id bigint);
create table net._http_response(id bigint,created timestamptz);
create table vault.secrets(id bigint,name text);
create table cron.job(jobid bigint,jobname text);
create table cron.job_run_details(jobid bigint,status text,start_time timestamptz,end_time timestamptz,command text);
`);
const cursorStart=migration.indexOf('-- Phase 27 rescue cursor');
if(cursorStart>=0) await db.exec(migration.slice(cursorStart,start));
await db.exec(cleanup);
console.log(JSON.stringify((await db.query('select version()')).rows));
for(const n of [100000, 500000]) {
 await db.exec(`drop index if exists private.onesignal_outbox_health_created_idx; drop index if exists private.onesignal_outbox_attempts_health_created_idx;
 truncate private.onesignal_outbox, private.onesignal_outbox_attempts;
 create index onesignal_outbox_health_created_idx on private.onesignal_outbox using brin(created_at timestamptz_minmax_multi_ops(values_per_range=64)) with(pages_per_range=8,autosummarize=on);
 create index onesignal_outbox_attempts_health_created_idx on private.onesignal_outbox_attempts using brin(created_at timestamptz_minmax_multi_ops(values_per_range=64)) with(pages_per_range=8,autosummarize=on);
 insert into private.onesignal_outbox select g,'pending',now(),null,null,null,repeat('x',256) from generate_series(1,${n}) g;
 insert into private.onesignal_outbox_attempts select g,g,now(),now(),now(),null,null,null,repeat('x',256) from generate_series(1,${n}) g;
 analyze private.onesignal_outbox; analyze private.onesignal_outbox_attempts;
 insert into private.onesignal_outbox values(0,'delivered',now()-interval '60 days',now()-interval '60 days',null,null,'retention probe');`);
 const pages=(await db.query("select relname,pg_relation_size(oid)/8192 as pages from pg_class where oid in ('private.onesignal_outbox'::regclass,'private.onesignal_outbox_attempts'::regclass)")).rows;
 const t=performance.now(); const result=(await db.query('select private.visionfood_onesignal_outbox_cleanup() as result')).rows[0].result;
 const elapsed_ms=performance.now()-t;
 assert.equal(result.deleted_outbox,1);
 console.log(JSON.stringify({n,pages,elapsed_ms,result}));
 if(cursorStart>=0){
   assert.ok(result.summarized_outbox_ranges<=128); assert.ok(result.summarized_attempt_ranges<=128);
   const c1=(await db.query('select * from private.onesignal_brin_rescue_cursor order by index_name')).rows;
   const second=(await db.query('select private.visionfood_onesignal_outbox_cleanup() as result')).rows[0].result;
   const c2=(await db.query('select * from private.onesignal_brin_rescue_cursor order by index_name')).rows;
   assert.ok(c2.every((c,i)=>Number(c.next_page)>Number(c1[i].next_page)));
   console.log(JSON.stringify({cursor_first:c1,cursor_second:c2,second}));
 }
 const pending=(await db.query("select brin_summarize_new_values('private.onesignal_outbox_health_created_idx') as outbox,brin_summarize_new_values('private.onesignal_outbox_attempts_health_created_idx') as attempts")).rows;
 const t2=performance.now();await db.query('select private.visionfood_onesignal_outbox_cleanup()');
 console.log(JSON.stringify({remaining_after_ticks:pending,already_summarized_cleanup_ms:performance.now()-t2}));
}
await db.close();
