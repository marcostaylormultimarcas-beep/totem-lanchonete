// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, functionsInvokeMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  functionsInvokeMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
    functions: {
      invoke: functionsInvokeMock,
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import PDV, {
  calculatePdvDiscount,
  calculatePdvSubtotal,
  calculatePdvTotal,
  shouldInvalidatePdvCoupon,
} from "@/pages/PDV";
import { PDV_SESSION_KEY } from "@/lib/pdvSession";

const operador = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Operador",
  username: "operador",
  organization_id: "22222222-2222-2222-2222-222222222222",
  org_slug: "loja-a",
  org_name: "Loja A",
};

const savedSession = {
  operador,
  sessionToken: "opaque-session-token",
  caixaId: "33333333-3333-3333-3333-333333333333",
};

function resumed(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    operador_id: operador.id,
    organization_id: operador.organization_id,
    store_id: "44444444-4444-4444-4444-444444444444",
    caixa_aberto_id: null,
    ...overrides,
  };
}

function deferred<T>() {
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
}

function renderPdv(root: Root, path = "/pdv/loja-a") {
  root.render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/pdv/:slug" element={<PDV />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PDV session bootstrap", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));
    localStorage.setItem("pdv_session_v1", JSON.stringify({ password: "legacy" }));

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed(), error: null });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products: [] }, error: null });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("uses the resumed server cash register instead of a stale locally saved cash id", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("Abertura de Caixa");
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_catalog_v2", expect.anything());

    const persisted = JSON.parse(sessionStorage.getItem(PDV_SESSION_KEY) || "null");
    expect(persisted.caixaId).toBeNull();
    expect(localStorage.getItem("pdv_session_v1")).toBeNull();
  });

  it("does not destroy a valid saved session when resume returns a transport error", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: null, error: new Error("network unavailable") });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).not.toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível validar a sessão do PDV. Tente novamente.");
  });

  it("always leaves booting when the resume RPC rejects", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.reject(new Error("offline"));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).not.toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível validar a sessão do PDV. Tente novamente.");
  });

  it("rejects a saved session from a different store slug before contacting resume", async () => {
    await act(async () => {
      renderPdv(root, "/pdv/loja-b");
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_resume_session_v2", expect.anything());

    const slugInput = container.querySelector<HTMLInputElement>('input[placeholder="Identificador da loja (slug)"]');
    expect(slugInput?.value).toBe("loja-b");
  });

  it("rejects saved operator metadata that does not match the resumed server context", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ organization_id: "55555555-5555-5555-5555-555555555555" }),
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_catalog_v2", expect.anything());
  });

  it("does not get stuck when legacy localStorage cleanup is unavailable", async () => {
    const originalRemoveItem = Storage.prototype.removeItem;
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function(this: Storage, key: string) {
      if (this === window.localStorage && key === "pdv_session_v1") {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
      return originalRemoveItem.call(this, key);
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("Abertura de Caixa");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).not.toBeNull();
    removeSpy.mockRestore();
  });

  it("removes a corrupted persisted session instead of reusing it", async () => {
    sessionStorage.setItem(PDV_SESSION_KEY, "{broken-json");

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_resume_session_v2", expect.anything());
  });

  it("does not restore state after unmount while resume validation is pending", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") return pending.promise;
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pending.resolve({
      data: resumed({ caixa_aberto_id: "66666666-6666-6666-6666-666666666666" }),
      error: null,
    });
    await flushAsync();

    expect(rpcMock).not.toHaveBeenCalledWith("pdv_catalog_v2", expect.anything());
  });

  it("clears local state immediately on logout and revokes the opaque token best-effort", async () => {
    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    const logoutButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "Sair");
    expect(logoutButton).toBeTruthy();

    await act(async () => {
      logoutButton!.click();
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledWith("pdv_logout_v2", { _session_token: savedSession.sessionToken });
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(container.textContent).toContain("PDV — Balcão");
  });
});


describe("PDV LoginScreen.submit", () => {
  let root: Root;
  let container: HTMLDivElement;

  const validToken = "a".repeat(64);

  function loginResponse(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      session_token: validToken,
      operador,
      caixa_aberto_id: null,
      ...overrides,
    };
  }

  function setInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function renderLogin(path = "/pdv/Loja-A") {
    sessionStorage.clear();
    localStorage.clear();
    await act(async () => {
      renderPdv(root, path);
      await flushAsync();
    });
    expect(container.textContent).toContain("PDV — Balcão");
  }

  function loginFields() {
    const slugInput = container.querySelector<HTMLInputElement>('input[placeholder="Identificador da loja (slug)"]');
    const usernameInput = container.querySelector<HTMLInputElement>('input[placeholder="Usuário"]');
    const passwordInput = container.querySelector<HTMLInputElement>('input[placeholder="Senha"]');
    const form = container.querySelector("form");
    if (!slugInput || !usernameInput || !passwordInput || !form) throw new Error("Login form not rendered");
    return { slugInput, usernameInput, passwordInput, form };
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") {
        return Promise.resolve({ data: loginResponse(), error: null });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("uses the route slug as authoritative and normalizes username before creating the session", async () => {
    await renderLogin();
    const { slugInput, usernameInput, passwordInput, form } = loginFields();

    expect(slugInput.value).toBe("loja-a");
    expect(slugInput.readOnly).toBe(true);

    await act(async () => {
      setInput(slugInput, "loja-b");
      setInput(usernameInput, "  OPERADOR  ");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledWith("pdv_create_session", {
      _org_slug: "loja-a",
      _username: "operador",
      _password: "secret",
    });
    expect(container.textContent).toContain("Abertura de Caixa");

    const persisted = JSON.parse(sessionStorage.getItem(PDV_SESSION_KEY) || "null");
    expect(persisted?.sessionToken).toBe(validToken);
    expect(persisted?.operador?.org_slug).toBe("loja-a");
  });

  it("prevents two login RPCs when two submits happen in the same tick", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderLogin();
    const { usernameInput, passwordInput, form } = loginFields();

    await act(async () => {
      setInput(usernameInput, "operador");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(rpcMock.mock.calls.filter(([name]) => name === "pdv_create_session")).toHaveLength(1);

    pending.resolve({
      data: { ok: false, reason: "invalid_credentials", remaining_attempts: 4 },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Entrar"));
    expect(submitButton?.hasAttribute("disabled")).toBe(false);
  });

  it("rejects malformed or cross-store success payloads instead of entering a broken PDV state", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") {
        return Promise.resolve({
          data: loginResponse({
            operador: { ...operador, org_slug: "loja-b" },
            session_token: "invalid-token",
          }),
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderLogin();
    const { usernameInput, passwordInput, form } = loginFields();

    await act(async () => {
      setInput(usernameInput, "operador");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(container.textContent).toContain("PDV — Balcão");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Resposta inválida ao iniciar a sessão do PDV. Tente novamente.");
  });

  it("releases loading and shows a safe message when the login RPC rejects", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") return Promise.reject(new Error("network unavailable"));
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderLogin();
    const { usernameInput, passwordInput, form } = loginFields();

    await act(async () => {
      setInput(usernameInput, "operador");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Entrar"));
    expect(submitButton?.hasAttribute("disabled")).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível conectar ao PDV. Tente novamente.");
    expect(container.textContent).toContain("PDV — Balcão");
  });

  it("ignores a successful response that arrives after the login screen unmounts", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderLogin();
    const { usernameInput, passwordInput, form } = loginFields();

    await act(async () => {
      setInput(usernameInput, "operador");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pending.resolve({ data: loginResponse(), error: null });
    await flushAsync();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
  });

  it("falls back to a finite retry message when retry_after_seconds is malformed", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_create_session") {
        return Promise.resolve({
          data: { ok: false, reason: "too_many_attempts", retry_after_seconds: "invalid" },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderLogin();
    const { usernameInput, passwordInput, form } = loginFields();

    await act(async () => {
      setInput(usernameInput, "operador");
      setInput(passwordInput, "secret");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Muitas tentativas incorretas. Aguarde cerca de 10 minuto(s) e tente novamente.",
    );
  });
});


describe("PDV AberturaScreen.submit", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openedCaixaId = "77777777-7777-7777-7777-777777777777";

  function setInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function renderOpening() {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    expect(container.textContent).toContain("Abertura de Caixa");
  }

  function openingFields() {
    const input = container.querySelector<HTMLInputElement>('input[inputmode="decimal"]');
    const form = container.querySelector("form");
    if (!input || !form) throw new Error("Cash opening form not rendered");
    return { input, form };
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.resolve({ data: { ok: true, caixa_id: openedCaixaId }, error: null });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products: [] }, error: null });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("parses a pt-BR opening balance exactly before calling pdv_abrir_caixa_v2", async () => {
    await renderOpening();
    const { input, form } = openingFields();

    await act(async () => {
      setInput(input, "1.234,56");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledWith("pdv_abrir_caixa_v2", {
      _session_token: savedSession.sessionToken,
      _saldo_inicial: 1234.56,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Caixa aberto");
    expect(rpcMock).toHaveBeenCalledWith("pdv_catalog_v2", {
      _session_token: savedSession.sessionToken,
    });
  });

  it("rejects empty, negative, non-numeric and unsafe extreme values before the RPC", async () => {
    await renderOpening();
    const { input, form } = openingFields();

    for (const value of ["", "-1,00", "NaN", "999999999999999999999999999999999,99"]) {
      await act(async () => {
        setInput(input, value);
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushAsync();
      });
    }

    expect(rpcMock.mock.calls.filter(([name]) => name === "pdv_abrir_caixa_v2")).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledTimes(4);
    expect(toastErrorMock).toHaveBeenLastCalledWith("Informe um saldo inicial válido.");
    expect(container.textContent).toContain("Abertura de Caixa");
  });

  it("prevents two cash-opening RPCs when two submits happen in the same tick", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { input, form } = openingFields();

    await act(async () => {
      setInput(input, "25,00");
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(rpcMock.mock.calls.filter(([name]) => name === "pdv_abrir_caixa_v2")).toHaveLength(1);

    pending.resolve({ data: { ok: false, reason: "open_failed" }, error: null });
    await act(async () => {
      await flushAsync();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Abrir Caixa"));
    expect(submitButton?.hasAttribute("disabled")).toBe(false);
  });

  it("handles a returned transport/PostgREST error without exposing its message and releases loading", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST500", status: 500, message: "session_token=secret-transport-detail" },
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Abrir Caixa"));
    expect(submitButton?.hasAttribute("disabled")).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível abrir o caixa. Tente novamente.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-transport-detail");
  });

  it("handles a rejected openCash promise without getting stuck or exposing details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.reject(new Error("session_token=secret-rejection-detail"));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    const submitButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Abrir Caixa"));
    expect(submitButton?.hasAttribute("disabled")).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível abrir o caixa. Tente novamente.");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-rejection-detail");
  });

  it("rejects an ok=true response without a valid caixa_id", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.resolve({ data: { ok: true, caixa_id: "not-a-uuid" }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(container.textContent).toContain("Abertura de Caixa");
    expect(toastSuccessMock).not.toHaveBeenCalledWith("Caixa aberto");
    expect(toastErrorMock).toHaveBeenCalledWith("Resposta inválida ao abrir o caixa. Tente novamente.");
    expect(consoleError).toHaveBeenCalledWith("[PDV] invalid pdv_abrir_caixa_v2 success payload");
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_catalog_v2", expect.anything());
  });

  it("recovers an already_open response only when it carries a valid caixa_id", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.resolve({
          data: { ok: false, reason: "already_open", caixa_id: openedCaixaId },
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products: [] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(toastSuccessMock).toHaveBeenCalledWith("Caixa já estava aberto");
    expect(rpcMock).toHaveBeenCalledWith("pdv_catalog_v2", {
      _session_token: savedSession.sessionToken,
    });
  });

  it("expires the local PDV session when pdv_abrir_caixa_v2 reports invalid_session", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") {
        return Promise.resolve({ data: { ok: false, reason: "invalid_session" }, error: null });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Sessão expirada. Entre novamente.");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(container.textContent).toContain("PDV — Balcão");
  });

  it("ignores a successful response that arrives after AberturaScreen unmounts", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({ data: resumed({ caixa_aberto_id: null }), error: null });
      }
      if (name === "pdv_abrir_caixa_v2") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderOpening();
    const { form } = openingFields();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pending.resolve({ data: { ok: true, caixa_id: openedCaixaId }, error: null });
    await flushAsync();

    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_catalog_v2", expect.anything());
  });
});


describe("PDV catalog loading", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openCaixaId = "33333333-3333-3333-3333-333333333333";
  const productId = "77777777-7777-7777-7777-777777777777";
  const validProduct = {
    id: productId,
    name: "Café",
    price: 12.5,
    codigo_barras: "7891234567890",
    available: null,
    image: "",
  };

  function catalogResponse(products: unknown = [validProduct]) {
    return { ok: true, products };
  }

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: catalogResponse(), error: null });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  async function renderMain() {
    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });
  }

  it("shows an explicit loading state and only shows a valid empty/result state after the catalog resolves", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    expect(container.textContent).toContain("Carregando produtos");
    expect(container.textContent).not.toContain("Nenhum produto encontrado");

    pending.resolve({ data: catalogResponse(), error: null });
    await act(async () => {
      await flushAsync();
    });

    expect(container.textContent).toContain("Café");
    expect(container.textContent).toContain("R$");
    expect(container.textContent).not.toContain("Carregando produtos");
  });

  it("keeps transport/PostgREST failures distinct from a valid empty catalog and does not expose backend details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST500",
            status: 503,
            message: "sensitive backend detail",
          },
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    expect(container.textContent).toContain("Não foi possível carregar os produtos do PDV");
    expect(container.textContent).not.toContain("Nenhum produto encontrado");
    expect(container.textContent).not.toContain("sensitive backend detail");
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível carregar os produtos do PDV. Tente novamente.");
    expect(consoleError).toHaveBeenCalledWith("[PDV] pdv_catalog_v2 transport error", {
      code: "PGRST500",
      status: 503,
    });
  });

  it("handles a rejected catalog Promise without an unhandled flow or technical message leak", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.reject(Object.assign(new Error("private network detail"), {
          code: "FETCH_ERROR",
          status: 503,
        }));
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    expect(container.textContent).toContain("Não foi possível carregar os produtos do PDV");
    expect(container.textContent).not.toContain("private network detail");
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível carregar os produtos do PDV. Tente novamente.");
    expect(consoleError).toHaveBeenCalledWith("[PDV] pdv_catalog_v2 rejected", {
      code: "FETCH_ERROR",
      status: 503,
    });
  });

  it("expires the local PDV session when pdv_catalog_v2 reports invalid_session", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: false, reason: "invalid_session" },
          error: null,
        });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    expect(toastErrorMock).toHaveBeenCalledWith("Sessão expirada. Entre novamente.");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(container.textContent).toContain("PDV — Balcão");
  });

  it.each([
    ["missing products", { ok: true }],
    ["null products", { ok: true, products: null }],
    ["non-array products", { ok: true, products: {} }],
    ["invalid product id", catalogResponse([{ ...validProduct, id: "not-a-uuid" }])],
    ["empty product name", catalogResponse([{ ...validProduct, name: "   " }])],
    ["negative price", catalogResponse([{ ...validProduct, price: -0.01 }])],
    ["unsafe extreme price", catalogResponse([{ ...validProduct, price: Number.MAX_VALUE }])],
    ["unavailable product", catalogResponse([{ ...validProduct, available: false }])],
    ["invalid barcode type", catalogResponse([{ ...validProduct, codigo_barras: 123 }])],
    ["invalid image type", catalogResponse([{ ...validProduct, image: null }])],
    ["duplicate product ids", catalogResponse([validProduct, { ...validProduct, name: "Outro" }])],
  ])("rejects malformed catalog payload: %s", async (_label, payload) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: payload, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    expect(container.textContent).toContain("Não foi possível carregar os produtos do PDV");
    expect(container.textContent).not.toContain("Nenhum produto encontrado");
    expect(toastErrorMock).toHaveBeenCalledWith("Não foi possível carregar os produtos do PDV. Tente novamente.");
    expect(consoleError).toHaveBeenCalledWith("[PDV] invalid pdv_catalog_v2 success payload");
  });

  it("ignores a catalog response that arrives after PDVMain unmounts", async () => {
    const pending = deferred<{ data: unknown; error: unknown }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    expect(container.textContent).toContain("Carregando produtos");

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pending.resolve({
      data: null,
      error: { code: "PGRST500", status: 503, message: "late error" },
    });
    await flushAsync();

    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});


