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
