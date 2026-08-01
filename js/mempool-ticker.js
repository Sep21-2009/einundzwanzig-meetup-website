/**
 * Kompakter Live-Ticker in der Hauptnavigation.
 * Quelle: öffentliche REST-API von mempool.space.
 */
(() => {
  "use strict";

  const STORAGE_KEY = "bitcoin-live-ticker-cache-v1";
  const FIAT_KEY = "bitcoin-live-ticker-fiat-v1";
  const REFRESH_MS = 60_000;
  const SATS_PER_BTC = 100_000_000;
  let refreshTimer = null;
  let state = { prices: null, height: null, updatedAt: null, fiat: "USD" };

  function apiBase() {
    const configured = window.SITE_CONFIG?.mempoolApiBaseUrl || "https://mempool.space/api";
    return configured.replace(/\/$/, "");
  }

  function loadFiat() {
    try {
      const stored = localStorage.getItem(FIAT_KEY);
      return stored === "EUR" ? "EUR" : "USD";
    } catch (_) {
      return "USD";
    }
  }

  function loadCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!cached || !cached.prices || !Number.isFinite(Number(cached.height))) return null;
      return cached;
    } catch (_) {
      return null;
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        prices: state.prices,
        height: state.height,
        updatedAt: state.updatedAt
      }));
    } catch (_) {}
  }

  function priceFormatter(currency) {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    });
  }

  function integerFormatter() {
    return new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
  }

  function render(status = "ok") {
    const strip = document.getElementById("bitcoinLiveStrip");
    if (!strip) return;

    const priceElement = document.getElementById("liveBitcoinPrice");
    const heightElement = document.getElementById("liveBlockHeight");
    const moscowElement = document.getElementById("liveMoscowTime");
    const updatedElement = document.getElementById("liveUpdated");
    const dot = document.getElementById("bitcoinLiveDot");
    const price = Number(state.prices?.[state.fiat]);

    strip.dataset.status = status;
    dot?.classList.toggle("is-error", status === "error");
    dot?.classList.toggle("is-cached", status === "cached");

    if (Number.isFinite(price) && price > 0) {
      priceElement.textContent = priceFormatter(state.fiat).format(price);
      const satsPerUnit = SATS_PER_BTC / price;
      const symbol = state.fiat === "EUR" ? "€" : "$";
      moscowElement.textContent = `${integerFormatter().format(Math.round(satsPerUnit))} sats/${symbol}`;
    } else {
      priceElement.textContent = "–";
      moscowElement.textContent = "–";
    }

    heightElement.textContent = Number.isFinite(Number(state.height))
      ? integerFormatter().format(Number(state.height))
      : "–";

    document.querySelectorAll("[data-live-fiat]").forEach((button) => {
      const active = button.dataset.liveFiat === state.fiat;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (!state.updatedAt) {
      updatedElement.textContent = status === "error" ? "nicht erreichbar" : "lädt …";
    } else {
      const time = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(state.updatedAt));
      updatedElement.textContent = status === "cached" ? `Cache ${time}` : `Stand ${time}`;
    }

    document.dispatchEvent(new CustomEvent("bitcoin:live-update", {
      detail: {
        prices: state.prices,
        height: state.height,
        updatedAt: state.updatedAt,
        fiat: state.fiat,
        status
      }
    }));
  }

  async function fetchLiveData() {
    const base = apiBase();
    try {
      const [pricesResponse, heightResponse] = await Promise.all([
        fetch(`${base}/v1/prices`, { cache: "no-store" }),
        fetch(`${base}/blocks/tip/height`, { cache: "no-store" })
      ]);

      if (!pricesResponse.ok || !heightResponse.ok) {
        throw new Error(`Mempool API: ${pricesResponse.status}/${heightResponse.status}`);
      }

      const [prices, heightText] = await Promise.all([
        pricesResponse.json(),
        heightResponse.text()
      ]);
      const height = Number(heightText.trim());
      if (!(Number(prices?.USD) > 0) || !(Number(prices?.EUR) > 0) || !Number.isFinite(height)) {
        throw new Error("Unerwartete Mempool-Antwort");
      }

      state.prices = prices;
      state.height = height;
      state.updatedAt = Date.now();
      saveCache();
      render("ok");
    } catch (error) {
      console.warn("Live-Bitcoin-Daten konnten nicht aktualisiert werden:", error);
      const cached = loadCache();
      if (cached) {
        state = { ...state, ...cached };
        render("cached");
      } else {
        render("error");
      }
    }
  }

  function initialiseTicker() {
    if (!document.getElementById("bitcoinLiveStrip")) return;
    state.fiat = loadFiat();

    const cached = loadCache();
    if (cached) {
      state = { ...state, ...cached };
      render("cached");
    } else {
      render("loading");
    }

    document.querySelectorAll("[data-live-fiat]").forEach((button) => {
      button.addEventListener("click", () => {
        state.fiat = button.dataset.liveFiat === "EUR" ? "EUR" : "USD";
        try { localStorage.setItem(FIAT_KEY, state.fiat); } catch (_) {}
        render(state.updatedAt ? "ok" : "loading");
      });
    });

    fetchLiveData();
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = window.setInterval(fetchLiveData, REFRESH_MS);
  }

  window.BitcoinLiveTicker = {
    getState() {
      return {
        prices: state.prices ? { ...state.prices } : null,
        height: state.height,
        updatedAt: state.updatedAt,
        fiat: state.fiat
      };
    },
    refresh: fetchLiveData
  };

  document.addEventListener("includes:loaded", initialiseTicker);
})();