describe("PDV catalog search and filter", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openCaixaId = "33333333-3333-3333-3333-333333333333";

  const product = (
    index: number,
    overrides: Partial<{
      id: string;
      name: string;
      price: number;
      codigo_barras: string | null;
      available: null;
      image: string;
    }> = {},
  ) => ({
    id: `99999999-9999-9999-9999-${String(index).padStart(12, "0")}`,
    name: `Produto ${index}`,
    price: 10 + index / 100,
    codigo_barras: `789000${String(index).padStart(7, "0")}`,
    available: null as null,
    image: "",
    ...overrides,
  });

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  async function renderSearch(products: unknown) {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({ data: { ok: true, products }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Buscar produto ou bipar código de barras…"]',
    );
    expect(input).not.toBeNull();
    return input!;
  }

  async function setSearch(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("input value setter unavailable");

    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsync();
    });
  }

  async function pressEnter(input: HTMLInputElement) {
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await flushAsync();
    });
  }

  it("matches product names case-insensitively while ignoring Portuguese accents and repeated spaces", async () => {
    const input = await renderSearch([
      product(1, { name: "Café   com Leite", codigo_barras: "CAF001" }),
      product(2, { name: "Chá Gelado", codigo_barras: "CHA002" }),
    ]);

    await setSearch(input, "  CAFE com   leite  ");

    expect(container.textContent).toContain("Café   com Leite");
    expect(container.textContent).not.toContain("Chá Gelado");
  });

  it("keeps the default catalog grid capped at 24 products", async () => {
    await renderSearch(Array.from({ length: 30 }, (_, index) => product(index + 1)));

    expect(container.textContent).toContain("Produto 24");
    expect(container.textContent).not.toContain("Produto 25");
  });

  it("keeps a non-empty search capped at 48 products", async () => {
    const input = await renderSearch(
      Array.from({ length: 60 }, (_, index) =>
        product(index + 1, { name: `Busca Produto ${index + 1}` }),
      ),
    );

    await setSearch(input, "busca");

    expect(container.textContent).toContain("Busca Produto 48");
    expect(container.textContent).not.toContain("Busca Produto 49");
  });

  it("gives an exact alphanumeric barcode priority over an earlier partial name match on Enter", async () => {
    const input = await renderSearch([
      product(1, { name: "Promo ABC12345", codigo_barras: "OTHER001" }),
      product(2, { name: "Produto Correto", codigo_barras: "ABC12345" }),
    ]);

    await setSearch(input, "ABC12345");
    await pressEnter(input);

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("Produto Correto");
    expect(cartText).not.toContain("Promo ABC12345");
    expect(input.value).toBe("");
  });

  it("does not auto-add the first product when Enter only has a partial barcode match", async () => {
    const input = await renderSearch([
      product(1, { name: "Produto A", codigo_barras: "ABC12345" }),
      product(2, { name: "Produto B", codigo_barras: "ABC12399" }),
    ]);

    await setSearch(input, "ABC123");
    await pressEnter(input);

    expect(container.querySelector("aside")?.textContent).toContain(
      "Nenhum item. Adicione um produto ou bipe o código.",
    );
    expect(input.value).toBe("ABC123");
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Código de barras incompleto ou não encontrado. Refine a busca ou selecione o produto.",
    );
  });

  it("refuses ambiguous auto-add when two catalog products share the same barcode", async () => {
    const input = await renderSearch([
      product(1, { name: "Produto Duplicado A", codigo_barras: "DUPL1234" }),
      product(2, { name: "Produto Duplicado B", codigo_barras: "DUPL1234" }),
    ]);

    await setSearch(input, "DUPL1234");
    await pressEnter(input);

    expect(container.querySelector("aside")?.textContent).toContain(
      "Nenhum item. Adicione um produto ou bipe o código.",
    );
    expect(input.value).toBe("DUPL1234");
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Código de barras duplicado no catálogo. Selecione o produto manualmente.",
    );
  });

  it("keeps a long nonexistent code visible and gives explicit feedback instead of adding anything", async () => {
    const input = await renderSearch([
      product(1, { name: "Produto Existente", codigo_barras: "1234567890123" }),
    ]);
    const missingCode = "9".repeat(128);

    await setSearch(input, missingCode);
    await pressEnter(input);

    expect(container.querySelector("aside")?.textContent).toContain(
      "Nenhum item. Adicione um produto ou bipe o código.",
    );
    expect(input.value).toBe(missingCode);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Nenhum produto encontrado para essa busca.",
    );
  });

  it("uses the input's current value on Enter so a rapid scanner event cannot act on stale React query state", async () => {
    const input = await renderSearch([
      product(1, { name: "Primeiro Produto", codigo_barras: "FIRST001" }),
      product(2, { name: "Produto Bipado", codigo_barras: "FAST1234" }),
    ]);

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("input value setter unavailable");

    setter.call(input, "FAST1234");
    await pressEnter(input);

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("Produto Bipado");
    expect(cartText).not.toContain("Primeiro Produto");
  });

  it("does not treat Enter during catalog loading as an empty/not-found catalog", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") return pending.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });

    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Buscar produto ou bipar código de barras…"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, "7891234567890");

    await pressEnter(input);

    expect(container.textContent).toContain("Carregando produtos");
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Aguarde os produtos terminarem de carregar.",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "Nenhum produto encontrado para essa busca.",
    );

    pending.resolve({
      data: { ok: true, products: [product(1)] },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });
  });
});


describe("PDV subtotal calculation", () => {
  it("sums in integer cents and isolates malformed or unsafe cart rows", () => {
    const subtotal = calculatePdvSubtotal([
      { price: 0.1, quantity: 1 },
      { price: 0.2, quantity: 1 },
      { price: 12.34, quantity: 2 },
      { price: Number.NaN, quantity: 1 },
      { price: Number.POSITIVE_INFINITY, quantity: 1 },
      { price: -1, quantity: 1 },
      { price: "9.99", quantity: 1 },
      { price: 10, quantity: Number.NaN },
      { price: 10, quantity: 1.5 },
      { price: 10, quantity: -1 },
      { price: 10, quantity: 1000 },
      { price: Number.MAX_SAFE_INTEGER / 100, quantity: 999 },
    ]);

    expect(subtotal).toBe(24.98);
    expect(Number.isFinite(subtotal)).toBe(true);
    expect(Number.isSafeInteger(Math.round(subtotal * 100))).toBe(true);
  });

  it("returns a finite zero for an empty or wholly invalid cart", () => {
    expect(calculatePdvSubtotal([])).toBe(0);
    expect(
      calculatePdvSubtotal([
        { price: Number.NaN, quantity: 1 },
        { price: 10, quantity: 0 },
        { price: Number.POSITIVE_INFINITY, quantity: 1 },
      ]),
    ).toBe(0);
  });
});


describe("PDV automatic coupon invalidation", () => {
  it("invalidates only when a valid minimum is above the current subtotal", () => {
    expect(shouldInvalidatePdvCoupon(19.99, 20)).toBe(true);
    expect(shouldInvalidatePdvCoupon(20, 20)).toBe(false);
    expect(shouldInvalidatePdvCoupon(25.5, "25.50")).toBe(false);
    expect(shouldInvalidatePdvCoupon(25.49, "25.50")).toBe(true);
    expect(shouldInvalidatePdvCoupon(0, null)).toBe(false);
    expect(shouldInvalidatePdvCoupon(0, undefined)).toBe(false);
  });

  it("fails closed for malformed, negative, non-finite, or unsafe minimum values", () => {
    const malformedMinimums = [
      "",
      "not-a-number",
      "NaN",
      Number.NaN,
      "Infinity",
      Number.POSITIVE_INFINITY,
      -1,
      "-1",
      Number.MAX_VALUE,
      {},
    ];

    for (const minimum of malformedMinimums) {
      expect(shouldInvalidatePdvCoupon(50, minimum)).toBe(true);
    }
  });
});


