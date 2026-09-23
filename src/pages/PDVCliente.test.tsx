// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PDVCliente from "@/pages/PDVCliente";

const STORAGE_KEY = "pdv_cliente_mirror_v1";

function payload(storeName: string, total: number) {
  return {
    storeName,
    items: [],
    subtotal: total,
    desconto: 0,
    total,
    forma: "dinheiro",
    pixQrBase64: "",
    pixCopiaECola: "",
    pixLoading: false,
  };
}

async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("PDVCliente mirror transport lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    localStorage.clear();

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

  async function renderClient() {
    await act(async () => {
      root.render(<PDVCliente />);
      await flushAsync();
    });
  }

  it("keeps the storage fallback live when BroadcastChannel is unavailable", async () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(payload("Loja Fallback Inicial", 10)),
    );

    await renderClient();
    expect(container.textContent).toContain("Loja Fallback Inicial");

    const next = payload("Loja Fallback Atualizada", 25);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(next),
        }),
      );
      await flushAsync();
    });

    expect(container.textContent).toContain("Loja Fallback Atualizada");
  });

  it("keeps the storage fallback live when BroadcastChannel construction throws", async () => {
    class ThrowingBroadcastChannel {
      constructor() {
        throw new DOMException("BroadcastChannel blocked", "SecurityError");
      }
    }
    vi.stubGlobal("BroadcastChannel", ThrowingBroadcastChannel);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(payload("Loja Bloqueada Inicial", 10)),
    );

    await renderClient();

    const next = payload("Loja Bloqueada Atualizada", 30);
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: STORAGE_KEY,
          newValue: JSON.stringify(next),
        }),
      );
      await flushAsync();
    });

    expect(container.textContent).toContain("Loja Bloqueada Atualizada");
  });

  it("closes the created BroadcastChannel on unmount", async () => {
    const constructorMock = vi.fn();
    const closeMock = vi.fn();

    class FakeBroadcastChannel {
      constructor(name: string) {
        constructorMock(name);
      }

      close = closeMock;
    }

    vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);

    await renderClient();
    expect(constructorMock).toHaveBeenCalledTimes(1);
    expect(constructorMock).toHaveBeenCalledWith("pdv-cliente");

    await act(async () => root.unmount());
    expect(closeMock).toHaveBeenCalledTimes(1);
    container.remove();
  });
});
