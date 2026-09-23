// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

import PDV from "@/pages/PDV";
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