describe("PDV discount calculation", () => {
  it("rounds percentage discounts to cents like the authoritative backend", () => {
    expect(
      calculatePdvDiscount(0.99, {
        tipo: "percent",
        valor: 33,
        minimo_pedido: 0,
      }),
    ).toBe(0.33);

    expect(
      calculatePdvDiscount(10.01, {
        tipo: "percentual",
        valor: 12.5,
        minimo_pedido: 0,
      }),
    ).toBe(1.25);
  });

  it("caps percentage discounts at 100 percent and never exceeds the subtotal", () => {
    expect(
      calculatePdvDiscount(50, {
        tipo: "percentage",
        valor: 150,
        minimo_pedido: 0,
      }),
    ).toBe(50);
  });

  it("supports fixed discount aliases and caps a valid fixed value at the subtotal", () => {
    expect(
      calculatePdvDiscount(50, {
        tipo: "fixed",
        valor: 12.34,
        minimo_pedido: 0,
      }),
    ).toBe(12.34);

    expect(
      calculatePdvDiscount(10, {
        tipo: "valor_fixo",
        valor: 99,
        minimo_pedido: 0,
      }),
    ).toBe(10);
  });

  it("fails closed for malformed minimums instead of calculating during the clearing render", () => {
    const malformedMinimums = [
      "",
      "not-a-number",
      "NaN",
      Number.NaN,
      "Infinity",
      Number.POSITIVE_INFINITY,
      -1,
      Number.MAX_VALUE,
      {},
    ];

    for (const minimum of malformedMinimums) {
      expect(
        calculatePdvDiscount(50, {
          tipo: "fixed",
          valor: 5,
          minimo_pedido: minimum,
        }),
      ).toBe(0);
    }
  });

  it("fails closed for negative, non-finite, or malformed discount values", () => {
    const invalidValues = [
      -10,
      "-10",
      Number.NaN,
      "NaN",
      Number.POSITIVE_INFINITY,
      "Infinity",
      "",
      "not-a-number",
      {},
    ];

    for (const value of invalidValues) {
      expect(
        calculatePdvDiscount(50, {
          tipo: "fixed",
          valor: value,
          minimo_pedido: 0,
        }),
      ).toBe(0);

      expect(
        calculatePdvDiscount(50, {
          tipo: "percent",
          valor: value,
          minimo_pedido: 0,
        }),
      ).toBe(0);
    }
  });

  it("rejects an unsafe fixed amount but clamps a huge finite percentage to 100 percent", () => {
    expect(
      calculatePdvDiscount(50, {
        tipo: "fixed",
        valor: Number.MAX_VALUE,
        minimo_pedido: 0,
      }),
    ).toBe(0);

    expect(
      calculatePdvDiscount(50, {
        tipo: "percent",
        valor: Number.MAX_VALUE,
        minimo_pedido: 0,
      }),
    ).toBe(50);
  });

  it("returns zero for an unknown discount type or an invalid subtotal", () => {
    expect(
      calculatePdvDiscount(50, {
        tipo: "mystery",
        valor: 10,
        minimo_pedido: 0,
      }),
    ).toBe(0);

    expect(
      calculatePdvDiscount(Number.NaN, {
        tipo: "fixed",
        valor: 10,
        minimo_pedido: 0,
      }),
    ).toBe(0);

    expect(
      calculatePdvDiscount(Number.POSITIVE_INFINITY, {
        tipo: "fixed",
        valor: 10,
        minimo_pedido: 0,
      }),
    ).toBe(0);

    expect(calculatePdvDiscount(50, null)).toBe(0);
  });
});

describe("PDV total calculation", () => {
  it("subtracts decimal amounts without binary floating-point drift", () => {
    expect(0.3 - 0.1).not.toBe(0.2);
    expect(calculatePdvTotal(0.3, 0.1)).toBe(0.2);
  });

  it("preserves valid fixed-discount precision instead of forcing cents", () => {
    expect(calculatePdvTotal(1, 0.005)).toBe(0.995);
    expect(calculatePdvTotal(10.01, 1.25)).toBe(8.76);
  });

  it("matches the backend clamp when the discount reaches or exceeds subtotal", () => {
    expect(calculatePdvTotal(50, 50)).toBe(0);
    expect(calculatePdvTotal(50, 75)).toBe(0);
  });

  it("fails closed for invalid, negative, non-finite, or unsafe subtotals", () => {
    for (const subtotal of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      Number.MAX_VALUE,
    ]) {
      expect(calculatePdvTotal(subtotal, 1)).toBe(0);
    }
  });

  it("fails closed for invalid, negative, non-finite, or unsafe discounts", () => {
    for (const discount of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      Number.MAX_VALUE,
    ]) {
      expect(calculatePdvTotal(50, discount)).toBe(0);
    }
  });

  it("preserves an exact valid subtotal when there is no discount", () => {
    expect(calculatePdvTotal(10.01, 0)).toBe(10.01);
  });
});


