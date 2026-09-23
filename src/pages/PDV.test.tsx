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
        amount: 10,
        qr_code_base64: "qr-base64-1",
        qr_code: "pix-code-1",
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
        amount: 10.01,
        qr_code_base64: "qr-base64-loop",
        qr_code: "pix-code-loop",
      },
      error: null,
    });

    await renderMain();

    await act(async () => {
      productButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
      button("Pix").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsync();
      await vi.advanceTimersByTimeAsync(350);
      await flushAsync();
      await vi.advanceTimersByTimeAsync(350);
      await flushAsync();
    });

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

});
