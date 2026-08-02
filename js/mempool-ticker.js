/**
 * Kompakter Live-Ticker in der Hauptnavigation.
 *
 * Browserbetrieb: Abruf über die in config.js konfigurierte Mempool-API.
 * Android-App: Abruf ausschließlich über die zuvor ausgewählte native Quelle.
 * Vor der Ersteinrichtung lädt die Android-App die Webseite nicht und stellt
 * deshalb auch keine Verbindung zu mempool.space oder einer eigenen Node her.
 */
(() => {
  "use strict";

  const STORAGE_PREFIX = "bitcoin-live-ticker-cache-v2";
  const FIAT_KEY = "bitcoin-live-ticker-fiat-v1";
  const REFRESH_MS = 60_000;
  const SATS_PER_BTC = 100_000_000;
  let refreshTimer = null;
  let nativeRequestPending = false;
  let state = { prices: null, height: null, updatedAt: null, fiat: "USD", error: "" };

  function apiBase() {
    const configured = window.SITE_CONFIG?.mempoolApiBaseUrl;
    return typeof configured === "string" ? configured.replace(/\/$/, "") : "";
  }

  function sourceLabel() {
    return window.SITE_CONFIG?.liveDataSourceLabel || "nicht eingerichtet";
  }

  function sourceId() {
    return window.SITE_CONFIG?.liveDataSourceId || `web:${apiBase()}`;
  }

  function shortHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function storageKey() {
    return `${STORAGE_PREFIX}-${shortHash(sourceId())}`;
  }

  function usesNativeAndroidSource() {
    return window.SITE_CONFIG?.androidNativeLiveData === true
      && window.AndroidApp
      && typeof window.AndroidApp.requestBitcoinLiveData === "function";
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
      const cached = JSON.parse(localStorage.getItem(storageKey()));
      if (!cached || (!cached.prices && !Number.isFinite(Number(cached.height)))) return null;
      return cached;
    } catch (_) {
      return null;
    }
  }

  function saveCache() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify({
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

  function updateSourceDisplay() {
    const sourceElement = document.getElementById("liveSourceLabel");
    const sourceContainer = sourceElement?.closest(".live-source");
    const label = sourceLabel();
    if (sourceElement) sourceElement.textContent = label;
    if (sourceContainer) sourceContainer.title = `Datenquelle: ${label}`;
  }

  function render(status = "ok") {
    const strip = document.getElementById("bitcoinLiveStrip");
    if (!strip) return;

    updateSourceDisplay();

    const priceElement = document.getElementById("liveBitcoinPrice");
    const heightElement = document.getElementById("liveBlockHeight");
    const moscowElement = document.getElementById("liveMoscowTime");
    const updatedElement = document.getElementById("liveUpdated");
    const dot = document.getElementById("bitcoinLiveDot");
    const price = Number(state.prices?.[state.fiat]);

    strip.dataset.status = status;
    dot?.classList.toggle("is-error", status === "error");
    dot?.classList.toggle("is-cached", status === "cached");
    dot?.classList.toggle("is-partial", status === "partial");

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
      if (status === "error") updatedElement.textContent = "nicht erreichbar";
      else if (status === "partial") updatedElement.textContent = "teilweise erreichbar";
      else updatedElement.textContent = "lädt …";
    } else {
      const time = new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(state.updatedAt));
      if (status === "cached") updatedElement.textContent = `Cache ${time}`;
      else if (status === "partial") updatedElement.textContent = `Teilstand ${time}`;
      else if (status === "error") updatedElement.textContent = `Fehler · Stand ${time}`;
      else updatedElement.textContent = `Stand ${time}`;
    }

    if (state.error) updatedElement.title = state.error;
    else updatedElement.removeAttribute("title");

    document.dispatchEvent(new CustomEvent("bitcoin:live-update", {
      detail: {
        prices: state.prices,
        height: state.height,
        updatedAt: state.updatedAt,
        fiat: state.fiat,
        status,
        source: sourceLabel(),
        error: state.error
      }
    }));
  }

  function applyPayload(payload) {
    const prices = payload?.prices;
    const height = Number(payload?.height);
    let changed = false;

    if (Number(prices?.USD) > 0 && Number(prices?.EUR) > 0) {
      state.prices = { ...prices, USD: Number(prices.USD), EUR: Number(prices.EUR) };
      changed = true;
    }
    if (Number.isFinite(height) && height > 0) {
      state.height = height;
      changed = true;
    }

    state.error = typeof payload?.error === "string" ? payload.error : "";
    if (changed) {
      state.updatedAt = Number(payload?.updatedAt) || Date.now();
      saveCache();
    }

    if (payload?.ok) render("ok");
    else if (payload?.partial || changed) render("partial");
    else if (state.updatedAt) render("cached");
    else render("error");
  }

  function receiveNativeData(payload) {
    nativeRequestPending = false;
    applyPayload(payload || {});
  }

  async function fetchFromConfiguredWebApi() {
    const base = apiBase();
    if (!base) {
      state.error = "Keine Datenquelle eingerichtet";
      render(state.updatedAt ? "cached" : "error");
      return;
    }
    try {
      const [pricesResponse, heightResponse] = await Promise.all([
        fetch(`${base}/v1/prices`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" }),
        fetch(`${base}/blocks/tip/height`, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })
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

      applyPayload({ ok: true, prices, height, updatedAt: Date.now() });
    } catch (error) {
      console.warn("Live-Bitcoin-Daten konnten nicht aktualisiert werden:", error);
      state.error = error instanceof Error ? error.message : String(error);
      if (state.updatedAt) render("cached");
      else render("error");
    }
  }

  function fetchLiveData() {
    if (usesNativeAndroidSource()) {
      if (nativeRequestPending) return;
      nativeRequestPending = true;
      if (!state.updatedAt) render("loading");
      try {
        window.AndroidApp.requestBitcoinLiveData();
      } catch (error) {
        nativeRequestPending = false;
        state.error = error instanceof Error ? error.message : String(error);
        render(state.updatedAt ? "cached" : "error");
      }
      return;
    }

    return fetchFromConfiguredWebApi();
  }

  function initialiseTicker() {
    const strip = document.getElementById("bitcoinLiveStrip");
    if (!strip || strip.dataset.tickerInitialised === "true") return;
    strip.dataset.tickerInitialised = "true";
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
        fiat: state.fiat,
        source: sourceLabel(),
        error: state.error
      };
    },
    refresh: fetchLiveData,
    receiveNativeData
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseTicker, { once: true });
  } else {
    initialiseTicker();
  }
  document.addEventListener("includes:loaded", initialiseTicker);
  document.addEventListener("components:loaded", initialiseTicker);
})();