describe("PDV addToCart", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openCaixaId = "33333333-3333-3333-3333-333333333333";
  const product = {
    id: "88888888-8888-8888-8888-888888888888",
    name: "Produto Carrinho",
    price: 12.5,
    codigo_barras: "ADD12345",
    available: null,
    image: "",
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  async function renderMain() {
    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });
  }

  function productButton(name = product.name) {
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes(name),
    );
    if (!button) throw new Error("Product button not rendered");
    return button;
  }

  function cartRows() {
    return Array.from(
      container.querySelectorAll<HTMLDivElement>("aside > .flex-1 > div"),
    ).filter((row) => row.querySelector("button"));
  }

  function searchInput() {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Buscar produto ou bipar código de barras…"]',
    );
    if (!input) throw new Error("Search input not rendered");
    return input;
  }

  function couponInput() {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Código do cupom"]',
    );
    if (!input) throw new Error("Coupon input not rendered");
    return input;
  }

  function applyCouponButton() {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Aplicar",
    );
    if (!button) throw new Error("Coupon apply button not rendered");
    return button;
  }

  async function enterCouponCode(code: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("HTML input setter unavailable");

    await act(async () => {
      setter.call(couponInput(), code);
      couponInput().dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsync();
    });
  }

  it("uses functional cart updates so two rapid clicks increment one row without losing quantity", async () => {
    await renderMain();
    const button = productButton();

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain(product.name);
    expect(cartText).toContain("× 2 =");
    expect(cartText.match(/Produto Carrinho/g)).toHaveLength(1);
  });

  it("falls back to the validated product id when crypto.randomUUID is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain(product.name);
    expect(cartText).toContain("× 1 =");
    expect(container.textContent).toContain("Comanda atual");
  });

  it("caps one product at the backend-supported maximum of 999 and refuses overflow", async () => {
    await renderMain();
    const button = productButton();

    await act(async () => {
      for (let index = 0; index < 999; index += 1) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
      await flushAsync();
    });

    let cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 999 =");
    expect(cartText).not.toContain("× 1000 =");

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 999 =");
    expect(cartText).not.toContain("× 1000 =");
    expect(toastErrorMock).toHaveBeenCalledWith("Quantidade máxima por produto: 999.");

    toastErrorMock.mockClear();
    const maxRowButtons = cartRows()[0]?.querySelectorAll("button");
    const plusAtMaximum = maxRowButtons?.[1];
    if (!plusAtMaximum) throw new Error("Cart plus button not rendered");

    await act(async () => {
      plusAtMaximum.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      plusAtMaximum.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 999 =");
    expect(cartText).not.toContain("× 1000 =");
    expect(toastErrorMock).toHaveBeenCalledWith("Quantidade máxima por produto: 999.");
  });

  it("handles rapid quantity button updates without lost increments and removes at zero", async () => {
    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const buttons = cartRows()[0]?.querySelectorAll("button");
    const minus = buttons?.[0];
    const plus = buttons?.[1];
    if (!minus || !plus) throw new Error("Cart quantity buttons not rendered");

    await act(async () => {
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    let cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 3 =");

    await act(async () => {
      minus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      minus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      minus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("Nenhum item. Adicione um produto ou bipe o código.");
    expect(cartText).not.toContain(product.name);
  });


  it("invalidates an applied coupon after rapid quantity changes cross below the minimum without auto-restoring it", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "MIN20",
              tipo: "fixed",
              valor: 1,
              minimo_pedido: 20,
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      const button = productButton();
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const couponInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="Código do cupom"]',
    );
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!couponInput || !inputSetter) throw new Error("Coupon input not rendered");

    await act(async () => {
      inputSetter.call(couponInput, "MIN20");
      couponInput.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsync();
    });

    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "Aplicar",
    );
    if (!applyButton) throw new Error("Coupon apply button not rendered");

    await act(async () => {
      applyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    let cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("Desconto (MIN20)");

    const rowButtons = cartRows()[0]?.querySelectorAll("button");
    const minus = rowButtons?.[0];
    if (!minus) throw new Error("Cart minus button not rendered");

    await act(async () => {
      minus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      minus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 1 =");
    expect(cartText).not.toContain("Desconto (MIN20)");

    const plus = cartRows()[0]?.querySelectorAll("button")[1];
    if (!plus) throw new Error("Cart plus button not rendered");

    await act(async () => {
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 3 =");
    expect(cartText).not.toContain("Desconto (MIN20)");
  });

  it("expires the local PDV session when coupon validation reports invalid_session", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: { ok: false, reason: "invalid_session" },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await enterCouponCode("EXPIRED");

    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Sessão expirada. Entre novamente.");
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(container.textContent).toContain("PDV — Balcão");
  });

  it("does not expose transport details when coupon validation returns a PostgREST error", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: null,
          error: {
            code: "42501",
            status: 401,
            message: "permission denied for function pdv_validar_cupom_v2",
          },
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await enterCouponCode("SAFE");

    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível validar o cupom. Tente novamente.",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "permission denied for function pdv_validar_cupom_v2",
    );
  });

  it("rejects a malformed successful coupon payload instead of applying fail-open defaults", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "BROKEN",
              tipo: "fixed",
              valor: "not-a-number",
              minimo_pedido: "not-a-number",
            },
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await enterCouponCode("BROKEN");

    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(container.querySelector("aside")?.textContent || "").not.toContain(
      "Desconto (BROKEN)",
    );
    expect(toastSuccessMock).not.toHaveBeenCalledWith("Cupom BROKEN aplicado");
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível validar o cupom. Tente novamente.",
    );
  });

  it("keeps the latest coupon when an older validation response arrives last", async () => {
    const oldRequest = deferred<{ data: unknown; error: null }>();
    const newRequest = deferred<{ data: unknown; error: null }>();

    rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        if (args?._codigo === "OLD") return oldRequest.promise;
        if (args?._codigo === "NEW") return newRequest.promise;
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    await enterCouponCode("OLD");

    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    await enterCouponCode("NEW");
    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    newRequest.resolve({
      data: {
        ok: true,
        cupom: { codigo: "NEW", tipo: "fixed", valor: 1, minimo_pedido: 0 },
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });
    expect(container.querySelector("aside")?.textContent || "").toContain(
      "Desconto (NEW)",
    );

    oldRequest.resolve({
      data: {
        ok: true,
        cupom: { codigo: "OLD", tipo: "fixed", valor: 1, minimo_pedido: 0 },
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("Desconto (NEW)");
    expect(cartText).not.toContain("Desconto (OLD)");
  });

  it("checks the current subtotal when coupon validation resolves instead of the click-time subtotal", async () => {
    const request = deferred<{ data: unknown; error: null }>();

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") return request.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });
    expect(container.querySelector("aside")?.textContent || "").toContain("× 1 =");

    await enterCouponCode("MIN25");
    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });
    expect(container.querySelector("aside")?.textContent || "").toContain("× 2 =");

    request.resolve({
      data: {
        ok: true,
        cupom: { codigo: "MIN25", tipo: "fixed", valor: 1, minimo_pedido: 25 },
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(container.querySelector("aside")?.textContent || "").toContain(
      "Desconto (MIN25)",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "Pedido mínimo para este cupom: R$ 25,00",
    );
  });

  it("ignores a coupon success response that arrives after PDVMain unmounts", async () => {
    const request = deferred<{ data: unknown; error: null }>();

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") return request.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await enterCouponCode("LATE");

    await act(async () => {
      applyCouponButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    request.resolve({
      data: {
        ok: true,
        cupom: { codigo: "LATE", tipo: "fixed", valor: 1, minimo_pedido: 0 },
      },
      error: null,
    });
    await flushAsync();

    expect(toastSuccessMock).not.toHaveBeenCalledWith("Cupom LATE aplicado");
  });

  it("changes only the targeted cart row when multiple products are present", async () => {
    const secondProduct = {
      ...product,
      id: "77777777-7777-7777-7777-777777777777",
      name: "Produto Carrinho B",
      codigo_barras: "ADD54321",
    };

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product, secondProduct] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton(product.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      productButton(secondProduct.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    let rows = cartRows();
    expect(rows).toHaveLength(2);
    const firstButtons = rows[0].querySelectorAll("button");
    const firstPlus = firstButtons[1];
    if (!firstPlus) throw new Error("First cart plus button not rendered");

    await act(async () => {
      firstPlus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    rows = cartRows();
    expect(rows[0].textContent).toContain(product.name);
    expect(rows[0].textContent).toContain("× 2 =");
    expect(rows[1].textContent).toContain(secondProduct.name);
    expect(rows[1].textContent).toContain("× 1 =");
  });

  it("manual selection and exact barcode Enter converge on the same cart item", async () => {
    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const input = searchInput();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("input value setter unavailable");

    await act(async () => {
      setter.call(input, product.codigo_barras);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      );
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartText).toContain("× 2 =");
    expect(cartText.match(/Produto Carrinho/g)).toHaveLength(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("🛒 Produto Carrinho adicionado");
  });

  it("removes only the selected row when multiple products are in the cart", async () => {
    const secondProduct = {
      ...product,
      id: "77777777-7777-7777-7777-777777777777",
      name: "Produto Remoção B",
      codigo_barras: "REMOVE54321",
    };
    const ids = [
      "66666666-6666-4666-8666-666666666661",
      "66666666-6666-4666-8666-666666666662",
    ];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()!) });

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product, secondProduct] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton(product.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      productButton(secondProduct.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const firstTrash = cartRows()[0]?.querySelectorAll("button")[2];
    if (!firstTrash) throw new Error("First cart remove button not rendered");

    await act(async () => {
      firstTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartRows()).toHaveLength(1);
    expect(cartText).not.toContain(product.name);
    expect(cartText).toContain(secondProduct.name);
    expect(cartText).toContain("× 1 =");
  });

  it("handles a rapid double remove without resurrecting or corrupting another row", async () => {
    const secondProduct = {
      ...product,
      id: "77777777-7777-7777-7777-777777777777",
      name: "Produto Preservado",
      codigo_barras: "KEEP54321",
    };
    const ids = [
      "55555555-5555-4555-8555-555555555551",
      "55555555-5555-4555-8555-555555555552",
    ];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()!) });

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product, secondProduct] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton(product.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      productButton(secondProduct.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const firstTrash = cartRows()[0]?.querySelectorAll("button")[2];
    if (!firstTrash) throw new Error("First cart remove button not rendered");

    await act(async () => {
      firstTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      firstTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartRows()).toHaveLength(1);
    expect(cartText).not.toContain(product.name);
    expect(cartText).toContain(secondProduct.name);
  });

  it("applies several removals in the same tick without a lost update", async () => {
    const secondProduct = {
      ...product,
      id: "77777777-7777-7777-7777-777777777777",
      name: "Produto Remoção Simultânea",
      codigo_barras: "SAME54321",
    };
    const ids = [
      "44444444-4444-4444-8444-444444444441",
      "44444444-4444-4444-8444-444444444442",
    ];
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => ids.shift()!) });

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product, secondProduct] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton(product.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      productButton(secondProduct.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const rows = cartRows();
    const firstTrash = rows[0]?.querySelectorAll("button")[2];
    const secondTrash = rows[1]?.querySelectorAll("button")[2];
    if (!firstTrash || !secondTrash) throw new Error("Cart remove buttons not rendered");

    await act(async () => {
      firstTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      secondTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(cartRows()).toHaveLength(0);
    expect(container.querySelector("aside")?.textContent).toContain(
      "Nenhum item. Adicione um produto ou bipe o código.",
    );
  });

  it("refuses duplicated local row ids instead of deleting an ambiguous cart", async () => {
    const secondProduct = {
      ...product,
      id: "77777777-7777-7777-7777-777777777777",
      name: "Produto ID Duplicado",
      codigo_barras: "DUPREMOVE",
    };
    const duplicatedId = "33333333-3333-4333-8333-333333333333";
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => duplicatedId) });

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product, secondProduct] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await act(async () => {
      productButton(product.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      productButton(secondProduct.name).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(cartRows()).toHaveLength(2);
    const ambiguousTrash = cartRows()[0]?.querySelectorAll("button")[2];
    if (!ambiguousTrash) throw new Error("Ambiguous cart remove button not rendered");

    await act(async () => {
      ambiguousTrash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartRows()).toHaveLength(2);
    expect(cartText).toContain(product.name);
    expect(cartText).toContain(secondProduct.name);

  });


  it("removes a uniquely targeted malformed local row id without crashing the PDV", async () => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "not-a-valid-row-id") });
    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(cartRows()).toHaveLength(1);
    const trash = cartRows()[0]?.querySelectorAll("button")[2];
    if (!trash) throw new Error("Cart remove button not rendered");

    await act(async () => {
      trash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const cartText = container.querySelector("aside")?.textContent || "";
    expect(cartRows()).toHaveLength(0);
    expect(cartText).not.toContain(product.name);
    expect(cartText).toContain("Nenhum item. Adicione um produto ou bipe o código.");
    expect(container.textContent).toContain("Comanda atual");
  });

  it("does not resurrect an item when quantity changes and removal happen in the same tick", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "22222222-2222-4222-8222-222222222222"),
    });
    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    const buttons = cartRows()[0]?.querySelectorAll("button");
    const plus = buttons?.[1];
    const trash = buttons?.[2];
    if (!plus || !trash) throw new Error("Cart controls not rendered");

    await act(async () => {
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      trash.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(cartRows()).toHaveLength(0);
    expect(container.querySelector("aside")?.textContent).toContain(
      "Nenhum item. Adicione um produto ou bipe o código.",
    );
  });
});


describe("PDV customer mirror BroadcastChannel lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openCaixaId = "33333333-3333-3333-3333-333333333333";

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  async function renderMain() {
    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });
  }

  function installBroadcastChannel() {
    const constructorMock = vi.fn();
    const closeMock = vi.fn();
    const postMessageMock = vi.fn();

    class FakeBroadcastChannel {
      constructor(name: string) {
        constructorMock(name);
      }

      postMessage = postMessageMock;
      close = closeMock;
    }

    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
    return { constructorMock, closeMock, postMessageMock };
  }

  it("creates one pdv-cliente channel per mount and closes each channel on unmount", async () => {
    const { constructorMock, closeMock } = installBroadcastChannel();

    await renderMain();
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenLastCalledWith("pdv-cliente");

    await act(async () => root.unmount());
    expect(closeMock).toHaveBeenCalledTimes(1);

    root = createRoot(container);
    await renderMain();
    expect(constructorMock).toHaveBeenCalledTimes(2);
    expect(constructorMock).toHaveBeenLastCalledWith("pdv-cliente");

    await act(async () => root.unmount());
    expect(closeMock).toHaveBeenCalledTimes(2);
    container.remove();
  });

  it("keeps the PDV mounted and persists the localStorage fallback when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    await renderMain();

    expect(container.textContent).toContain("Comanda atual");
    const snapshot = JSON.parse(
      localStorage.getItem("pdv_cliente_mirror_v1") || "null",
    );
    expect(snapshot).toMatchObject({
      storeName: operador.org_name,
      items: [],
      subtotal: 0,
      desconto: 0,
      total: 0,
      forma: "dinheiro",
    });
  });

  it("keeps the localStorage fallback when BroadcastChannel construction throws", async () => {
    class ThrowingBroadcastChannel {
      constructor() {
        throw new DOMException("BroadcastChannel unavailable", "SecurityError");
      }
    }
    vi.stubGlobal("BroadcastChannel", ThrowingBroadcastChannel);

    await renderMain();

    expect(container.textContent).toContain("Comanda atual");
    expect(localStorage.getItem("pdv_cliente_mirror_v1")).not.toBeNull();
  });

  it("still broadcasts when localStorage persistence throws", async () => {
    const { postMessageMock } = installBroadcastChannel();
    const nativeSetItem = Storage.prototype.setItem;

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (this === window.localStorage && key === "pdv_cliente_mirror_v1") {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
      return nativeSetItem.call(this, key, value);
    });

    await renderMain();

    expect(container.textContent).toContain("Comanda atual");
    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "update",
        payload: expect.objectContaining({
          storeName: operador.org_name,
          forma: "dinheiro",
        }),
      }),
    );
  });
});


