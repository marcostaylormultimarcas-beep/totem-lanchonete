// @vitest-environment jsdom
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fromMock,
  rpcMock,
  invokeMock,
  toastErrorMock,
  toastSuccessMock,
  toastInfoMock,
  windowOpenMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
  windowOpenMock: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}));

vi.mock('@/data/store', () => ({
  formatCurrency: (value: number) => 'R$ ' + Number(value).toFixed(2),
}));

import CrmPanel from './CrmPanel';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

type Contact = {
  id: string;
  organization_id: string;
  phone_normalized: string;
  name: string;
  email: string;
  birth_date: string | null;
  tags: string[];
  notes: string;
  consent_status: 'unknown' | 'opt_in' | 'opt_out';
  lifecycle_stage: 'lead' | 'customer' | 'vip';
  confirmed_orders: number;
  confirmed_revenue: number;
  average_ticket: number;
  last_purchase_at: string | null;
  last_order_total: number;
  favorite_product: string;
};

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONTACT_A = '11111111-1111-4111-8111-111111111111';
const CONTACT_B = '22222222-2222-4222-8222-222222222222';
const INTERACTION_ID = '33333333-3333-4333-8333-333333333333';

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function contact(
  id: string,
  organizationId: string,
  name: string,
  phone: string,
  consent: Contact['consent_status'] = 'opt_in',
): Contact {
  return {
    id,
    organization_id: organizationId,
    phone_normalized: phone,
    name,
    email: '',
    birth_date: null,
    tags: [],
    notes: '',
    consent_status: consent,
    lifecycle_stage: 'customer',
    confirmed_orders: 3,
    confirmed_revenue: 120,
    average_ticket: 40,
    last_purchase_at: '2026-01-01T12:00:00.000Z',
    last_order_total: 40,
    favorite_product: 'Pizza',
  };
}

