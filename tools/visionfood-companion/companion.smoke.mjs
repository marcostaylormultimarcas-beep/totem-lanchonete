import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DurableQueue, validateAllowedOrigin } from './companion.mjs';

const DEVICE_ID = '11111111-1111-4111-8111-111111111111';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push({ name, status: 'PASSOU' });
    console.log('PASSOU -', name);
  } catch (error) {
    results.push({ name, status: 'FALHOU', error: error.message });
    console.error('FALHOU -', name, '-', error.message);
  }
}

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'visionfood-companion-'));

try {
  const queue = new DurableQueue({ rootDir, deviceId: DEVICE_ID });
  await queue.init();

  let first;
  let second;

  await check('fila persistente preserva FIFO e identificadores independentes', async () => {
    first = await queue.enqueue({
      organization_id: ORG_ID,
      payment_method: 'cash',
      items: [{ product_id: 'p1', quantity: 1 }],
      customer_name: 'Cliente 1',
    });
    second = await queue.enqueue({
      organization_id: ORG_ID,
      payment_method: 'cash',
      items: [{ product_id: 'p2', quantity: 1 }],
      customer_name: 'Cliente 2',
    });

    assert.notEqual(first.local_order_id, second.local_order_id);
    assert.notEqual(first.client_request_id, second.client_request_id);
    assert.equal(first.state, 'pending_local');
    assert.equal(second.state, 'pending_local');

    const claimed = await queue.claimNext();
    assert.equal(claimed.local_order_id, first.local_order_id);
    assert.equal(claimed.sequence, 1);
    assert.equal(claimed.state, 'syncing');
  });

  await check('fila sobrevive reinicialização e recupera syncing sem perder pedido', async () => {
    const restarted = new DurableQueue({ rootDir, deviceId: DEVICE_ID });
    await restarted.init();
    assert.equal(await restarted.recoverInterrupted(), 1);
    const snapshot = await restarted.snapshot();
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0].local_order_id, first.local_order_id);
    assert.equal(snapshot.items[0].state, 'pending_local');
    assert.equal(snapshot.items[1].local_order_id, second.local_order_id);
  });

  await check('fila bloqueia pagamento offline não permitido e material de autenticação', async () => {
    await assert.rejects(
      queue.enqueue({ organization_id: ORG_ID, payment_method: 'pix', items: [] }),
      /offline_payment_requires_cash/,
    );
    await assert.rejects(
      queue.enqueue({ organization_id: ORG_ID, payment_method: 'cash', payment_status: 'paid', items: [] }),
      /offline_payment_cannot_be_paid/,
    );
    await assert.rejects(
      queue.enqueue({ organization_id: ORG_ID, payment_method: 'cash', access_token: 'secret', items: [] }),
      /forbidden_auth_material/,
    );
    await assert.rejects(
      queue.enqueue({ organization_id: ORG_ID, payment_method: 'cash', user_id: DEVICE_ID, items: [] }),
      /forbidden_auth_material/,
    );
  });

  await check('pedido só vira synced após ACK autoritativo coerente', async () => {
    const claimed = await queue.claimNext();
    assert.equal(claimed.local_order_id, first.local_order_id);

    await assert.rejects(
      queue.ackSynced(claimed.local_order_id, {
        order_id: ORDER_ID,
        client_request_id: second.client_request_id,
        device_id: DEVICE_ID,
      }),
      /ack_client_request_mismatch/,
    );

    const synced = await queue.ackSynced(claimed.local_order_id, {
      order_id: ORDER_ID,
      client_request_id: claimed.client_request_id,
      device_id: DEVICE_ID,
    });

    assert.equal(synced.state, 'synced');
    const snapshot = await queue.snapshot();
    assert.equal(snapshot.items.length, 2);
    assert.equal(snapshot.items[0].state, 'synced');
    assert.equal(snapshot.items[0].authoritative_ack.order_id, ORDER_ID);
  });

  await check('arquivos da fila são gravados com permissão privada', async () => {
    const stat = await fs.stat(path.join(rootDir, `queue-${DEVICE_ID}.json`));
    if (process.platform !== 'win32') assert.equal(stat.mode & 0o077, 0);
  });

  await check('canal local aceita HTTPS/loopback e rejeita origem HTTP remota', async () => {
    assert.equal(validateAllowedOrigin('https://app.visionfood.example/path'), 'https://app.visionfood.example');
    assert.equal(validateAllowedOrigin('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
    assert.throws(() => validateAllowedOrigin('http://example.com'), /allowed_origin_must_be_https_or_loopback/);
  });
} finally {
  await fs.rm(rootDir, { recursive: true, force: true });
}

const failed = results.filter((result) => result.status === 'FALHOU');
console.log(JSON.stringify({ tests: results.length, passed: results.length - failed.length, failed: failed.length }));
if (failed.length) process.exitCode = 1;