describe("PDV PIX request invalidation", () => {
  let root: Root;
  let container: HTMLDivElement;

  const openCaixaId = "33333333-3333-3333-3333-333333333333";
  const product = {
    id: "99999999-9999-4999-8999-999999999999",
    name: "Produto PIX",
    price: 10,
    codigo_barras: "PIX1000",
    available: null,
    image: "",
  };

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem(PDV_SESSION_KEY, JSON.stringify(savedSession));
    functionsInvokeMock.mockResolvedValue({ data: { ok: true }, error: null });

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (container.isConnected) {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  async function renderMain() {
    await act(async () => {
      renderPdv(root);
      await flushAsync();
    });
  }

  function button(label: string) {
    const candidate = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === label,
    );
    if (!candidate) throw new Error(`${label} button not rendered`);
    return candidate;
  }

  function productButton() {
    const candidate = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.includes(product.name),
    );
    if (!candidate) throw new Error(`${product.name} button not rendered`);
    return candidate;
  }

  async function clickProduct() {
    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });
  }

  async function choosePayment(label: string) {
    await act(async () => {
      button(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });
  }

  async function advancePixTimers(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
      await flushAsync();
    });
  }

  async function applyPixCoupon(code: string) {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Código do cupom"]',
    );
    if (!input) throw new Error("Coupon input not rendered");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("HTML input setter unavailable");

    await act(async () => {
      setter.call(input, code);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsync();
    });

    await act(async () => {
      button("Aplicar").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });
  }

  it("invalidates an in-flight PIX intent when the operator leaves PIX mode", async () => {
    const pendingIntent = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") return pendingIntent.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(rpcMock).toHaveBeenCalledWith("pdv_create_pix_intent_v2", {
      _session_token: savedSession.sessionToken,
      _caixa_id: openCaixaId,
      _items: [{ product_id: product.id, quantity: 1 }],
      _cupom_code: "",
    });

    await act(async () => {
      button("Dinheiro").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    pendingIntent.resolve({
      data: {
        ok: true,
        intent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        amount: 10,
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it("invalidates an in-flight PIX intent when the cart becomes empty", async () => {
    const pendingIntent = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") return pendingIntent.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    const minusButton = container.querySelector("svg.lucide-minus")?.closest("button");
    expect(minusButton).toBeTruthy();

    await act(async () => {
      minusButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    pendingIntent.resolve({
      data: {
        ok: true,
        intent_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        amount: 10,
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it("stops an in-flight PIX request chain after unmount", async () => {
    const pendingIntent = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") return pendingIntent.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pendingIntent.resolve({
      data: {
        ok: true,
        intent_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        amount: 10,
      },
      error: null,
    });
    await flushAsync();

    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it("clears a previously generated PIX immediately when the cart changes", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            intent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            amount: 10,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: true,
        intent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        payment_id: 700000001,
        status: "pending",
        amount: 10,
        qr_code_base64: "qr-base64-1",
        qr_code: "pix-code-1",
        ticket_url: "",
      },
      error: null,
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(
      JSON.parse(localStorage.getItem("pdv_cliente_mirror_v1") || "{}").pixCopiaECola,
    ).toBe("pix-code-1");

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(
      JSON.parse(localStorage.getItem("pdv_cliente_mirror_v1") || "{}").pixCopiaECola,
    ).toBe("");
  });

  it("does not start a second PIX intent only because the returned amount differs from the local total", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            intent_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            amount: 10.01,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: true,
        intent_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        payment_id: 700000002,
        status: "pending",
        amount: 10.01,
        qr_code_base64: "qr-base64-loop",
        qr_code: "pix-code-loop",
        ticket_url: "",
      },
      error: null,
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);
    await advancePixTimers(350);

    const pixIntentCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_create_pix_intent_v2",
    );
    expect(pixIntentCalls).toHaveLength(1);
  });

  it("debounces rapid cart changes and sends only the latest PIX quantity", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();

    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(200);
    await clickProduct();
    await advancePixTimers(200);
    await clickProduct();
    await advancePixTimers(349);

    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_create_pix_intent_v2"),
    ).toHaveLength(0);

    await advancePixTimers(1);

    expect(rpcMock).toHaveBeenCalledWith("pdv_create_pix_intent_v2", {
      _session_token: savedSession.sessionToken,
      _caixa_id: openCaixaId,
      _items: [{ product_id: product.id, quantity: 3 }],
      _cupom_code: "",
    });
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_create_pix_intent_v2"),
    ).toHaveLength(1);
  });


  it("invalidates an in-flight PIX intent when quantity changes and starts the replacement with the latest quantity", async () => {
    const firstIntent = deferred<{ data: unknown; error: null }>();
    let pixIntentCall = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        pixIntentCall += 1;
        if (pixIntentCall === 1) return firstIntent.promise;
        return Promise.resolve({ data: { ok: false }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await clickProduct();

    firstIntent.resolve({
      data: {
        ok: true,
        intent_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        amount: 10,
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(functionsInvokeMock).not.toHaveBeenCalled();

    await advancePixTimers(350);

    const pixCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_create_pix_intent_v2",
    );
    expect(pixCalls).toHaveLength(2);
    expect(pixCalls[1]).toEqual([
      "pdv_create_pix_intent_v2",
      {
        _session_token: savedSession.sessionToken,
        _caixa_id: openCaixaId,
        _items: [{ product_id: product.id, quantity: 2 }],
        _cupom_code: "",
      },
    ]);
  });

  it("invalidates an in-flight PIX intent when the validated coupon changes and sends the coupon in the replacement request", async () => {
    const firstIntent = deferred<{ data: unknown; error: null }>();
    let pixIntentCall = 0;
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "SAVE10",
              tipo: "percent",
              valor: 10,
              minimo_pedido: 0,
            },
          },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        pixIntentCall += 1;
        if (pixIntentCall === 1) return firstIntent.promise;
        return Promise.resolve({ data: { ok: false }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await applyPixCoupon("save10");

    firstIntent.resolve({
      data: {
        ok: true,
        intent_id: "abababab-abab-4bab-8bab-abababababab",
        amount: 10,
      },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(functionsInvokeMock).not.toHaveBeenCalled();

    await advancePixTimers(350);

    const pixCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_create_pix_intent_v2",
    );
    expect(pixCalls).toHaveLength(2);
    expect(pixCalls[1]).toEqual([
      "pdv_create_pix_intent_v2",
      {
        _session_token: savedSession.sessionToken,
        _caixa_id: openCaixaId,
        _items: [{ product_id: product.id, quantity: 1 }],
        _cupom_code: "SAVE10",
      },
    ]);
  });


  it.each([
    ["non-boolean ok", { ok: "true", intent_id: "12121212-1212-1212-1212-121212121212", amount: 10 }],
    ["numeric intent_id", { ok: true, intent_id: 12345, amount: 10 }],
    ["blank intent_id", { ok: true, intent_id: "   ", amount: 10 }],
    ["malformed intent_id", { ok: true, intent_id: "not-a-uuid", amount: 10 }],
    ["missing amount", { ok: true, intent_id: "13131313-1313-1313-1313-131313131313" }],
    ["string amount", { ok: true, intent_id: "14141414-1414-1414-1414-141414141414", amount: "10" }],
    ["zero amount", { ok: true, intent_id: "15151515-1515-1515-1515-151515151515", amount: 0 }],
    ["non-finite amount", { ok: true, intent_id: "16161616-1616-1616-1616-161616161616", amount: Number.POSITIVE_INFINITY }],
  ])("fails closed before Mercado Pago for malformed PIX intent success payload: %s", async (_label, payload) => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({ data: payload, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });

  it("fails closed and reports a generic error when PIX intent RPC returns a transport error", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST000", status: 503, message: "internal transport detail" },
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(functionsInvokeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível iniciar o PIX. Tente novamente.",
    );
  });

  it("contains a rejected PIX intent RPC promise and never reaches Mercado Pago", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.reject({ code: "NETWORK", status: 0, message: "offline detail" });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");

    await expect(advancePixTimers(350)).resolves.toBeUndefined();
    expect(functionsInvokeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível iniciar o PIX. Tente novamente.",
    );
  });

  it("ends the local PDV session when PIX intent returns invalid_session", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: { ok: false, reason: "invalid_session" },
          error: null,
        });
      }
      if (name === "pdv_logout_v2") {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(functionsInvokeMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Sessão expirada. Entre novamente.");
  });

  it.each([
    ["invalid_cash_register", "Caixa inválido ou fechado. Reabra o caixa."],
    ["invalid_sale", "Carrinho inválido para gerar o PIX. Revise os itens."],
    ["invalid_quantity", "Carrinho inválido para gerar o PIX. Revise os itens."],
    ["invalid_product_id", "Carrinho inválido para gerar o PIX. Revise os itens."],
    ["product_not_found", "Produto indisponível para gerar o PIX. Atualize o carrinho."],
    ["insufficient_stock", "Estoque insuficiente para gerar o PIX."],
    ["insufficient_ingredient_stock", "Estoque de ingredientes insuficiente para gerar o PIX."],
    ["invalid_coupon", "Cupom inválido para este pedido."],
    ["coupon_minimum_not_met", "O pedido não atende ao mínimo do cupom."],
    ["invalid_total", "Total inválido para gerar o PIX. Revise o carrinho."],
  ])("fails closed for PIX intent functional reason %s", async (reason, expectedMessage) => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({ data: { ok: false, reason }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(functionsInvokeMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith(expectedMessage);
  });

  it("invokes mercadopago-create-pix exactly once with the validated current intent and session", async () => {
    const intentId = "17171717-1717-1717-1717-171717171717";
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: { ok: true, intent_id: intentId, amount: 10.01 },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(functionsInvokeMock).toHaveBeenCalledTimes(1);
    expect(functionsInvokeMock).toHaveBeenCalledWith("mercadopago-create-pix", {
      body: {
        intent_id: intentId,
        session_token: savedSession.sessionToken,
      },
    });
  });


  it("never sends an older intent_id when a replacement PIX intent wins the race", async () => {
    const firstIntent = deferred<{ data: unknown; error: null }>();
    let pixIntentCall = 0;
    const staleIntentId = "18181818-1818-1818-1818-181818181818";
    const currentIntentId = "19191919-1919-1919-1919-191919191919";

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        pixIntentCall += 1;
        if (pixIntentCall === 1) return firstIntent.promise;
        return Promise.resolve({
          data: { ok: true, intent_id: currentIntentId, amount: 20 },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await clickProduct();
    await advancePixTimers(350);

    expect(functionsInvokeMock).toHaveBeenCalledTimes(1);
    expect(functionsInvokeMock).toHaveBeenLastCalledWith("mercadopago-create-pix", {
      body: {
        intent_id: currentIntentId,
        session_token: savedSession.sessionToken,
      },
    });

    firstIntent.resolve({
      data: { ok: true, intent_id: staleIntentId, amount: 10 },
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(functionsInvokeMock).toHaveBeenCalledTimes(1);
    expect(functionsInvokeMock).not.toHaveBeenCalledWith(
      "mercadopago-create-pix",
      expect.objectContaining({
        body: expect.objectContaining({ intent_id: staleIntentId }),
      }),
    );
  });


  const EDGE_INTENT_ID = "20202020-2020-4020-8020-202020202020";
  const EDGE_OTHER_INTENT_ID = "21212121-2121-4121-8121-212121212121";

  function edgeSuccessPayload(
    intentId = EDGE_INTENT_ID,
    amount = 10,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      ok: true,
      intent_id: intentId,
      payment_id: 700000003,
      status: "pending",
      amount,
      qr_code_base64: "qr-base64-valid",
      qr_code: "pix-code-valid",
      ticket_url: "",
      ...overrides,
    };
  }

  function edgePayloadWithout(
    field: string,
    intentId = EDGE_INTENT_ID,
    amount = 10,
  ): Record<string, unknown> {
    const payload = edgeSuccessPayload(intentId, amount);
    delete payload[field];
    return payload;
  }

  function mockSinglePixIntent(intentId = EDGE_INTENT_ID, amount = 10) {
    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        return Promise.resolve({
          data: { ok: true, intent_id: intentId, amount },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
  }

  function readCustomerMirror() {
    return JSON.parse(localStorage.getItem("pdv_cliente_mirror_v1") || "{}");
  }

  it.each([
    ["non-boolean ok", edgeSuccessPayload(EDGE_INTENT_ID, 10, { ok: "true" })],
    ["missing intent_id", edgePayloadWithout("intent_id")],
    ["blank intent_id", edgeSuccessPayload(EDGE_INTENT_ID, 10, { intent_id: "   " })],
    ["mismatched intent_id", edgeSuccessPayload(EDGE_OTHER_INTENT_ID)],
    ["missing payment_id", edgePayloadWithout("payment_id")],
    ["blank payment_id", edgeSuccessPayload(EDGE_INTENT_ID, 10, { payment_id: "   " })],
    ["missing status", edgePayloadWithout("status")],
    ["blank status", edgeSuccessPayload(EDGE_INTENT_ID, 10, { status: "   " })],
    ["missing amount", edgePayloadWithout("amount")],
    ["string amount", edgeSuccessPayload(EDGE_INTENT_ID, 10, { amount: "10" })],
    ["non-finite amount", edgeSuccessPayload(EDGE_INTENT_ID, 10, { amount: Number.POSITIVE_INFINITY })],
    ["mismatched amount", edgeSuccessPayload(EDGE_INTENT_ID, 10, { amount: 10.01 })],
    ["missing qr_code_base64", edgePayloadWithout("qr_code_base64")],
    ["blank qr_code_base64", edgeSuccessPayload(EDGE_INTENT_ID, 10, { qr_code_base64: "   " })],
    ["numeric qr_code_base64", edgeSuccessPayload(EDGE_INTENT_ID, 10, { qr_code_base64: 123 })],
    ["missing qr_code", edgePayloadWithout("qr_code")],
    ["blank qr_code", edgeSuccessPayload(EDGE_INTENT_ID, 10, { qr_code: "   " })],
    ["numeric qr_code", edgeSuccessPayload(EDGE_INTENT_ID, 10, { qr_code: 123 })],
    ["missing ticket_url", edgePayloadWithout("ticket_url")],
    ["numeric ticket_url", edgeSuccessPayload(EDGE_INTENT_ID, 10, { ticket_url: 123 })],
  ])("fails closed before setPixData for malformed Edge PIX success payload: %s", async (_label, payload) => {
    mockSinglePixIntent();
    functionsInvokeMock.mockResolvedValue({ data: payload, error: null });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível gerar o PIX. Tente novamente.",
    );
  });

  it("accepts the real Edge success contract with an empty optional ticket_url", async () => {
    mockSinglePixIntent();
    functionsInvokeMock.mockResolvedValue({
      data: edgeSuccessPayload(EDGE_INTENT_ID, 10, { ticket_url: "" }),
      error: null,
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-valid",
      pixCopiaECola: "pix-code-valid",
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "Não foi possível gerar o PIX. Tente novamente.",
    );
  });

  it.each([
    ["FunctionsHttpError", 502],
    ["FunctionsFetchError", undefined],
    ["FunctionsRelayError", undefined],
  ])("fails closed and reports a generic error for Edge %s", async (name, status) => {
    mockSinglePixIntent();
    functionsInvokeMock.mockResolvedValue({
      data: null,
      error: { name, status, message: "internal edge detail" },
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível gerar o PIX. Tente novamente.",
    );
  });

  it("contains a rejected Edge invoke promise and fails closed", async () => {
    mockSinglePixIntent();
    functionsInvokeMock.mockRejectedValue(
      Object.assign(new Error("network detail"), { name: "FunctionsFetchError" }),
    );

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");

    await expect(advancePixTimers(350)).resolves.toBeUndefined();
    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível gerar o PIX. Tente novamente.",
    );
  });

  it("never mirrors an old Edge response after quantity changes and a newer Edge request wins", async () => {
    const firstEdge = deferred<{ data: unknown; error: null }>();
    const firstIntentId = "22222222-2222-4222-8222-222222222222";
    const secondIntentId = "23232323-2323-4323-8323-232323232323";
    let intentCall = 0;
    let edgeCall = 0;

    rpcMock.mockImplementation((name: string) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        intentCall += 1;
        return Promise.resolve({
          data: intentCall === 1
            ? { ok: true, intent_id: firstIntentId, amount: 10 }
            : { ok: true, intent_id: secondIntentId, amount: 20 },
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    functionsInvokeMock.mockImplementation(() => {
      edgeCall += 1;
      if (edgeCall === 1) return firstEdge.promise;
      return Promise.resolve({
        data: edgeSuccessPayload(secondIntentId, 20, {
          qr_code_base64: "qr-base64-new",
          qr_code: "pix-code-new",
        }),
        error: null,
      });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await clickProduct();
    await advancePixTimers(350);

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-new",
      pixCopiaECola: "pix-code-new",
    });

    firstEdge.resolve({
      data: edgeSuccessPayload(firstIntentId, 10, {
        qr_code_base64: "qr-base64-old",
        qr_code: "pix-code-old",
      }),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-new",
      pixCopiaECola: "pix-code-new",
    });
  });

  it("ignores an in-flight Edge response after the operator leaves PIX mode", async () => {
    const pendingEdge = deferred<{ data: unknown; error: null }>();
    mockSinglePixIntent();
    functionsInvokeMock.mockReturnValue(pendingEdge.promise);

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await choosePayment("Dinheiro");

    pendingEdge.resolve({
      data: edgeSuccessPayload(),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
  });

  it("ignores an in-flight Edge response after the cart becomes empty", async () => {
    const pendingEdge = deferred<{ data: unknown; error: null }>();
    mockSinglePixIntent();
    functionsInvokeMock.mockReturnValue(pendingEdge.promise);

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    const minusButton = container.querySelector("svg.lucide-minus")?.closest("button");
    expect(minusButton).toBeTruthy();
    await act(async () => {
      minusButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    pendingEdge.resolve({
      data: edgeSuccessPayload(),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
  });

  it("ignores an in-flight Edge response after a validated coupon changes the PIX input", async () => {
    const pendingEdge = deferred<{ data: unknown; error: null }>();
    mockSinglePixIntent();
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "SAVE10",
              tipo: "percent",
              valor: 10,
              minimo_pedido: 0,
            },
          },
          error: null,
        });
      }
      return baseImplementation!(name, ...args);
    });
    functionsInvokeMock.mockReturnValue(pendingEdge.promise);

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await applyPixCoupon("save10");

    pendingEdge.resolve({
      data: edgeSuccessPayload(),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
  });

  it("ignores an in-flight Edge response after unmount", async () => {
    const pendingEdge = deferred<{ data: unknown; error: null }>();
    mockSinglePixIntent();
    functionsInvokeMock.mockReturnValue(pendingEdge.promise);

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pendingEdge.resolve({
      data: edgeSuccessPayload(),
      error: null,
    });
    await flushAsync();

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "",
      pixCopiaECola: "",
    });
  });


  function mockPixPollingResponse(response: () => Promise<{ data: unknown; error: unknown }>) {
    mockSinglePixIntent();
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_pix_status_v2") return response();
      return baseImplementation!(name, ...args);
    });
    functionsInvokeMock.mockResolvedValue({
      data: edgeSuccessPayload(),
      error: null,
    });
  }

  async function generateReadyPix() {
    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);
  }

  it("fails closed when PIX status ok is not a boolean", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: {
          ok: "true",
          intent_id: EDGE_INTENT_ID,
          status: "paid",
          payment_status: "approved",
          paid: true,
          amount: 10,
        },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("never confirms the current PIX from a status payload for another intent", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: {
          ok: true,
          intent_id: EDGE_OTHER_INTENT_ID,
          status: "paid",
          payment_status: "approved",
          paid: true,
          amount: 10,
        },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("does not accept payment_status approved when the canonical PIX status is not paid", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: {
          ok: true,
          intent_id: EDGE_INTENT_ID,
          status: "payment_created",
          payment_status: "approved",
          paid: false,
          amount: 10,
        },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("contains a rejected PIX status promise instead of leaking an unhandled rejection", async () => {
    mockPixPollingResponse(() =>
      Promise.reject(
        Object.assign(new Error("temporary network detail"), {
          code: "NETWORK",
          status: 0,
        }),
      ),
    );

    await generateReadyPix();

    await expect(advancePixTimers(1200)).resolves.toBeUndefined();
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("stops polling when the current PIX reaches the terminal expired status", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: {
          ok: true,
          intent_id: EDGE_INTENT_ID,
          status: "expired",
          payment_status: "cancelled",
          paid_at: null,
          paid: false,
          amount: 10,
        },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    await advancePixTimers(5000);

    const statusCalls = rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_pix_status_v2",
    );
    expect(statusCalls).toHaveLength(1);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });


  function pixStatusSuccess(
    intentId = EDGE_INTENT_ID,
    status:
      | "pending"
      | "payment_created"
      | "paid"
      | "failed"
      | "consumed"
      | "cancelled"
      | "expired" = "pending",
    overrides: Record<string, unknown> = {},
  ) {
    return {
      ok: true,
      intent_id: intentId,
      status,
      payment_status: status === "paid" ? "approved" : "pending",
      paid_at: status === "paid" ? "2026-09-23T12:00:00.000Z" : null,
      amount: 10,
      paid: status === "paid",
      ...overrides,
    };
  }

  it("starts PIX status polling only after the initial 1200ms delay", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({ data: pixStatusSuccess(), error: null }),
    );

    await generateReadyPix();
    await advancePixTimers(1199);

    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(0);

    await advancePixTimers(1);

    expect(rpcMock).toHaveBeenCalledWith("pdv_pix_status_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: EDGE_INTENT_ID,
    });
  });

  it.each(["pending", "payment_created"] as const)(
    "re-schedules polling for valid non-terminal PIX status %s",
    async (status) => {
      mockPixPollingResponse(() =>
        Promise.resolve({ data: pixStatusSuccess(EDGE_INTENT_ID, status), error: null }),
      );

      await generateReadyPix();
      await advancePixTimers(1200);
      expect(
        rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
      ).toHaveLength(1);

      await advancePixTimers(2499);
      expect(
        rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
      ).toHaveLength(1);

      await advancePixTimers(1);
      expect(
        rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
      ).toHaveLength(2);
      expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
    },
  );

  it("confirms only the canonical paid contract and stops polling immediately", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    await advancePixTimers(10000);

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("PIX confirmado");
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
  });

  it("retries a temporary PostgREST transport error without false confirmation", async () => {
    let calls = 0;
    mockPixPollingResponse(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST000",
            status: 503,
            message: "temporary transport detail",
          },
        });
      }
      return Promise.resolve({ data: pixStatusSuccess(), error: null });
    });

    await generateReadyPix();
    await advancePixTimers(1200);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");

    await advancePixTimers(2500);
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(2);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("retries after a rejected PIX status Promise without an unhandled rejection", async () => {
    let calls = 0;
    mockPixPollingResponse(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          Object.assign(new Error("temporary network detail"), {
            code: "NETWORK",
            status: 0,
          }),
        );
      }
      return Promise.resolve({ data: pixStatusSuccess(), error: null });
    });

    await generateReadyPix();
    await expect(advancePixTimers(1200)).resolves.toBeUndefined();
    await advancePixTimers(2500);

    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(2);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("expires the local PDV session and stops polling on invalid_session", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: { ok: false, reason: "invalid_session" },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    await advancePixTimers(5000);

    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith("Sessão expirada. Entre novamente.");
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("stops polling on intent_not_found without confirming another payment", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: { ok: false, reason: "intent_not_found" },
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    await advancePixTimers(5000);

    expect(toastErrorMock).toHaveBeenCalledWith("PIX não encontrado. Gere um novo PIX.");
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it.each([
    ["failed", "Pagamento PIX recusado ou cancelado."],
    ["cancelled", "Pagamento PIX cancelado."],
    ["expired", "PIX expirado."],
    ["consumed", "PIX já foi utilizado."],
  ] as const)("stops polling for terminal PIX status %s", async (status, message) => {
    mockPixPollingResponse(() =>
      Promise.resolve({
        data: pixStatusSuccess(EDGE_INTENT_ID, status, {
          payment_status: status === "failed" ? "rejected" : "cancelled",
        }),
        error: null,
      }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    await advancePixTimers(5000);

    expect(toastErrorMock).toHaveBeenCalledWith(message);
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it.each([
    ["missing intent_id", { ...pixStatusSuccess(), intent_id: undefined }],
    ["wrong intent_id", pixStatusSuccess(EDGE_OTHER_INTENT_ID, "paid")],
    ["unsupported status", { ...pixStatusSuccess(), status: "approved", paid: true }],
    ["paid/status mismatch", { ...pixStatusSuccess(), status: "pending", paid: true }],
    ["string paid", { ...pixStatusSuccess(), paid: "true" }],
    ["missing amount", { ...pixStatusSuccess(), amount: undefined }],
    ["string amount", { ...pixStatusSuccess(), amount: "10" }],
    ["amount mismatch", { ...pixStatusSuccess(), amount: 10.01 }],
    ["numeric payment_status", { ...pixStatusSuccess(), payment_status: 123 }],
    ["numeric paid_at", { ...pixStatusSuccess(), paid_at: 123 }],
  ])("fails closed and re-polls for malformed PIX status payload: %s", async (_label, payload) => {
    mockPixPollingResponse(() =>
      Promise.resolve({ data: payload, error: null }),
    );

    await generateReadyPix();
    await advancePixTimers(1200);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");

    await advancePixTimers(2500);
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(2);
  });

  it("cancels the first polling timer immediately when leaving PIX mode", async () => {
    mockPixPollingResponse(() =>
      Promise.resolve({ data: pixStatusSuccess(EDGE_INTENT_ID, "paid"), error: null }),
    );

    await generateReadyPix();
    await choosePayment("Dinheiro");
    await advancePixTimers(5000);

    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(0);
    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
  });

  it("ignores a paid response from the old intent after a replacement QR becomes current", async () => {
    const oldStatus = deferred<{ data: unknown; error: null }>();
    const firstIntentId = "24242424-2424-4424-8424-242424242424";
    const secondIntentId = "25252525-2525-4525-8525-252525252525";
    let intentCalls = 0;

    rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        intentCalls += 1;
        return Promise.resolve({
          data: intentCalls === 1
            ? { ok: true, intent_id: firstIntentId, amount: 10 }
            : { ok: true, intent_id: secondIntentId, amount: 20 },
          error: null,
        });
      }
      if (name === "pdv_pix_status_v2") {
        if (args?._intent_id === firstIntentId) return oldStatus.promise;
        return Promise.resolve({
          data: pixStatusSuccess(secondIntentId, "paid", { amount: 20 }),
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    let edgeCalls = 0;
    functionsInvokeMock.mockImplementation(() => {
      edgeCalls += 1;
      return Promise.resolve({
        data: edgeCalls === 1
          ? edgeSuccessPayload(firstIntentId, 10)
          : edgeSuccessPayload(secondIntentId, 20),
        error: null,
      });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);
    await advancePixTimers(1200);

    await clickProduct();
    await advancePixTimers(350);

    oldStatus.resolve({
      data: pixStatusSuccess(firstIntentId, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");

    await advancePixTimers(1200);

    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("PIX confirmado");
    expect(rpcMock).toHaveBeenCalledWith("pdv_pix_status_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: secondIntentId,
    });
  });

  it("ignores an in-flight paid status after leaving PIX mode", async () => {
    const pendingStatus = deferred<{ data: unknown; error: null }>();
    mockPixPollingResponse(() => pendingStatus.promise);

    await generateReadyPix();
    await advancePixTimers(1200);
    await choosePayment("Dinheiro");

    pendingStatus.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });
    await advancePixTimers(5000);

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
  });

  it("ignores an in-flight paid status and clears timers after unmount", async () => {
    const pendingStatus = deferred<{ data: unknown; error: null }>();
    mockPixPollingResponse(() => pendingStatus.promise);

    await generateReadyPix();
    await advancePixTimers(1200);

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pendingStatus.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await flushAsync();
    await vi.advanceTimersByTimeAsync(5000);

    expect(toastSuccessMock).not.toHaveBeenCalledWith("PIX confirmado");
    expect(
      rpcMock.mock.calls.filter(([name]) => name === "pdv_pix_status_v2"),
    ).toHaveLength(1);
  });


  function manualPixSaleCalls() {
    return rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_registrar_venda_pix_v2",
    );
  }

  function manualPixStatusCalls() {
    return rpcMock.mock.calls.filter(
      ([name]) => name === "pdv_pix_status_v2",
    );
  }

  function mockManualPixFinalization(
    response: () => Promise<{ data: unknown; error: unknown }>,
  ) {
    mockSinglePixIntent();
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_pix_status_v2") return response();
      if (name === "pdv_registrar_venda_pix_v2") {
        return Promise.resolve({ data: { ok: false }, error: null });
      }
      return baseImplementation!(name, ...args);
    });
    functionsInvokeMock.mockResolvedValue({
      data: edgeSuccessPayload(),
      error: null,
    });
  }

  async function clickManualFinalize() {
    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });
  }

  it("authorizes manual PIX finalization only from the canonical paid status", async () => {
    mockManualPixFinalization(() =>
      Promise.resolve({
        data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixStatusCalls()).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("pdv_pix_status_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: EDGE_INTENT_ID,
    });
    expect(manualPixSaleCalls()).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("pdv_registrar_venda_pix_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: EDGE_INTENT_ID,
    });
  });

  it.each([
    [
      "non-boolean ok",
      { ...pixStatusSuccess(EDGE_INTENT_ID, "paid"), ok: "true" },
    ],
    [
      "wrong intent_id",
      pixStatusSuccess(EDGE_OTHER_INTENT_ID, "paid"),
    ],
    [
      "missing amount",
      { ...pixStatusSuccess(EDGE_INTENT_ID, "paid"), amount: undefined },
    ],
    [
      "mismatched amount",
      { ...pixStatusSuccess(EDGE_INTENT_ID, "paid"), amount: 10.01 },
    ],
    [
      "paid=true with pending status",
      pixStatusSuccess(EDGE_INTENT_ID, "pending", { paid: true }),
    ],
    [
      "paid=false with paid status",
      pixStatusSuccess(EDGE_INTENT_ID, "paid", { paid: false }),
    ],
    [
      "payment_status approved without canonical paid status",
      pixStatusSuccess(EDGE_INTENT_ID, "payment_created", {
        payment_status: "approved",
      }),
    ],
    [
      "unsupported approved status",
      pixStatusSuccess(EDGE_INTENT_ID, "pending", {
        status: "approved",
        paid: false,
      }),
    ],
    [
      "string paid",
      pixStatusSuccess(EDGE_INTENT_ID, "paid", { paid: "true" }),
    ],
  ])("never calls pixSale for malformed/non-canonical manual PIX status: %s", async (_label, payload) => {
    mockManualPixFinalization(() =>
      Promise.resolve({ data: payload, error: null }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Pagamento PIX ainda não confirmado",
    );
  });

  it.each(["pending", "payment_created"] as const)(
    "does not sell while manual PIX confirmation is still %s",
    async (status) => {
      mockManualPixFinalization(() =>
        Promise.resolve({
          data: pixStatusSuccess(EDGE_INTENT_ID, status),
          error: null,
        }),
      );

      await generateReadyPix();
      await clickManualFinalize();

      expect(manualPixSaleCalls()).toHaveLength(0);
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Pagamento PIX ainda não confirmado",
      );
    },
  );

  it.each([
    ["failed", "Pagamento PIX recusado ou cancelado."],
    ["cancelled", "Pagamento PIX cancelado."],
    ["expired", "PIX expirado."],
    ["consumed", "PIX já foi utilizado."],
  ] as const)(
    "blocks manual finalization for terminal PIX status %s",
    async (status, message) => {
      mockManualPixFinalization(() =>
        Promise.resolve({
          data: pixStatusSuccess(EDGE_INTENT_ID, status, {
            payment_status: status === "failed" ? "rejected" : "cancelled",
          }),
          error: null,
        }),
      );

      await generateReadyPix();
      await clickManualFinalize();

      expect(manualPixSaleCalls()).toHaveLength(0);
      expect(toastErrorMock).toHaveBeenCalledWith(message);
    },
  );

  it("contains a rejected manual PIX status Promise and never calls pixSale", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockManualPixFinalization(() =>
      Promise.reject(
        Object.assign(new Error("temporary network detail"), {
          code: "NETWORK",
          status: 0,
        }),
      ),
    );

    await generateReadyPix();
    await clickManualFinalize();
    await flushAsync();

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível confirmar o PIX. Tente novamente.",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[PDV] manual pdv_pix_status_v2 rejected",
      { code: "NETWORK", status: 0 },
    );
  });

  it("fails closed on a manual PIX status transport error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockManualPixFinalization(() =>
      Promise.resolve({
        data: null,
        error: {
          code: "PGRST000",
          status: 503,
          message: "temporary transport detail",
        },
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível confirmar o PIX. Tente novamente.",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[PDV] manual pdv_pix_status_v2 transport error",
      { code: "PGRST000", status: 503 },
    );
  });

  it("expires the session on invalid_session during manual PIX confirmation", async () => {
    mockManualPixFinalization(() =>
      Promise.resolve({
        data: { ok: false, reason: "invalid_session" },
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Sessão expirada. Entre novamente.",
    );
  });

  it("stops manual finalization when the PIX intent no longer exists", async () => {
    mockManualPixFinalization(() =>
      Promise.resolve({
        data: { ok: false, reason: "intent_not_found" },
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "PIX não encontrado. Gere um novo PIX.",
    );
  });

  it("does not authorize an old manual PIX response after cart/total changes", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    mockManualPixFinalization(() => pending.promise);

    await generateReadyPix();

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });
    expect(manualPixStatusCalls()).toHaveLength(1);

    await clickProduct();

    pending.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(manualPixSaleCalls()).toHaveLength(0);
  });

  it("does not authorize an old manual PIX response after leaving PIX mode", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    mockManualPixFinalization(() => pending.promise);

    await generateReadyPix();

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });
    await choosePayment("Dinheiro");

    pending.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(manualPixSaleCalls()).toHaveLength(0);
  });

  it("does not authorize an in-flight manual PIX response after unmount/session end", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    mockManualPixFinalization(() => pending.promise);

    await generateReadyPix();

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pending.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await flushAsync();

    expect(manualPixSaleCalls()).toHaveLength(0);
  });

  it("serializes concurrent Finalizar clicks before manual PIX confirmation", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    mockManualPixFinalization(() => pending.promise);

    await generateReadyPix();

    await act(async () => {
      const finalize = button("Finalizar venda");
      finalize.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      finalize.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
    });

    expect(manualPixStatusCalls()).toHaveLength(1);
    expect(manualPixSaleCalls()).toHaveLength(0);

    pending.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "pending"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });
  });

  it("never authorizes the old intent after a replacement QR becomes current during manual confirmation", async () => {
    const oldIntentId = "26262626-2626-4626-8626-262626262626";
    const newIntentId = "27272727-2727-4727-8727-272727272727";
    const pendingOldStatus = deferred<{ data: unknown; error: null }>();
    let intentCalls = 0;
    let edgeCalls = 0;

    rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        intentCalls += 1;
        return Promise.resolve({
          data:
            intentCalls === 1
              ? { ok: true, intent_id: oldIntentId, amount: 10 }
              : { ok: true, intent_id: newIntentId, amount: 20 },
          error: null,
        });
      }
      if (name === "pdv_pix_status_v2") {
        if (args?._intent_id === oldIntentId) return pendingOldStatus.promise;
        return Promise.resolve({
          data: pixStatusSuccess(newIntentId, "pending", { amount: 20 }),
          error: null,
        });
      }
      if (name === "pdv_registrar_venda_pix_v2") {
        return Promise.resolve({ data: { ok: false }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    functionsInvokeMock.mockImplementation(() => {
      edgeCalls += 1;
      return Promise.resolve({
        data:
          edgeCalls === 1
            ? edgeSuccessPayload(oldIntentId, 10)
            : edgeSuccessPayload(newIntentId, 20),
        error: null,
      });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    await clickProduct();
    await advancePixTimers(350);

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-valid",
      pixCopiaECola: "pix-code-valid",
    });

    pendingOldStatus.resolve({
      data: pixStatusSuccess(oldIntentId, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(manualPixSaleCalls()).toHaveLength(0);
    expect(rpcMock).not.toHaveBeenCalledWith("pdv_registrar_venda_pix_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: oldIntentId,
    });
  });

  it("does not authorize a pre-coupon PIX after the coupon changes while manual confirmation is in flight", async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    mockSinglePixIntent();
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_pix_status_v2") return pending.promise;
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "SAVE10",
              tipo: "percent",
              valor: 10,
              minimo_pedido: 0,
            },
          },
          error: null,
        });
      }
      if (name === "pdv_registrar_venda_pix_v2") {
        return Promise.resolve({ data: { ok: false }, error: null });
      }
      return baseImplementation!(name, ...args);
    });
    functionsInvokeMock.mockResolvedValue({
      data: edgeSuccessPayload(),
      error: null,
    });

    await generateReadyPix();

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });
    await applyPixCoupon("save10");

    pending.resolve({
      data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(manualPixSaleCalls()).toHaveLength(0);
  });


  function pixSaleSuccess(overrides: Record<string, unknown> = {}) {
    return {
      ok: true,
      idempotent: false,
      order_id: "30303030-3030-4030-8030-303030303030",
      order_number: "PDV-PIX-1",
      created_at: "2026-09-23T12:30:00.000Z",
      total: 10,
      items: [
        {
          product_id: product.id,
          name: product.name,
          price: 10,
          quantity: 1,
        },
      ],
      ...overrides,
    };
  }

  function mockPixSaleFinalization(
    response: () => Promise<{ data: unknown; error: unknown }>,
  ) {
    mockSinglePixIntent();
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_pix_status_v2") {
        return Promise.resolve({
          data: pixStatusSuccess(EDGE_INTENT_ID, "paid"),
          error: null,
        });
      }
      if (name === "pdv_registrar_venda_pix_v2") return response();
      return baseImplementation!(name, ...args);
    });
    functionsInvokeMock.mockResolvedValue({
      data: edgeSuccessPayload(),
      error: null,
    });
  }

  it("accepts the canonical idempotent PIX sale response without issuing a second sale call", async () => {
    mockPixSaleFinalization(() =>
      Promise.resolve({
        data: pixSaleSuccess({ idempotent: true }),
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(manualPixSaleCalls()).toHaveLength(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("Venda registrada — R$ 10,00");
  });


  it("commits the completed sale UI state before optional customer-phone persistence finishes", async () => {
    const pendingPhone = deferred<{ data: unknown; error: null }>();
    mockPixSaleFinalization(() =>
      Promise.resolve({
        data: pixSaleSuccess(),
        error: null,
      }),
    );
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_set_order_customer_phone_v2") return pendingPhone.promise;
      return baseImplementation!(name, ...args);
    });

    await renderMain();
    await clickProduct();

    const phoneInput = container.querySelector<HTMLInputElement>(
      'input[placeholder="WhatsApp do cliente (DDD + número)"]',
    );
    if (!phoneInput) throw new Error("Customer phone input not rendered");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("HTML input setter unavailable");

    await act(async () => {
      setter.call(phoneInput, "62999999999");
      phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
      await flushAsync();
    });

    await choosePayment("Pix");
    await advancePixTimers(350);
    await clickManualFinalize();

    expect(
      rpcMock.mock.calls.filter(
        ([name]) => name === "pdv_set_order_customer_phone_v2",
      ),
    ).toHaveLength(1);
    expect(toastSuccessMock).toHaveBeenCalledWith("Venda registrada — R$ 10,00");

    try {
      expect(readCustomerMirror().items).toHaveLength(0);
      expect(readCustomerMirror().forma).toBe("dinheiro");
    } finally {
      pendingPhone.resolve({
        data: {
          ok: true,
          order_id: "30303030-3030-4030-8030-303030303030",
          customer_phone: "62999999999",
        },
        error: null,
      });
      await act(async () => {
        await flushAsync();
      });
    }
  });

  it("contains a rejected pixSale Promise, releases loading and shows only a safe message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPixSaleFinalization(() =>
      Promise.reject(
        Object.assign(new Error("temporary database detail"), {
          code: "PGRST000",
          status: 503,
        }),
      ),
    );

    await generateReadyPix();
    await expect(clickManualFinalize()).resolves.toBeUndefined();

    expect(button("Finalizar venda").hasAttribute("disabled")).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível registrar a venda PIX. Tente novamente.",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith("temporary database detail");
    expect(consoleError).toHaveBeenCalledWith(
      "[PDV] pdv_registrar_venda_pix_v2 rejected",
      { code: "PGRST000", status: 503 },
    );
  });

  it("fails closed on a pixSale PostgREST error without leaking its technical message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPixSaleFinalization(() =>
      Promise.resolve({
        data: null,
        error: {
          code: "PGRST000",
          status: 503,
          message: "database connection detail",
        },
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Não foi possível registrar a venda PIX. Tente novamente.",
    );
    expect(toastErrorMock).not.toHaveBeenCalledWith("database connection detail");
    expect(consoleError).toHaveBeenCalledWith(
      "[PDV] pdv_registrar_venda_pix_v2 transport error",
      { code: "PGRST000", status: 503 },
    );
  });

  it("expires the local session when pixSale returns invalid_session", async () => {
    mockPixSaleFinalization(() =>
      Promise.resolve({
        data: { ok: false, reason: "invalid_session" },
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(sessionStorage.getItem(PDV_SESSION_KEY)).toBeNull();
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Sessão expirada. Entre novamente.",
    );
  });

  it.each([
    ["invalid_pix_intent", "PIX inválido para esta sessão. Gere um novo PIX."],
    ["pix_not_paid", "Pagamento PIX ainda não confirmado"],
    ["invalid_cash_register", "Caixa inválido ou fechado. Reabra o caixa."],
  ] as const)(
    "handles pixSale functional error %s without treating it as a sale",
    async (reason, message) => {
      mockPixSaleFinalization(() =>
        Promise.resolve({
          data: { ok: false, reason },
          error: null,
        }),
      );

      await generateReadyPix();
      await clickManualFinalize();

      expect(toastErrorMock).toHaveBeenCalledWith(message);
      expect(toastSuccessMock).not.toHaveBeenCalledWith(
        expect.stringContaining("Venda registrada"),
      );
      expect(readCustomerMirror().items).toHaveLength(1);
    },
  );

  it.each([
    ["non-boolean ok", { ...pixSaleSuccess(), ok: "true" }],
    ["missing idempotent", { ...pixSaleSuccess(), idempotent: undefined }],
    ["non-boolean idempotent", { ...pixSaleSuccess(), idempotent: "false" }],
    ["missing order_id", { ...pixSaleSuccess(), order_id: undefined }],
    ["invalid order_id", { ...pixSaleSuccess(), order_id: "not-a-uuid" }],
    ["missing order_number", { ...pixSaleSuccess(), order_number: undefined }],
    ["empty order_number", { ...pixSaleSuccess(), order_number: "" }],
    ["missing created_at", { ...pixSaleSuccess(), created_at: undefined }],
    ["missing total", { ...pixSaleSuccess(), total: undefined }],
    ["string total", { ...pixSaleSuccess(), total: "10" }],
    ["non-finite total", { ...pixSaleSuccess(), total: Number.POSITIVE_INFINITY }],
    ["mismatched total", { ...pixSaleSuccess(), total: 11 }],
    ["missing items", { ...pixSaleSuccess(), items: undefined }],
    ["non-array items", { ...pixSaleSuccess(), items: {} }],
    [
      "invalid item product_id",
      {
        ...pixSaleSuccess(),
        items: [
          {
            product_id: "bad-id",
            name: product.name,
            price: 10,
            quantity: 1,
          },
        ],
      },
    ],
    [
      "invalid item quantity",
      {
        ...pixSaleSuccess(),
        items: [
          {
            product_id: product.id,
            name: product.name,
            price: 10,
            quantity: 0,
          },
        ],
      },
    ],
    [
      "invalid item price",
      {
        ...pixSaleSuccess(),
        items: [
          {
            product_id: product.id,
            name: product.name,
            price: Number.NaN,
            quantity: 1,
          },
        ],
      },
    ],
  ])("fails closed on malformed pixSale success payload: %s", async (_label, payload) => {
    mockPixSaleFinalization(() =>
      Promise.resolve({
        data: payload,
        error: null,
      }),
    );

    await generateReadyPix();
    await clickManualFinalize();

    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Resposta inválida ao registrar a venda PIX. Tente novamente.",
    );
    expect(readCustomerMirror().items).toHaveLength(1);
  });

  it("ignores an obsolete pixSale response after cart and total change", async () => {
    const pendingSale = deferred<{ data: unknown; error: null }>();
    mockPixSaleFinalization(() => pendingSale.promise);

    await generateReadyPix();
    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });
    expect(manualPixSaleCalls()).toHaveLength(1);

    await clickProduct();
    expect(readCustomerMirror().items?.[0]?.quantity).toBe(2);

    pendingSale.resolve({ data: pixSaleSuccess(), error: null });
    await act(async () => {
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
    expect(readCustomerMirror().items?.[0]?.quantity).toBe(2);
    expect(readCustomerMirror().forma).toBe("pix");
  });

  it("does not let an old pixSale response clear a replacement QR/intent", async () => {
    const oldIntentId = "31313131-3131-4131-8131-313131313131";
    const newIntentId = "32323232-3232-4232-8232-323232323232";
    const pendingSale = deferred<{ data: unknown; error: null }>();
    let intentCalls = 0;
    let edgeCalls = 0;

    rpcMock.mockImplementation((name: string, args?: Record<string, unknown>) => {
      if (name === "pdv_resume_session_v2") {
        return Promise.resolve({
          data: resumed({ caixa_aberto_id: openCaixaId }),
          error: null,
        });
      }
      if (name === "pdv_catalog_v2") {
        return Promise.resolve({
          data: { ok: true, products: [product] },
          error: null,
        });
      }
      if (name === "pdv_create_pix_intent_v2") {
        intentCalls += 1;
        return Promise.resolve({
          data:
            intentCalls === 1
              ? { ok: true, intent_id: oldIntentId, amount: 10 }
              : { ok: true, intent_id: newIntentId, amount: 20 },
          error: null,
        });
      }
      if (name === "pdv_pix_status_v2") {
        return Promise.resolve({
          data: pixStatusSuccess(
            String(args?._intent_id),
            "paid",
            { amount: args?._intent_id === oldIntentId ? 10 : 20 },
          ),
          error: null,
        });
      }
      if (name === "pdv_registrar_venda_pix_v2") return pendingSale.promise;
      return Promise.resolve({ data: { ok: true }, error: null });
    });

    functionsInvokeMock.mockImplementation(() => {
      edgeCalls += 1;
      return Promise.resolve({
        data:
          edgeCalls === 1
            ? edgeSuccessPayload(oldIntentId, 10)
            : {
                ...edgeSuccessPayload(newIntentId, 20),
                qr_code_base64: "qr-base64-replacement",
                qr_code: "pix-code-replacement",
              },
        error: null,
      });
    });

    await renderMain();
    await clickProduct();
    await choosePayment("Pix");
    await advancePixTimers(350);

    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    expect(rpcMock).toHaveBeenCalledWith("pdv_registrar_venda_pix_v2", {
      _session_token: savedSession.sessionToken,
      _intent_id: oldIntentId,
    });

    await clickProduct();
    await advancePixTimers(350);
    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-replacement",
      pixCopiaECola: "pix-code-replacement",
    });

    pendingSale.resolve({
      data: pixSaleSuccess({
        order_id: "33333333-3333-4333-8333-333333333333",
        total: 10,
      }),
      error: null,
    });
    await act(async () => {
      await flushAsync();
    });

    expect(readCustomerMirror()).toMatchObject({
      pixQrBase64: "qr-base64-replacement",
      pixCopiaECola: "pix-code-replacement",
    });
    expect(readCustomerMirror().items?.[0]?.quantity).toBe(2);
    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
  });

  it("ignores an obsolete pixSale response after leaving PIX mode", async () => {
    const pendingSale = deferred<{ data: unknown; error: null }>();
    mockPixSaleFinalization(() => pendingSale.promise);

    await generateReadyPix();
    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    await choosePayment("Dinheiro");
    pendingSale.resolve({ data: pixSaleSuccess(), error: null });
    await act(async () => {
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
    expect(readCustomerMirror().forma).toBe("dinheiro");
    expect(readCustomerMirror().items).toHaveLength(1);
  });

  it("ignores an in-flight pixSale response after unmount/session end", async () => {
    const pendingSale = deferred<{ data: unknown; error: null }>();
    mockPixSaleFinalization(() => pendingSale.promise);

    await generateReadyPix();
    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    await act(async () => {
      root.unmount();
      container.remove();
    });

    pendingSale.resolve({ data: pixSaleSuccess(), error: null });
    await flushAsync();

    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
  });

  it("ignores an obsolete pixSale response after a coupon changes the PIX input", async () => {
    const pendingSale = deferred<{ data: unknown; error: null }>();
    mockPixSaleFinalization(() => pendingSale.promise);
    const baseImplementation = rpcMock.getMockImplementation();
    rpcMock.mockImplementation((name: string, ...args: unknown[]) => {
      if (name === "pdv_validar_cupom_v2") {
        return Promise.resolve({
          data: {
            ok: true,
            cupom: {
              codigo: "SAVE10",
              tipo: "percent",
              valor: 10,
              minimo_pedido: 0,
            },
          },
          error: null,
        });
      }
      return baseImplementation!(name, ...args);
    });

    await generateReadyPix();
    await act(async () => {
      button("Finalizar venda").dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await flushAsync();
    });

    await applyPixCoupon("save10");
    pendingSale.resolve({ data: pixSaleSuccess(), error: null });
    await act(async () => {
      await flushAsync();
    });

    expect(toastSuccessMock).not.toHaveBeenCalledWith(
      expect.stringContaining("Venda registrada"),
    );
    expect(readCustomerMirror().items).toHaveLength(1);
    expect(readCustomerMirror().forma).toBe("pix");
  });

});