describe('CrmPanel footer actions', () => {
  let root: Root;
  let container: HTMLDivElement;
  let contactsByOrg: Record<string, Contact[]>;
  let interactionResponder: (args: unknown) => Promise<any>;
  let generateResponder: (body: unknown) => Promise<any>;
  let mounted: boolean;

  const tableResult = (table: string, organizationId: string) => {
    if (table === 'crm_contacts') {
      return { data: contactsByOrg[organizationId] || [], error: null };
    }
    return { data: [], error: null };
  };

  const makeQuery = (table: string) => {
    let organizationId = '';
    const q: any = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn((column: string, value: unknown) => {
      if (column === 'organization_id') organizationId = String(value);
      return q;
    });
    q.order = vi.fn(() => q);
    q.limit = vi.fn(() => q);
    q.then = (resolve: any, reject: any) =>
      Promise.resolve(tableResult(table, organizationId)).then(resolve, reject);
    return q;
  };

  const renderPanel = async (organizationId: string, storeName = 'Loja Teste') => {
    await act(async () => {
      root.render(<CrmPanel organizationId={organizationId} storeName={storeName} />);
      await flushAsync();
    });
  };

  const findButton = (text: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(text),
    ) as HTMLButtonElement | undefined;

  const findContactButton = (name: string) =>
    Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes(name) && button.textContent?.includes('compra(s)'),
    ) as HTMLButtonElement | undefined;

  const openContact = async (name: string) => {
    const button = findContactButton(name);
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await flushAsync();
    });
  };

  const clickButton = async (text: string, count = 1) => {
    const button = findButton(text);
    expect(button).toBeTruthy();
    await act(async () => {
      for (let index = 0; index < count; index += 1) button!.click();
      await flushAsync();
    });
  };

  const setMessage = async (value: string) => {
    const textareas = Array.from(container.querySelectorAll('textarea'));
    const textarea = textareas[textareas.length - 1] as HTMLTextAreaElement | undefined;
    expect(textarea).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    expect(setter).toBeTruthy();
    await act(async () => {
      setter!.call(textarea, value);
      textarea!.dispatchEvent(new Event('input', { bubbles: true }));
      textarea!.dispatchEvent(new Event('change', { bubbles: true }));
      await flushAsync();
    });
  };

  const messageTextarea = () => {
    const textareas = Array.from(container.querySelectorAll('textarea'));
    return textareas[textareas.length - 1] as HTMLTextAreaElement | undefined;
  };

  const interactionCalls = () =>
    rpcMock.mock.calls.filter(call => call[0] === 'crm_record_interaction');

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();

    contactsByOrg = {
      [ORG_A]: [
        contact(CONTACT_A, ORG_A, 'Ana Cliente', '62999999999'),
        contact(CONTACT_B, ORG_A, 'Bruno Cliente', '62888888888'),
      ],
      [ORG_B]: [
        contact(CONTACT_B, ORG_B, 'Bruno Loja B', '62777777777'),
      ],
    };

    interactionResponder = async () => ({ data: INTERACTION_ID, error: null });
    generateResponder = async () => ({
      data: { ok: true, message: 'Mensagem válida', generated_by: 'ai' },
      error: null,
    });

    fromMock.mockImplementation((table: string) => makeQuery(table));
    rpcMock.mockImplementation((name: string, args: unknown) => {
      if (name === 'crm_refresh_tasks') {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      if (name === 'crm_summary') {
        return Promise.resolve({ data: {}, error: null });
      }
      if (name === 'crm_record_interaction') {
        return interactionResponder(args);
      }
      throw new Error('Unexpected RPC: ' + name);
    });
    invokeMock.mockImplementation((_name: string, options: any) =>
      generateResponder(options?.body),
    );

    Object.defineProperty(window, 'open', {
      configurable: true,
      value: windowOpenMock,
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(async () => {
    if (mounted) {
      await act(async () => {
        root.unmount();
        await flushAsync();
      });
    }
    container.remove();
    vi.restoreAllMocks();
  });

  it('uses the real generation payload and accepts the valid Edge Function success contract', async () => {
    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('crm-generate-message', {
      body: {
        organization_id: ORG_A,
        contact_id: CONTACT_A,
        objetivo: 'recuperar',
        loja: 'Loja Teste',
        extras: undefined,
      },
    });
    expect(messageTextarea()?.value).toBe('Mensagem válida');
  });

  it('maps the Edge Function marketing opt-out response without populating a message', async () => {
    generateResponder = async () => ({
      data: { error: 'marketing_opt_out' },
      error: null,
    });

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    expect(messageTextarea()?.value).toBe('');
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Este contato optou por não receber marketing.',
    );
  });

  it('maps marketing_opt_out from a non-2xx Edge Function error body', async () => {
    generateResponder = async () => ({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: async () => ({ error: 'marketing_opt_out' }),
        },
      },
    });

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    expect(messageTextarea()?.value).toBe('');
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Este contato optou por não receber marketing.',
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      'Edge Function returned a non-2xx status code',
    );
  });

  it('rejects malformed generation success without ok=true', async () => {
    generateResponder = async () => ({
      data: { message: 'Mensagem sem confirmação', generated_by: 'ai' },
      error: null,
    });

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    expect(messageTextarea()?.value).toBe('');
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it('blocks two generation events dispatched in the same turn', async () => {
    const request = deferred<any>();
    generateResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem', 2);

    expect(invokeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({
        data: { ok: true, message: 'Mensagem única', generated_by: 'ai' },
        error: null,
      });
      await flushAsync();
    });
  });

  it('does not apply an old generation response after changing the selected contact', async () => {
    const request = deferred<any>();
    generateResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');
    await clickButton('Fechar');
    await openContact('Bruno Cliente');

    await act(async () => {
      request.resolve({
        data: { ok: true, message: 'Mensagem antiga da Ana', generated_by: 'ai' },
        error: null,
      });
      await flushAsync();
    });

    expect(messageTextarea()?.value).toBe('');
  });

  it('does not apply an old generation response after changing organization', async () => {
    const request = deferred<any>();
    generateResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    await renderPanel(ORG_B);
    await openContact('Bruno Loja B');

    await act(async () => {
      request.resolve({
        data: { ok: true, message: 'Mensagem antiga da organização A', generated_by: 'ai' },
        error: null,
      });
      await flushAsync();
    });

    expect(messageTextarea()?.value).toBe('');
  });

  it('does not emit generation success feedback after the modal is closed', async () => {
    const request = deferred<any>();
    generateResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');
    await clickButton('Fechar');

    await act(async () => {
      request.resolve({
        data: { ok: true, message: 'Mensagem antiga', generated_by: 'template' },
        error: null,
      });
      await flushAsync();
    });

    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('does not emit generation success feedback after unmount', async () => {
    const request = deferred<any>();
    generateResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await clickButton('Gerar mensagem');

    await act(async () => {
      root.unmount();
      mounted = false;
      await flushAsync();
    });

    request.resolve({
      data: { ok: true, message: 'Mensagem antiga', generated_by: 'template' },
      error: null,
    });
    await flushAsync();

    expect(toastInfoMock).not.toHaveBeenCalled();
  });

  it('keeps WhatsApp disabled for a blank or whitespace-only message', async () => {
    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('   ');

    expect(findButton('Abrir WhatsApp')?.disabled).toBe(true);
    expect(interactionCalls()).toHaveLength(0);
    expect(windowOpenMock).not.toHaveBeenCalled();
  });

  it('blocks marketing WhatsApp for a selected opt-out contact', async () => {
    contactsByOrg[ORG_A] = [
      contact(CONTACT_A, ORG_A, 'Ana Optout', '62999999999', 'opt_out'),
    ];

    await renderPanel(ORG_A);
    await openContact('Ana Optout');
    await setMessage('Mensagem manual');
    await clickButton('Abrir WhatsApp');

    expect(interactionCalls()).toHaveLength(0);
    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      'Este contato está marcado como opt-out de marketing.',
    );
  });

  it('opens WhatsApp only after crm_record_interaction returns its UUID', async () => {
    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');

    expect(interactionCalls()).toHaveLength(1);
    expect(interactionCalls()[0][1]).toEqual({
      _org: ORG_A,
      _contact_id: CONTACT_A,
      _objective: 'recuperar',
      _message: 'Olá Ana',
      _channel: 'whatsapp',
      _status: 'opened',
    });
    expect(windowOpenMock).toHaveBeenCalledTimes(1);
    expect(windowOpenMock).toHaveBeenCalledWith(
      'https://wa.me/5562999999999?text=Ol%C3%A1%20Ana',
      '_blank',
      'noopener,noreferrer',
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      'WhatsApp aberto e interação registrada.',
    );
  });

  it('does not open WhatsApp when crm_record_interaction has no valid UUID confirmation', async () => {
    interactionResponder = async () => ({ data: null, error: null });

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');

    expect(interactionCalls()).toHaveLength(1);
    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('contains crm_record_interaction transport rejection and keeps WhatsApp closed', async () => {
    interactionResponder = async () => {
      throw new Error('interaction network unavailable');
    };

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');

    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it('blocks two WhatsApp events dispatched in the same turn', async () => {
    const request = deferred<any>();
    interactionResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp', 2);

    expect(interactionCalls()).toHaveLength(1);

    await act(async () => {
      request.resolve({ data: INTERACTION_ID, error: null });
      await flushAsync();
    });
  });

  it('does not open an old contact WhatsApp after the selected contact changes', async () => {
    const request = deferred<any>();
    interactionResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');
    await clickButton('Fechar');
    await openContact('Bruno Cliente');

    await act(async () => {
      request.resolve({ data: INTERACTION_ID, error: null });
      await flushAsync();
    });

    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('does not open an old organization WhatsApp after organization changes', async () => {
    const request = deferred<any>();
    interactionResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');

    await renderPanel(ORG_B);
    await openContact('Bruno Loja B');

    await act(async () => {
      request.resolve({ data: INTERACTION_ID, error: null });
      await flushAsync();
    });

    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('does not open WhatsApp after the modal is closed while registration is pending', async () => {
    const request = deferred<any>();
    interactionResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');
    await clickButton('Fechar');

    await act(async () => {
      request.resolve({ data: INTERACTION_ID, error: null });
      await flushAsync();
    });

    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('does not open WhatsApp after unmount while registration is pending', async () => {
    const request = deferred<any>();
    interactionResponder = () => request.promise;

    await renderPanel(ORG_A);
    await openContact('Ana Cliente');
    await setMessage('Olá Ana');
    await clickButton('Abrir WhatsApp');

    await act(async () => {
      root.unmount();
      mounted = false;
      await flushAsync();
    });

    request.resolve({ data: INTERACTION_ID, error: null });
    await flushAsync();

    expect(windowOpenMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });
});
