(() => {
      "use strict";

      const STORAGE_KEY = "bitcoin-retirement-calculator-v15-monte-carlo-target";
      const PREVIOUS_STORAGE_KEY = "bitcoin-retirement-calculator-v14-currency";
      const OLDER_STORAGE_KEY = "bitcoin-retirement-calculator-v13-btc-sats";
      const LEGACY_STORAGE_KEY = "bitcoin-retirement-calculator-v12-safe-rule-monte-carlo";
      const OLDEST_STORAGE_KEY = "bitcoin-retirement-calculator-v11-retirement-dca";
      const ANCIENT_STORAGE_KEY = "bitcoin-retirement-calculator-v10-manual-bottoms";
      const LIVE_TICKER_CACHE_KEY = "bitcoin-live-ticker-cache-v1";
      const LIVE_TICKER_FIAT_KEY = "bitcoin-live-ticker-fiat-v1";
      const BEAR_BOTTOMS_STORAGE_KEY = "bitcoin-retirement-bear-bottoms-v1";
      const GENESIS_UTC = Date.UTC(2009, 0, 3);
      const DAY_MS = 86_400_000;
      const YEAR_DAYS = 365.2425;

      function todayUtc() {
        const now = new Date();
        return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      }

      function currentMonthValue() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      }

      const defaults = {
        calculationMode: "fixed",
        growthModel: "decay",
        bitcoinPrice: "",
        bitcoinAmount: "",
        bitcoinAmountUnit: "btc",
        calculationCurrency: (() => {
          try { return localStorage.getItem(LIVE_TICKER_FIAT_KEY) === "EUR" ? "EUR" : "USD"; }
          catch (_) { return "USD"; }
        })(),
        bitcoinPriceManual: false,
        annualRate: 21,
        decayStartRate: 35.0,
        decayReduction: 8.8,
        decayFloor: 8,
        powerLawExponent: 5.8451542,
        monthlyWithdrawal: "",
        safeWithdrawalRate: 3,
        inflationRate: 2,
        monthlyDca: "",
        simulationYears: "",
        withdrawalStart: currentMonthValue(),
        monteCarloEnabled: true,
        annualVolatility: 60,
        monteCarloRuns: 1000,
        monteCarloTargetGoal: "survival",
        monteCarloTargetSuccess: 90,
        monteCarloSeed: 21
      };

      const form = document.getElementById("simulationForm");
      const resetButton = document.getElementById("resetButton");
      const applyHistoricalDefaultsButton = document.getElementById("applyHistoricalDefaults");
      const addBearBottomButton = document.getElementById("addBearBottom");
      const resetBearBottomsButton = document.getElementById("resetBearBottoms");
      const bearBottomRowsElement = document.getElementById("bearBottomRows");
      const bearBottomStatusElement = document.getElementById("bearBottomStatus");
      const canvas = document.getElementById("portfolioChart");
      const ctx = canvas.getContext("2d");
      const portfolioChartTooltip = document.getElementById("portfolioChartTooltip");
      let currentPortfolioLayout = null;
      let currentPortfolioHover = null;
      const monteCarloCanvas = document.getElementById("monteCarloChart");
      const monteCarloCtx = monteCarloCanvas ? monteCarloCanvas.getContext("2d") : null;
      const monteCarloTooltip = document.getElementById("monteCarloTooltip");
      let currentChartData = [];
      let currentMonteCarloData = null;
      let currentMonteCarloLayout = null;
      let currentMonteCarloHover = null;
      const annualOverviewToggle = document.getElementById("annualOverviewToggle");
      const annualOverviewContent = document.getElementById("annualOverviewContent");
      const ANNUAL_OVERVIEW_STORAGE_KEY = "bitcoin-fire-annual-overview-open";

      function setAnnualOverviewOpen(isOpen, persist = false) {
        if (!annualOverviewToggle || !annualOverviewContent) return;
        annualOverviewToggle.setAttribute("aria-expanded", String(isOpen));
        annualOverviewToggle.classList.toggle("is-open", isOpen);
        annualOverviewContent.hidden = !isOpen;
        if (persist) {
          try { localStorage.setItem(ANNUAL_OVERVIEW_STORAGE_KEY, isOpen ? "1" : "0"); } catch (_) {}
        }
      }

      if (annualOverviewToggle && annualOverviewContent) {
        let initialOverviewState = true;
        try {
          const savedOverviewState = localStorage.getItem(ANNUAL_OVERVIEW_STORAGE_KEY);
          if (savedOverviewState !== null) initialOverviewState = savedOverviewState === "1";
        } catch (_) {}
        setAnnualOverviewOpen(initialOverviewState);
        annualOverviewToggle.addEventListener("click", () => {
          const isOpen = annualOverviewToggle.getAttribute("aria-expanded") !== "true";
          setAnnualOverviewOpen(isOpen, true);
        });
      }


      const DEFAULT_BEAR_MARKET_BOTTOMS = Object.freeze([
        { label: "2014–2015", date: "2015-01-14", priceUsd: 172 },
        { label: "2018–2019", date: "2018-12-15", priceUsd: 3217 },
        { label: "2022–2023", date: "2022-11-10", priceUsd: 15742 }
      ]);

      let bearMarketBottoms = loadBearMarketBottoms();
      let bearEditorTimer;
      // Die Bodenpreise bleiben intern in USD gespeichert. Im Editor und in der
      // historischen Tabelle werden sie vollständig in der oben gewählten
      // Rechenwährung angezeigt. So bleibt ein Währungswechsel verlustarm und
      // sämtliche CAGR-Verhältnisse bleiben identisch.
      let bearEditorDisplayCurrency = defaults.calculationCurrency;
      let bearEditorUsdToDisplayRatio = defaults.calculationCurrency === "USD" ? 1 : NaN;

      function cloneDefaultBearBottoms() {
        return DEFAULT_BEAR_MARKET_BOTTOMS.map(item => ({ ...item }));
      }

      function dateInputToUtc(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
        if (!match) return NaN;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const dateMs = Date.UTC(year, month - 1, day);
        const check = new Date(dateMs);
        return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day
          ? dateMs
          : NaN;
      }

      function normalizedBearBottoms(items = bearMarketBottoms) {
        return items.map((item, index) => ({
          label: String(item.label || `Boden ${index + 1}`),
          date: String(item.date || ""),
          dateMs: dateInputToUtc(item.date),
          priceUsd: Number(item.priceUsd)
        })).sort((a, b) => a.dateMs - b.dateMs);
      }

      function validateBearBottoms(items = bearMarketBottoms) {
        const normalized = normalizedBearBottoms(items);
        if (normalized.length < 3) return { valid: false, message: "Mindestens drei Bärenmarkt-Böden sind erforderlich.", bottoms: normalized };
        if (normalized.some(item => !Number.isFinite(item.dateMs) || !(item.priceUsd > 0))) {
          const currency = typeof selectedCalculationCurrency === "function" ? selectedCalculationCurrency() : defaults.calculationCurrency;
          return { valid: false, message: `Bitte für jeden Boden ein gültiges Datum und einen Preis größer als 0 ${currency} eintragen.`, bottoms: normalized };
        }
        for (let index = 1; index < normalized.length; index++) {
          if (normalized[index].dateMs === normalized[index - 1].dateMs) {
            return { valid: false, message: "Jeder Boden benötigt ein eigenes Datum.", bottoms: normalized };
          }
        }
        if (normalized.at(-1).dateMs > todayUtc()) {
          return { valid: false, message: "Der neueste Boden darf nicht in der Zukunft liegen.", bottoms: normalized };
        }
        return { valid: true, message: "", bottoms: normalized };
      }

      function loadBearMarketBottoms() {
        try {
          const stored = JSON.parse(localStorage.getItem(BEAR_BOTTOMS_STORAGE_KEY));
          if (!Array.isArray(stored)) return cloneDefaultBearBottoms();
          const validation = validateBearBottoms(stored);
          if (!validation.valid) return cloneDefaultBearBottoms();
          return validation.bottoms.map((item, index) => ({
            label: item.label || `Boden ${index + 1}`,
            date: item.date,
            priceUsd: item.priceUsd
          }));
        } catch (_) {
          return cloneDefaultBearBottoms();
        }
      }

      function saveBearMarketBottoms() {
        try {
          localStorage.setItem(BEAR_BOTTOMS_STORAGE_KEY, JSON.stringify(bearMarketBottoms));
        } catch (_) {
          // Die Seite funktioniert auch ohne lokalen Speicher.
        }
      }

      function cagrBetween(start, end) {
        const years = (end.dateMs - start.dateMs) / DAY_MS / YEAR_DAYS;
        if (!(years > 0) || !(start.priceUsd > 0) || !(end.priceUsd > 0)) return NaN;
        return (Math.pow(end.priceUsd / start.priceUsd, 1 / years) - 1) * 100;
      }

      function cagrObservations(bottoms) {
        const observations = [];
        for (let index = 1; index < bottoms.length; index++) {
          const start = bottoms[index - 1];
          const end = bottoms[index];
          observations.push({ start, end, cagr: cagrBetween(start, end) });
        }
        return observations;
      }

      function bearBottomDecayMetrics(floorRate = 8, dateMs = todayUtc()) {
        const validation = validateBearBottoms();
        if (!validation.valid) return { valid: false, message: validation.message, bottoms: validation.bottoms, observations: [] };

        const bottoms = validation.bottoms;
        const observations = cagrObservations(bottoms);
        if (observations.some(item => !Number.isFinite(item.cagr))) {
          return { valid: false, message: "Mindestens ein CAGR konnte nicht berechnet werden.", bottoms, observations };
        }

        if (observations.some(item => item.cagr <= floorRate + 0.000001)) {
          return { valid: false, message: `Jeder Boden-CAGR muss oberhalb der Untergrenze von ${floorRate.toFixed(1).replace(".", ",")} % liegen. Untergrenze oder Bodendaten bitte prüfen.`, bottoms, observations };
        }
        const usable = observations;

        const originDate = usable[0].end.dateMs;
        const points = usable.map(item => ({
          x: (item.end.dateMs - originDate) / DAY_MS / YEAR_DAYS,
          y: 1 / (item.cagr - floorRate),
          observation: item
        }));
        const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
        const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
        const denominator = points.reduce((sum, point) => sum + Math.pow(point.x - meanX, 2), 0);
        const slope = denominator > 0
          ? points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator
          : NaN;

        if (!(slope > 0)) {
          return { valid: false, message: "Die eingetragenen Boden-CAGRs ergeben keine abnehmende Renditekurve. Bitte Daten oder Untergrenze prüfen.", bottoms, observations };
        }

        // Der Trend nutzt alle CAGR-Beobachtungen. Anschließend wird die Gerade so
        // verschoben, dass sie den neuesten beobachteten CAGR exakt trifft.
        const latestObservation = usable.at(-1);
        const latestX = (latestObservation.end.dateMs - originDate) / DAY_MS / YEAR_DAYS;
        const latestY = 1 / (latestObservation.cagr - floorRate);
        const intercept = latestY - slope * latestX;
        const currentX = (dateMs - originDate) / DAY_MS / YEAR_DAYS;
        const currentDenominator = intercept + slope * currentX;
        const nextYearDenominator = intercept + slope * (currentX + 1);
        if (!(currentDenominator > 0) || !(nextYearDenominator > 0)) {
          return { valid: false, message: "Die Trendkurve ist mit diesen Eingaben mathematisch nicht stabil.", bottoms, observations };
        }

        const currentExcess = 1 / currentDenominator;
        const nextYearExcess = 1 / nextYearDenominator;
        const currentRate = floorRate + currentExcess;
        const initialReduction = (1 - nextYearExcess / currentExcess) * 100;
        const fourYearRate = floorRate + 1 / (intercept + slope * (currentX + 4));

        const predicted = points.map(point => 1 / (intercept + slope * point.x));
        const actual = points.map(point => 1 / point.y);
        const meanActual = actual.reduce((sum, value) => sum + value, 0) / actual.length;
        const ssTot = actual.reduce((sum, value) => sum + Math.pow(value - meanActual, 2), 0);
        const ssRes = actual.reduce((sum, value, index) => sum + Math.pow(value - predicted[index], 2), 0);
        const fitQuality = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 1;

        return {
          valid: true,
          bottoms,
          observations,
          usable,
          floorRate,
          currentRate,
          initialReduction,
          fourYearRate,
          latestCagr: latestObservation.cagr,
          latestBottom: bottoms.at(-1),
          slope,
          intercept,
          fitQuality
        };
      }

      function setBearBottomStatus(message, type = "") {
        bearBottomStatusElement.textContent = message;
        bearBottomStatusElement.classList.toggle("is-error", type === "error");
        bearBottomStatusElement.classList.toggle("is-success", type === "success");
      }

      function renderBearBottomEditor() {
        const currency = selectedCalculationCurrency();
        const ratio = bearBottomCurrencyRatioFromUsd(currency);
        const conversionAvailable = ratio > 0 && Number.isFinite(ratio);
        bearEditorDisplayCurrency = currency;
        bearEditorUsdToDisplayRatio = conversionAvailable ? ratio : NaN;

        bearBottomRowsElement.innerHTML = bearMarketBottoms.map((item, index) => {
          const canonicalPrice = Number(item.priceUsd);
          const displayPrice = item.priceUsd === "" || item.priceUsd === null || item.priceUsd === undefined
            ? ""
            : conversionAvailable && Number.isFinite(canonicalPrice)
              ? formatBearPriceInput(canonicalPrice * ratio)
              : "";
          const pricePlaceholder = conversionAvailable ? "" : "Wechselkurs wird geladen";
          return `
          <div class="bear-bottom-row" data-bear-index="${index}">
            <span class="bear-bottom-index">Boden ${index + 1}</span>
            <label>Datum
              <input type="date" data-bear-field="date" value="${item.date || ""}" aria-label="Datum von Boden ${index + 1}">
            </label>
            <label>Preis in ${currency}
              <input type="number" data-bear-field="priceUsd" value="${displayPrice}" min="0.01" step="0.01" inputmode="decimal" placeholder="${pricePlaceholder}" aria-label="${currency}-Preis von Boden ${index + 1}" ${conversionAvailable ? "" : "disabled"}>
            </label>
            <button class="bear-bottom-remove" type="button" data-remove-bear="${index}" ${bearMarketBottoms.length <= 3 ? "disabled" : ""} aria-label="Boden ${index + 1} entfernen">×</button>
          </div>`;
        }).join("");
        document.getElementById("bottomCountLabel").textContent = `${bearMarketBottoms.length} ${bearMarketBottoms.length === 1 ? "Boden" : "Böden"}`;
      }

      function collectBearBottomsFromEditor() {
        const ratio = bearEditorUsdToDisplayRatio;
        if (!(ratio > 0) || !Number.isFinite(ratio)) return false;

        bearMarketBottoms = [...bearBottomRowsElement.querySelectorAll(".bear-bottom-row")].map((row, index) => {
          const rawPrice = row.querySelector('[data-bear-field="priceUsd"]').value.trim();
          const displayPrice = Number(rawPrice);
          return {
            label: `Boden ${index + 1}`,
            date: row.querySelector('[data-bear-field="date"]').value,
            priceUsd: rawPrice === "" || !Number.isFinite(displayPrice)
              ? ""
              : Number((displayPrice / ratio).toPrecision(15))
          };
        });
        return true;
      }

      function updateHistoricalDisplays(metrics) {
        const historicalStartRate = document.getElementById("historicalStartRate");
        const historicalInitialReduction = document.getElementById("historicalInitialReduction");
        const historicalLatestCagr = document.getElementById("historicalLatestCagr");
        const methodCurrentRate = document.getElementById("methodCurrentRate");
        const methodLatestCagr = document.getElementById("methodLatestCagr");
        const methodBottomRange = document.getElementById("methodBottomRange");
        const heroDecayRate = document.getElementById("heroDecayRate");
        const heroLatestCagr = document.getElementById("heroLatestCagr");
        const explanation = document.getElementById("historicalExplanation");

        if (!metrics.valid) {
          [historicalStartRate, historicalInitialReduction, historicalLatestCagr, methodCurrentRate, methodLatestCagr, heroLatestCagr].forEach(element => {
            if (element) element.textContent = "–";
          });
          if (methodBottomRange) methodBottomRange.textContent = `${metrics.bottoms?.length || 0} Böden`;
          setBearBottomStatus(metrics.message, "error");
          renderHistory(metrics);
          return false;
        }

        const currentRateText = `${metrics.currentRate.toFixed(1).replace(".", ",")} %`;
        const reductionText = `${metrics.initialReduction.toFixed(1).replace(".", ",")} %`;
        const latestCagrText = `${metrics.latestCagr.toFixed(1).replace(".", ",")} %`;
        const years = metrics.bottoms.map(item => new Date(item.dateMs).getUTCFullYear());
        const rangeText = `${years[0]}–${years.at(-1)} · ${metrics.bottoms.length} Böden`;

        if (historicalStartRate) historicalStartRate.textContent = currentRateText;
        if (historicalInitialReduction) historicalInitialReduction.textContent = reductionText;
        if (historicalLatestCagr) historicalLatestCagr.textContent = latestCagrText;
        if (methodCurrentRate) methodCurrentRate.textContent = `${currentRateText} p. a.`;
        if (methodLatestCagr) methodLatestCagr.textContent = `${latestCagrText} p. a.`;
        if (methodBottomRange) methodBottomRange.textContent = rangeText;
        if (heroDecayRate) heroDecayRate.textContent = `${currentRateText} p. a.`;
        if (heroLatestCagr) heroLatestCagr.textContent = `${latestCagrText} p. a.`;
        if (explanation) explanation.textContent = `Aus ${metrics.bottoms.length} Böden entstehen ${metrics.observations.length} Boden-zu-Boden-CAGRs. Der neueste CAGR von ${latestCagrText} wird am letzten Boden verankert. Alle gültigen CAGR-Perioden bestimmen, wie schnell sich der Renditeüberschuss oberhalb von ${metrics.floorRate.toFixed(1).replace(".", ",")} % abflacht.`;

        setBearBottomStatus(`Neu berechnet: ${currentRateText} im ersten Jahr, danach zunächst ${reductionText} Abschwächung.`, "success");
        renderHistory(metrics);
        return true;
      }

      function applyLiveHistoricalDefaultsToPage(options = {}) {
        const floorRate = Number(document.getElementById("decayFloor")?.value) || 8;
        const metrics = bearBottomDecayMetrics(floorRate, todayUtc());
        const valid = updateHistoricalDisplays(metrics);
        if (!valid) return metrics;

        defaults.decayStartRate = Number(metrics.currentRate.toFixed(1));
        defaults.decayReduction = Number(metrics.initialReduction.toFixed(1));
        defaults.decayFloor = floorRate;

        if (options.applyToInputs !== false) {
          document.getElementById("decayStartRate").value = defaults.decayStartRate;
          document.getElementById("decayReduction").value = defaults.decayReduction;
        }
        return metrics;
      }

      function refreshBearBottomModel({ run = false, reorder = false } = {}) {
        if (!collectBearBottomsFromEditor()) {
          setBearBottomStatus(`Die Bodenpreise können erst in ${selectedCalculationCurrency()} bearbeitet werden, sobald der EUR-/USD-Kurs verfügbar ist.`, "error");
          return { valid: false, message: "Währungsumrechnung nicht verfügbar.", bottoms: bearMarketBottoms, observations: [] };
        }
        const validation = validateBearBottoms();
        if (validation.valid) {
          bearMarketBottoms = validation.bottoms.map((item, index) => ({
            label: `Boden ${index + 1}`,
            date: item.date,
            priceUsd: item.priceUsd
          }));
          saveBearMarketBottoms();
          if (reorder) renderBearBottomEditor();
        }
        const metrics = applyLiveHistoricalDefaultsToPage({ applyToInputs: true });
        if (metrics.valid && run) runSimulation();
        return metrics;
      }

      const currencyFormatterCache = new Map();

      function selectedCalculationCurrency() {
        return form.elements.calculationCurrency?.value === "USD" ? "USD" : "EUR";
      }

      function currencyFormatters(currency = selectedCalculationCurrency()) {
        if (!currencyFormatterCache.has(currency)) {
          currencyFormatterCache.set(currency, {
            whole: new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency,
              maximumFractionDigits: 0
            }),
            precise: new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency,
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }),
            compact: new Intl.NumberFormat("de-DE", {
              style: "currency",
              currency,
              notation: "compact",
              maximumFractionDigits: 1
            })
          });
        }
        return currencyFormatterCache.get(currency);
      }

      // Die bestehenden Namen bleiben als dynamische Wrapper erhalten, damit alle
      // Ausgaben automatisch der aktuell gewählten Rechenwährung folgen.
      const euro = { format: value => currencyFormatters().whole.format(value) };
      const euroPrecise = { format: value => currencyFormatters().precise.format(value) };
      const compactEuro = { format: value => currencyFormatters().compact.format(value) };

      const number = new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: 8
      });

      const percent = new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      });

      function readValue(id) {
        return Number(document.getElementById(id).value);
      }

      const SATS_PER_BTC = 100_000_000;
      const bitcoinAmountInput = document.getElementById("bitcoinAmount");
      const bitcoinAmountUnitLabel = document.getElementById("bitcoinAmountUnitLabel");
      const bitcoinAmountExample = document.getElementById("bitcoinAmountExample");
      const bitcoinAmountEquivalent = document.getElementById("bitcoinAmountEquivalent");
      const bitcoinPriceInput = document.getElementById("bitcoinPrice");
      const bitcoinPriceSource = document.getElementById("bitcoinPriceSource");
      const applyLiveBitcoinPriceButton = document.getElementById("applyLiveBitcoinPrice");
      let bitcoinPriceIsManual = false;
      let activeCalculationCurrency = defaults.calculationCurrency;
      let latestLivePrices = null;

      function readLiveTickerCache() {
        try {
          const cached = JSON.parse(localStorage.getItem(LIVE_TICKER_CACHE_KEY));
          if (Number(cached?.prices?.EUR) > 0 && Number(cached?.prices?.USD) > 0) return cached;
        } catch (_) {}
        return null;
      }

      function livePriceFor(currency = selectedCalculationCurrency()) {
        const prices = latestLivePrices || readLiveTickerCache()?.prices;
        const value = Number(prices?.[currency]);
        return value > 0 && Number.isFinite(value) ? value : NaN;
      }

      function currencyRatio(fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) return 1;
        const fromPrice = livePriceFor(fromCurrency);
        const toPrice = livePriceFor(toCurrency);
        return fromPrice > 0 && toPrice > 0 ? toPrice / fromPrice : NaN;
      }

      function bearBottomCurrencyRatioFromUsd(currency = selectedCalculationCurrency()) {
        return currency === "USD" ? 1 : currencyRatio("USD", currency);
      }

      function bearBottomPriceForDisplay(priceUsd, currency = selectedCalculationCurrency()) {
        const canonical = Number(priceUsd);
        const ratio = bearBottomCurrencyRatioFromUsd(currency);
        return Number.isFinite(canonical) && ratio > 0 ? canonical * ratio : NaN;
      }

      function formatBearPriceInput(value) {
        if (!Number.isFinite(value)) return "";
        return Number(value.toFixed(2)).toString();
      }

      function formatInputMoney(value) {
        if (!Number.isFinite(value)) return "";
        return Number(value.toFixed(2)).toString();
      }

      function updateCurrencyUnits() {
        const currency = selectedCalculationCurrency();
        document.querySelectorAll(".currency-unit").forEach(element => {
          element.textContent = currency;
        });
        bitcoinPriceInput.placeholder = currency === "USD"
          ? "Live-Preis in USD wird geladen"
          : "Live-Preis in EUR wird geladen";

        const bearNote = document.getElementById("bearBottomCurrencyNote");
        if (bearNote) bearNote.textContent = `Datum und Schlusskurs in ${currency}. Mindestens drei Böden sind nötig. Beim Währungswechsel werden vorhandene Bodenpreise gemeinsam umgerechnet; die CAGRs bleiben unverändert.`;
        const historyBadge = document.getElementById("historyCurrencyBadge");
        if (historyBadge) historyBadge.textContent = `Bärenmarkt-Böden · Schlusskurse in ${currency}`;
        const startHeading = document.getElementById("historyStartPriceHeading");
        if (startHeading) startHeading.textContent = `Startboden (${currency})`;
        const endHeading = document.getElementById("historyEndPriceHeading");
        if (endHeading) endHeading.textContent = `Endboden (${currency})`;
      }

      function updateLivePriceStatus() {
        const currency = selectedCalculationCurrency();
        const livePrice = livePriceFor(currency);
        applyLiveBitcoinPriceButton.disabled = !(livePrice > 0);
        if (!(livePrice > 0)) {
          bitcoinPriceSource.textContent = bitcoinPriceIsManual
            ? `Manueller Preis in ${currency}; Live-Preis derzeit nicht verfügbar.`
            : "Live-Preis wird geladen …";
          return;
        }
        const formatted = currencyFormatters(currency).whole.format(livePrice);
        bitcoinPriceSource.textContent = bitcoinPriceIsManual
          ? `Manuell angepasst · aktueller Live-Preis: ${formatted}`
          : `Live-Preis aus der Navigation: ${formatted}`;
      }

      function applyLiveBitcoinPrice({ run = false } = {}) {
        const livePrice = livePriceFor();
        if (!(livePrice > 0)) {
          updateLivePriceStatus();
          return false;
        }
        bitcoinPriceInput.value = formatInputMoney(livePrice);
        bitcoinPriceIsManual = false;
        updateLivePriceStatus();
        bitcoinPriceInput.classList.remove("invalid");
        if (run) runSimulation();
        return true;
      }

      function convertMonetaryInputs(fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) return;
        const ratio = currencyRatio(fromCurrency, toCurrency);
        if (!(ratio > 0)) return;

        // Der DCA ist ein bewusst gewählter nominaler Sparbetrag. 500 EUR werden
        // beim Umschalten daher zu 500 USD und nicht zu einem krummen Umrechnungswert.
        // Der frei vorgegebene Entnahmebetrag und ein manueller BTC-Preis werden
        // dagegen wertgleich in die andere Rechenwährung übertragen.
        ["bitcoinPrice", "monthlyWithdrawal"].forEach(id => {
          const input = document.getElementById(id);
          if (!input || input.value.trim() === "") return;
          const value = Number(input.value);
          if (Number.isFinite(value)) input.value = formatInputMoney(value * ratio);
        });
      }

      function setCalculationCurrency(currency, { convert = true, syncNavigation = false, run = false } = {}) {
        const target = currency === "USD" ? "USD" : "EUR";
        const previous = activeCalculationCurrency;
        const previousRadio = form.querySelector(`input[name="calculationCurrency"][value="${previous}"]`);
        const targetRadio = form.querySelector(`input[name="calculationCurrency"][value="${target}"]`);
        const hasConvertibleMoney = ["bitcoinPrice", "monthlyWithdrawal"]
          .some(id => document.getElementById(id)?.value.trim() !== "");
        const hasBearPrices = bearMarketBottoms.some(item => Number(item.priceUsd) > 0);

        if (convert && previous && previous !== target && !collectBearBottomsFromEditor()) {
          if (previousRadio) previousRadio.checked = true;
          bitcoinPriceSource.textContent = "Währungswechsel derzeit nicht möglich: Die Bodenpreise konnten nicht gesichert werden.";
          return false;
        }

        if (convert && previous && previous !== target && hasConvertibleMoney && !(currencyRatio(previous, target) > 0)) {
          if (previousRadio) previousRadio.checked = true;
          bitcoinPriceSource.textContent = `Währungswechsel derzeit nicht möglich: Für die Umrechnung fehlen aktuelle EUR-/USD-Kurse.`;
          return false;
        }

        if (previous !== target && hasBearPrices && !(bearBottomCurrencyRatioFromUsd(target) > 0)) {
          if (previousRadio) previousRadio.checked = true;
          bitcoinPriceSource.textContent = `Währungswechsel derzeit nicht möglich: Für die Bodenpreise fehlt der EUR-/USD-Kurs.`;
          return false;
        }

        if (targetRadio) targetRadio.checked = true;

        if (convert && previous && previous !== target) {
          if (bitcoinPriceIsManual) {
            convertMonetaryInputs(previous, target);
          } else {
            // Nur ein frei vorgegebener Entnahmebetrag wird wertgleich umgerechnet.
            // Der DCA-Zahlenwert bleibt bewusst unverändert; der automatisch gesetzte
            // BTC-Preis kommt direkt aus dem Live-Ticker der Zielwährung.
            const currentPrice = bitcoinPriceInput.value;
            bitcoinPriceInput.value = "";
            convertMonetaryInputs(previous, target);
            bitcoinPriceInput.value = currentPrice;
          }
        }

        activeCalculationCurrency = target;
        updateCurrencyUnits();
        renderBearBottomEditor();
        applyLiveHistoricalDefaultsToPage({ applyToInputs: false });

        if (!bitcoinPriceIsManual) applyLiveBitcoinPrice();
        updateLivePriceStatus();

        try { localStorage.setItem(LIVE_TICKER_FIAT_KEY, target); } catch (_) {}
        if (syncNavigation) {
          const navButton = document.querySelector(`[data-live-fiat="${target}"]`);
          if (navButton && navButton.getAttribute("aria-pressed") !== "true") navButton.click();
        }

        updateHero(getValues());
        updateStartPreview(getValues());
        if (run && bitcoinPriceInput.value.trim() !== "") runSimulation();
        return true;
      }

      function selectedBitcoinAmountUnit() {
        return form.elements.bitcoinAmountUnit?.value === "sats" ? "sats" : "btc";
      }

      function bitcoinAmountInputToBtc() {
        const raw = Number(bitcoinAmountInput.value);
        if (!Number.isFinite(raw)) return NaN;
        return selectedBitcoinAmountUnit() === "sats" ? raw / SATS_PER_BTC : raw;
      }

      function trimDecimal(value, digits = 8) {
        return Number(value.toFixed(digits)).toString();
      }

      function updateBitcoinAmountUnitUi({ convertFrom = null } = {}) {
        const unit = selectedBitcoinAmountUnit();
        const current = bitcoinAmountInput.value.trim();

        if (convertFrom && current !== "" && Number.isFinite(Number(current))) {
          const numeric = Number(current);
          if (convertFrom === "btc" && unit === "sats") {
            bitcoinAmountInput.value = String(Math.round(numeric * SATS_PER_BTC));
          } else if (convertFrom === "sats" && unit === "btc") {
            bitcoinAmountInput.value = trimDecimal(numeric / SATS_PER_BTC);
          }
        }

        if (unit === "sats") {
          bitcoinAmountInput.placeholder = "21000000";
          bitcoinAmountInput.min = "1";
          bitcoinAmountInput.step = "1";
          bitcoinAmountInput.inputMode = "numeric";
          bitcoinAmountUnitLabel.textContent = "Sats";
          bitcoinAmountExample.textContent = "Beispielwert: 21.000.000 Sats entsprechen 0,21 BTC.";
        } else {
          bitcoinAmountInput.placeholder = "0.21";
          bitcoinAmountInput.min = "0.00000001";
          bitcoinAmountInput.step = "0.00000001";
          bitcoinAmountInput.inputMode = "decimal";
          bitcoinAmountUnitLabel.textContent = "BTC";
          bitcoinAmountExample.textContent = "Beispielwert: 0,21 BTC. Alternativ auf Sats wechseln.";
        }

        updateBitcoinAmountEquivalent();
      }

      function updateBitcoinAmountEquivalent() {
        const raw = Number(bitcoinAmountInput.value);
        if (bitcoinAmountInput.value.trim() === "" || !Number.isFinite(raw) || raw < 0) {
          bitcoinAmountEquivalent.hidden = true;
          bitcoinAmountEquivalent.textContent = "";
          return;
        }
        const unit = selectedBitcoinAmountUnit();
        if (unit === "sats") {
          const btc = raw / SATS_PER_BTC;
          bitcoinAmountEquivalent.textContent = `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 8 }).format(raw)} Sats = ${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(btc)} BTC`;
        } else {
          const sats = Math.round(raw * SATS_PER_BTC);
          bitcoinAmountEquivalent.textContent = `${new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 8 }).format(raw)} BTC = ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(sats)} Sats`;
        }
        bitcoinAmountEquivalent.hidden = false;
      }

      function selectedModel() {
        return form.elements.growthModel.value;
      }

      function selectedCalculationMode() {
        return form.elements.calculationMode.value;
      }

      function getValues() {
        return {
          calculationMode: selectedCalculationMode(),
          growthModel: selectedModel(),
          bitcoinPrice: readValue("bitcoinPrice"),
          bitcoinAmount: bitcoinAmountInputToBtc(),
          bitcoinAmountUnit: selectedBitcoinAmountUnit(),
          calculationCurrency: selectedCalculationCurrency(),
          bitcoinPriceManual: bitcoinPriceIsManual,
          annualRate: readValue("annualRate"),
          decayStartRate: readValue("decayStartRate"),
          decayReduction: readValue("decayReduction"),
          decayFloor: readValue("decayFloor"),
          powerLawExponent: readValue("powerLawExponent"),
          monthlyWithdrawal: readValue("monthlyWithdrawal"),
          safeWithdrawalRate: readValue("safeWithdrawalRate"),
          inflationRate: readValue("inflationRate"),
          monthlyDca: readValue("monthlyDca"),
          simulationYears: Math.trunc(readValue("simulationYears")),
          withdrawalStart: document.getElementById("withdrawalStart").value,
          monteCarloEnabled: document.getElementById("monteCarloEnabled").checked,
          annualVolatility: readValue("annualVolatility"),
          monteCarloRuns: Math.trunc(readValue("monteCarloRuns")),
          monteCarloTargetGoal: form.elements.monteCarloTargetGoal?.value === "preserveEnd" ? "preserveEnd" : "survival",
          monteCarloTargetSuccess: readValue("monteCarloTargetSuccess"),
          monteCarloSeed: Math.trunc(readValue("monteCarloSeed"))
        };
      }

      function setInvalid(id, invalid) {
        document.getElementById(id).classList.toggle("invalid", invalid);
        return !invalid;
      }

      function validate(values) {
        const commonRules = {
          bitcoinPrice: values.bitcoinPrice > 0,
          bitcoinAmount: values.bitcoinAmount > 0,
          monthlyDca: values.monthlyDca >= 0,
          simulationYears: values.simulationYears >= 1 && values.simulationYears <= 100
        };

        if (values.calculationMode === "fixed") {
          commonRules.monthlyWithdrawal = values.monthlyWithdrawal >= 0;
        } else {
          document.getElementById("monthlyWithdrawal").classList.remove("invalid");
        }

        if (values.calculationMode === "safeRule") {
          commonRules.safeWithdrawalRate = values.safeWithdrawalRate > 0 && values.safeWithdrawalRate <= 20;
          commonRules.inflationRate = values.inflationRate >= -10 && values.inflationRate <= 50;
        } else {
          document.getElementById("safeWithdrawalRate").classList.remove("invalid");
          document.getElementById("inflationRate").classList.remove("invalid");
        }

        if (values.monteCarloEnabled) {
          commonRules.annualVolatility = values.annualVolatility >= 0 && values.annualVolatility <= 300;
          commonRules.monteCarloRuns = values.monteCarloRuns >= 100 && values.monteCarloRuns <= 5000;
          commonRules.monteCarloTargetSuccess = values.monteCarloTargetSuccess >= 50 && values.monteCarloTargetSuccess <= 99.9;
          commonRules.monteCarloSeed = values.monteCarloSeed >= 1 && values.monteCarloSeed <= 2147483646;
        } else {
          ["annualVolatility", "monteCarloRuns", "monteCarloTargetSuccess", "monteCarloSeed"].forEach(id => document.getElementById(id).classList.remove("invalid"));
        }

        let valid = true;
        Object.entries(commonRules).forEach(([id, passes]) => {
          if (!setInvalid(id, !passes)) valid = false;
        });

        ["annualRate", "decayStartRate", "decayReduction", "decayFloor", "powerLawExponent"].forEach(id => {
          document.getElementById(id).classList.remove("invalid");
        });

        if (values.growthModel === "constant") {
          if (!setInvalid("annualRate", !(values.annualRate > -100 && values.annualRate <= 1000))) valid = false;
        }

        if (values.growthModel === "decay") {
          if (!setInvalid("decayStartRate", !(values.decayStartRate >= 0 && values.decayStartRate <= 1000))) valid = false;
          if (!setInvalid("decayReduction", !(values.decayReduction >= 0 && values.decayReduction <= 100))) valid = false;
          if (!setInvalid("decayFloor", !(values.decayFloor >= 0 && values.decayFloor <= values.decayStartRate))) valid = false;
        }

        if (values.growthModel === "powerLaw") {
          if (!setInvalid("powerLawExponent", !(values.powerLawExponent > 0 && values.powerLawExponent <= 20))) valid = false;
        }

        const parsedStart = parseWithdrawalStart(values.withdrawalStart);
        const currentMonthStart = (() => {
          const now = new Date();
          return Date.UTC(now.getFullYear(), now.getMonth(), 1);
        })();
        if (!setInvalid("withdrawalStart", !(Number.isFinite(parsedStart) && parsedStart >= currentMonthStart))) valid = false;

        return valid;
      }

      function modelName(model) {
        return {
          constant: "Konstante Rendite",
          decay: "Abnehmende Rendite",
          powerLaw: "Power Law"
        }[model] || "Kursmodell";
      }

      function annualRateForYear(values, yearIndex) {
        if (values.growthModel === "constant") return values.annualRate;
        if (values.growthModel === "decay") {
          const initialReduction = Math.min(0.99, Math.max(0.001, values.decayReduction / 100));
          const shapeYears = (1 - initialReduction) / initialReduction;
          const excessAboveFloor = Math.max(0, values.decayStartRate - values.decayFloor);
          const factor = shapeYears / (shapeYears + Math.max(0, yearIndex));
          return values.decayFloor + excessAboveFloor * factor;
        }
        return null;
      }

      function parseWithdrawalStart(value) {
        const match = /^(\d{4})-(\d{2})$/.exec(value || "");
        if (!match) return NaN;
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (month < 1 || month > 12) return NaN;
        const selectedMonth = Date.UTC(year, month - 1, 1);
        const now = new Date();
        const currentMonth = Date.UTC(now.getFullYear(), now.getMonth(), 1);
        return selectedMonth === currentMonth ? todayUtc() : selectedMonth;
      }

      function addUtcMonthsClamped(dateMs, months) {
        const date = new Date(dateMs);
        const originalDay = date.getUTCDate();
        const firstOfTarget = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
        const year = firstOfTarget.getUTCFullYear();
        const month = firstOfTarget.getUTCMonth();
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        return Date.UTC(year, month, Math.min(originalDay, lastDay));
      }

      function formatDate(dateMs) {
        return new Intl.DateTimeFormat("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "UTC"
        }).format(new Date(dateMs));
      }

      function priceAtDate(values, targetDateMs) {
        const anchorDate = todayUtc();
        if (targetDateMs <= anchorDate) return values.bitcoinPrice;

        if (values.growthModel === "powerLaw") {
          const anchorAgeDays = Math.max(1, (anchorDate - GENESIS_UTC) / DAY_MS);
          const targetAgeDays = Math.max(1, (targetDateMs - GENESIS_UTC) / DAY_MS);
          return values.bitcoinPrice * Math.pow(targetAgeDays / anchorAgeDays, values.powerLawExponent);
        }

        const elapsedYears = (targetDateMs - anchorDate) / DAY_MS / YEAR_DAYS;
        if (values.growthModel === "constant") {
          return values.bitcoinPrice * Math.pow(1 + values.annualRate / 100, elapsedYears);
        }

        const fullYears = Math.floor(elapsedYears);
        const partialYear = elapsedYears - fullYears;
        let multiplier = 1;
        for (let yearIndex = 0; yearIndex < fullYears; yearIndex++) {
          multiplier *= 1 + annualRateForYear(values, yearIndex) / 100;
        }
        multiplier *= Math.pow(1 + annualRateForYear(values, fullYears) / 100, partialYear);
        return values.bitcoinPrice * multiplier;
      }

      function accumulationAtRetirementStart(values, startDate) {
        const anchorDate = todayUtc();
        const startPrice = priceAtDate(values, startDate);
        let startBitcoinAmount = values.bitcoinAmount;
        let dcaBitcoin = 0;
        let dcaContributed = 0;
        let dcaPurchases = 0;
        const monthlyDca = Math.max(0, Number(values.monthlyDca) || 0);
        const monthly = [];

        // Die Ansparphase wird monatsgenau protokolliert. Jeder DCA-Kauf nutzt
        // den Modellpreis seines tatsächlichen Kaufmonats. Der letzte Kauf liegt
        // strikt vor dem ersten Entnahmetag.
        if (startDate > anchorDate) {
          for (let monthIndex = 0; monthIndex < 2400; monthIndex++) {
            const purchaseDate = addUtcMonthsClamped(anchorDate, monthIndex);
            if (purchaseDate >= startDate) break;
            const purchasePrice = priceAtDate(values, purchaseDate);
            if (!(purchasePrice > 0) || !Number.isFinite(purchasePrice)) break;

            const purchasedBitcoin = monthlyDca > 0 ? monthlyDca / purchasePrice : 0;
            if (purchasedBitcoin > 0) {
              startBitcoinAmount += purchasedBitcoin;
              dcaBitcoin += purchasedBitcoin;
              dcaContributed += monthlyDca;
              dcaPurchases += 1;
            }

            monthly.push({
              phase: "accumulation",
              event: purchasedBitcoin > 0 ? "DCA-Kauf" : "Ansparphase",
              dateMs: purchaseDate,
              valuationDateMs: purchaseDate,
              bitcoinPrice: purchasePrice,
              bitcoinAmount: startBitcoinAmount,
              portfolioValue: startBitcoinAmount * purchasePrice,
              dcaEur: purchasedBitcoin > 0 ? monthlyDca : 0,
              purchasedBitcoin,
              withdrawalEur: 0,
              requestedWithdrawalEur: 0
            });
          }
        }

        // Eigener Punkt für den Rentenstart: Er trennt Ansparen und Entnehmen
        // eindeutig und zeigt den vollständigen Stack nach allen DCA-Käufen.
        monthly.push({
          phase: "retirementStart",
          event: "Rentenstart",
          dateMs: startDate,
          valuationDateMs: startDate,
          bitcoinPrice: startPrice,
          bitcoinAmount: startBitcoinAmount,
          portfolioValue: startBitcoinAmount * startPrice,
          dcaEur: 0,
          purchasedBitcoin: 0,
          withdrawalEur: 0,
          requestedWithdrawalEur: 0
        });

        return {
          startDate,
          startPrice,
          startBitcoinAmount,
          startPortfolioValue: startBitcoinAmount * startPrice,
          dcaBitcoin,
          dcaContributed,
          dcaPurchases,
          monthly
        };
      }

      function monthlyWithdrawalForIndex(values, monthIndex, startPortfolioValue, fixedMonthlyWithdrawal) {
        if (values.calculationMode === "safeRule") {
          const initialMonthly = startPortfolioValue * (values.safeWithdrawalRate / 100) / 12;
          const retirementYear = Math.floor(Math.max(0, monthIndex) / 12);
          return initialMonthly * Math.pow(1 + values.inflationRate / 100, retirementYear);
        }
        return Math.max(0, Number(fixedMonthlyWithdrawal) || 0);
      }

      function simulate(values, options = {}) {
        const startDate = Number.isFinite(options.startDate) ? options.startDate : parseWithdrawalStart(values.withdrawalStart);
        const fixedMonthlyWithdrawal = Number.isFinite(options.monthlyWithdrawal) ? options.monthlyWithdrawal : values.monthlyWithdrawal;
        const accumulation = options.accumulation || accumulationAtRetirementStart(values, startDate);
        const startPrice = accumulation.startPrice;
        const totalMonths = values.simulationYears * 12;
        let bitcoinAmount = accumulation.startBitcoinAmount;
        let totalWithdrawn = 0;
        let totalWithdrawnBtc = 0;
        let depletedAt = null;
        let currentYearRow = null;
        let lastRequestedMonthlyWithdrawal = monthlyWithdrawalForIndex(values, 0, accumulation.startPortfolioValue, fixedMonthlyWithdrawal);
        const monthly = [];
        const yearly = [];

        for (let monthIndex = 0; monthIndex < totalMonths; monthIndex++) {
          const withdrawalDate = addUtcMonthsClamped(startDate, monthIndex);
          const nextDate = addUtcMonthsClamped(startDate, monthIndex + 1);
          const year = new Date(withdrawalDate).getUTCFullYear();
          const month = new Date(withdrawalDate).getUTCMonth() + 1;
          const withdrawalPrice = priceAtDate(values, withdrawalDate);
          const requestedMonthlyWithdrawal = monthlyWithdrawalForIndex(values, monthIndex, accumulation.startPortfolioValue, fixedMonthlyWithdrawal);
          lastRequestedMonthlyWithdrawal = requestedMonthlyWithdrawal;
          if (!currentYearRow || currentYearRow.year !== year) {
            if (currentYearRow) yearly.push(currentYearRow);
            currentYearRow = { year, bitcoinPrice: withdrawalPrice, bitcoinAmount, portfolioValue: bitcoinAmount * withdrawalPrice, annualReturn: 0, withdrawnThisYear: 0, yearStartPrice: withdrawalPrice };
          }
          const requestedWithdrawalBtc = requestedMonthlyWithdrawal / withdrawalPrice;
          const withdrawalBtc = Math.min(requestedWithdrawalBtc, bitcoinAmount);
          const actualWithdrawalEur = withdrawalBtc * withdrawalPrice;
          bitcoinAmount -= withdrawalBtc;
          totalWithdrawn += actualWithdrawalEur;
          totalWithdrawnBtc += withdrawalBtc;
          currentYearRow.withdrawnThisYear += actualWithdrawalEur;
          if (bitcoinAmount <= 1e-12 && requestedMonthlyWithdrawal > 0) {
            bitcoinAmount = 0;
            depletedAt = { year, month, dateMs: withdrawalDate };
            monthly.push({ phase: "retirement", event: "Entnahme", year, month, dateMs: withdrawalDate, valuationDateMs: withdrawalDate, bitcoinPrice: withdrawalPrice, bitcoinAmount: 0, portfolioValue: 0, withdrawalBtc, withdrawalEur: actualWithdrawalEur, requestedWithdrawalEur: requestedMonthlyWithdrawal, dcaEur: 0, purchasedBitcoin: 0 });
            currentYearRow.bitcoinPrice = withdrawalPrice;
            currentYearRow.bitcoinAmount = 0;
            currentYearRow.portfolioValue = 0;
            currentYearRow.annualReturn = currentYearRow.yearStartPrice > 0 ? (withdrawalPrice / currentYearRow.yearStartPrice - 1) * 100 : 0;
            break;
          }
          const closingPrice = priceAtDate(values, nextDate);
          const portfolioValue = bitcoinAmount * closingPrice;
          monthly.push({ phase: "retirement", event: "Entnahme", year, month, dateMs: withdrawalDate, valuationDateMs: nextDate, bitcoinPrice: closingPrice, bitcoinAmount, portfolioValue, withdrawalBtc, withdrawalEur: actualWithdrawalEur, requestedWithdrawalEur: requestedMonthlyWithdrawal, dcaEur: 0, purchasedBitcoin: 0 });
          currentYearRow.bitcoinPrice = closingPrice;
          currentYearRow.bitcoinAmount = bitcoinAmount;
          currentYearRow.portfolioValue = portfolioValue;
          currentYearRow.annualReturn = currentYearRow.yearStartPrice > 0 ? (closingPrice / currentYearRow.yearStartPrice - 1) * 100 : 0;
        }
        if (currentYearRow) yearly.push(currentYearRow);
        const last = monthly.at(-1) || { bitcoinPrice: startPrice, bitcoinAmount: accumulation.startBitcoinAmount, portfolioValue: accumulation.startPortfolioValue };
        const initialMonthlyWithdrawal = monthlyWithdrawalForIndex(values, 0, accumulation.startPortfolioValue, fixedMonthlyWithdrawal);
        return { values, monthlyWithdrawal: initialMonthlyWithdrawal, initialMonthlyWithdrawal, finalMonthlyWithdrawal: lastRequestedMonthlyWithdrawal, monthly, yearly, accumulationMonthly: accumulation.monthly || [], depletedAt, totalWithdrawn, totalWithdrawnBtc, startDate, startPrice, startBitcoinAmount: accumulation.startBitcoinAmount, startPortfolioValue: accumulation.startPortfolioValue, dcaBitcoin: accumulation.dcaBitcoin, dcaContributed: accumulation.dcaContributed, dcaPurchases: accumulation.dcaPurchases, finalPrice: last.bitcoinPrice, finalBitcoinAmount: last.bitcoinAmount, finalPortfolioValue: last.portfolioValue };
      }

      function calculatePreservingWithdrawal(values) {
        const startDate = parseWithdrawalStart(values.withdrawalStart);
        const accumulation = accumulationAtRetirementStart(values, startDate);
        const targetPortfolio = accumulation.startPortfolioValue;
        const tolerance = Math.max(0.01, targetPortfolio * 1e-10);

        const preservesCapital = monthlyWithdrawal => {
          const result = simulate(values, { startDate, monthlyWithdrawal, accumulation });
          if (result.depletedAt || result.monthly.length !== values.simulationYears * 12) return false;
          return result.monthly.every(row => row.portfolioValue + tolerance >= targetPortfolio);
        };

        if (!preservesCapital(0)) {
          return {
            monthlyWithdrawal: 0,
            targetPortfolio,
            accumulation,
            result: simulate(values, { startDate, monthlyWithdrawal: 0, accumulation })
          };
        }

        let low = 0;
        let high = Math.max(1, targetPortfolio / 12);
        const hardLimit = Math.max(targetPortfolio * 100, high);

        while (preservesCapital(high) && high < hardLimit) {
          low = high;
          high *= 2;
        }

        high = Math.min(high, hardLimit);
        for (let i = 0; i < 70; i++) {
          const mid = (low + high) / 2;
          if (preservesCapital(mid)) low = mid;
          else high = mid;
        }

        let monthlyWithdrawal = Math.floor(low * 100) / 100;
        while (monthlyWithdrawal > 0 && !preservesCapital(monthlyWithdrawal)) {
          monthlyWithdrawal = Math.max(0, Math.round((monthlyWithdrawal - 0.01) * 100) / 100);
        }

        return {
          monthlyWithdrawal,
          targetPortfolio,
          accumulation,
          result: simulate(values, { startDate, monthlyWithdrawal, accumulation })
        };
      }

      function calculatePreserveComparison(values) {
        return ["constant", "decay", "powerLaw"].reduce((comparison, growthModel) => {
          const modelValues = { ...values, growthModel, calculationMode: "preserve" };
          comparison[growthModel] = calculatePreservingWithdrawal(modelValues);
          return comparison;
        }, {});
      }

      function renderPreserveComparison(comparison, activeModel) {
        const config = {
          constant: ["comparisonConstant", "comparisonConstantSub"],
          decay: ["comparisonDecay", "comparisonDecaySub"],
          powerLaw: ["comparisonPowerLaw", "comparisonPowerLawSub"]
        };

        Object.entries(config).forEach(([model, [valueId, subId]]) => {
          const item = comparison[model];
          document.getElementById(valueId).textContent = `${euroPrecise.format(item.monthlyWithdrawal)} / Monat`;
          document.getElementById(subId).textContent = `Start ${formatDate(item.result.startDate)}: ${euro.format(item.targetPortfolio)} · nach ${item.result.values.simulationYears} Jahren ${euro.format(item.result.finalPortfolioValue)}`;
        });

        document.querySelectorAll("[data-comparison-model]").forEach(card => {
          card.classList.toggle("is-active", card.dataset.comparisonModel === activeModel);
        });
      }

      function seededRandom(seed) {
        let state = (Math.trunc(seed) || 1) >>> 0;
        return () => { state += 0x6D2B79F5; let value = state; value = Math.imul(value ^ value >>> 15, value | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
      }
      function normalGenerator(random) {
        let spare = null;
        return () => { if (spare !== null) { const value = spare; spare = null; return value; } let u=0,v=0; while(u<=Number.EPSILON)u=random(); while(v<=Number.EPSILON)v=random(); const magnitude=Math.sqrt(-2*Math.log(u)); const angle=2*Math.PI*v; spare=magnitude*Math.sin(angle); return magnitude*Math.cos(angle); };
      }
      function quantile(values, probability) {
        if (!values.length) return 0;
        const sorted=[...values].sort((a,b)=>a-b); const position=(sorted.length-1)*probability; const lower=Math.floor(position); const upper=Math.ceil(position);
        return lower===upper ? sorted[lower] : sorted[lower]+(sorted[upper]-sorted[lower])*(position-lower);
      }
      function clampedMoney(value) { if (!Number.isFinite(value)||value<0) return value===Infinity?1e30:0; return Math.min(value,1e30); }
      function buildStochasticSegments(values, dates, annualVolatilityPercent) {
        const annualVolatilityDecimal = Math.max(0, Number(annualVolatilityPercent) || 0) / 100;
        return dates.slice(0, -1).map((fromDate, index) => {
          const toDate = dates[index + 1];
          const baselineFrom = priceAtDate(values, fromDate);
          const baselineTo = priceAtDate(values, toDate);
          const baselineGross = baselineFrom > 0 ? baselineTo / baselineFrom : 1;
          const years = Math.max(0, (toDate - fromDate) / DAY_MS / YEAR_DAYS);
          return {
            baselineLogGross: Math.log(Math.max(1e-12, baselineGross)),
            sigma: annualVolatilityDecimal * Math.sqrt(years)
          };
        });
      }

      function stochasticSegmentGross(segment, normalRandom) {
        // Der ausgewählte Kursverlauf ist der Medianpfad. Die Volatilität verteilt
        // mögliche Renditen symmetrisch auf der logarithmischen Skala darum herum.
        const logGross = segment.baselineLogGross + segment.sigma * normalRandom();
        return Math.max(1e-12, Math.min(Math.exp(logGross), 1e12));
      }

      function buildAccumulationDates(startDate) {
        const anchorDate = todayUtc();
        if (startDate <= anchorDate) return [anchorDate];
        const dates = [anchorDate];
        for (let index = 1; index <= 2400; index++) {
          const candidate = addUtcMonthsClamped(anchorDate, index);
          if (candidate >= startDate) {
            dates.push(startDate);
            break;
          }
          dates.push(candidate);
        }
        if (dates.at(-1) !== startDate) dates.push(startDate);
        return dates;
      }

      function createMonteCarloContext(values) {
        const runs = Math.max(100, Math.min(5000, Math.trunc(values.monteCarloRuns)));
        const retirementMonths = values.simulationYears * 12;
        const startDate = parseWithdrawalStart(values.withdrawalStart);
        const accumulationDates = buildAccumulationDates(startDate);
        const retirementDates = Array.from(
          { length: retirementMonths + 1 },
          (_, index) => addUtcMonthsClamped(startDate, index)
        );
        const annualVolatility = Math.max(0, Number(values.annualVolatility) || 0);
        return {
          runs,
          retirementMonths,
          startDate,
          annualVolatility,
          accumulationDates,
          retirementDates,
          accumulationSegments: buildStochasticSegments(values, accumulationDates, annualVolatility),
          retirementSegments: buildStochasticSegments(values, retirementDates, annualVolatility),
          monthlyDca: Math.max(0, Number(values.monthlyDca) || 0)
        };
      }

      function generateMonteCarloPaths(values, context) {
        const random = seededRandom(values.monteCarloSeed);
        const normalRandom = normalGenerator(random);
        const paths = [];

        for (let runIndex = 0; runIndex < context.runs; runIndex++) {
          let price = values.bitcoinPrice;
          let bitcoinAmount = values.bitcoinAmount;
          const accumulationValues = new Float64Array(context.accumulationDates.length);

          for (let segmentIndex = 0; segmentIndex < context.accumulationSegments.length; segmentIndex++) {
            const segment = context.accumulationSegments[segmentIndex];
            // Der DCA-Kauf erfolgt am Anfang des jeweiligen Monats zum zufälligen
            // Preis dieses Pfades. Danach entwickelt sich der Kurs bis zum nächsten
            // Monatsstichtag weiter.
            if (context.monthlyDca > 0) bitcoinAmount += context.monthlyDca / price;
            accumulationValues[segmentIndex] = clampedMoney(bitcoinAmount * price);
            price *= stochasticSegmentGross(segment, normalRandom);
            price = Math.min(Math.max(price, 1e-9), 1e30);
          }
          accumulationValues[context.accumulationDates.length - 1] = clampedMoney(bitcoinAmount * price);

          const startBitcoinAmount = bitcoinAmount;
          const startPortfolio = clampedMoney(startBitcoinAmount * price);
          const prices = new Float64Array(context.retirementMonths + 1);
          prices[0] = price;

          let inversePriceSum = 0;
          for (let monthIndex = 0; monthIndex < context.retirementMonths; monthIndex++) {
            inversePriceSum += 1 / prices[monthIndex];
            price *= stochasticSegmentGross(context.retirementSegments[monthIndex], normalRandom);
            price = Math.min(Math.max(price, 1e-9), 1e30);
            prices[monthIndex + 1] = price;
          }

          // Ziel 1 – Bestand reicht bis zum Ende:
          // Summe(W / Preis_m) <= Start-BTC  =>  W <= Start-BTC / Summe(1 / Preis_m)
          const fixedMonthlyCapacity = inversePriceSum > 0
            ? startBitcoinAmount / inversePriceSum
            : 0;

          // Ziel 2 – nominales Endkapital mindestens so hoch wie zum Rentenstart:
          // (Start-BTC - W * Summe(1 / Preis_m)) * Endpreis >= Startportfolio.
          // Ist der Endpreis selbst ohne Entnahme niedriger als der Startpreis,
          // kann dieser Pfad das Ziel nicht erfüllen.
          const endPrice = prices[context.retirementMonths];
          const preserveEndPossibleWithoutWithdrawal = endPrice + Math.max(1e-9, prices[0] * 1e-12) >= prices[0];
          const bitcoinNeededAtEnd = endPrice > 0 ? startPortfolio / endPrice : Infinity;
          const withdrawableBitcoinForPreserveEnd = Math.max(0, startBitcoinAmount - bitcoinNeededAtEnd);
          const preserveEndMonthlyCapacity = preserveEndPossibleWithoutWithdrawal && inversePriceSum > 0
            ? withdrawableBitcoinForPreserveEnd / inversePriceSum
            : 0;

          paths.push({
            runIndex,
            startBitcoinAmount,
            startPortfolio,
            accumulationValues,
            prices,
            inversePriceSum,
            endPrice,
            preserveEndPossibleWithoutWithdrawal,
            fixedMonthlyCapacity: Math.max(0, Number.isFinite(fixedMonthlyCapacity) ? fixedMonthlyCapacity : 0),
            preserveEndMonthlyCapacity: Math.max(0, Number.isFinite(preserveEndMonthlyCapacity) ? preserveEndMonthlyCapacity : 0)
          });
        }

        return paths;
      }

      function normalizedMonteCarloTargetGoal(values) {
        return values.monteCarloTargetGoal === "preserveEnd" ? "preserveEnd" : "survival";
      }

      function monteCarloGoalLabel(goal) {
        return goal === "preserveEnd"
          ? "Endkapital mindestens Startkapital"
          : "Bestand reicht bis zum Ende";
      }

      function monteCarloCapacityForGoal(path, goal) {
        return goal === "preserveEnd" ? path.preserveEndMonthlyCapacity : path.fixedMonthlyCapacity;
      }

      function monteCarloPathEligibleAtZero(path, goal) {
        return goal !== "preserveEnd" || path.preserveEndPossibleWithoutWithdrawal;
      }

      function countPathsMeetingMonteCarloGoal(paths, monthlyWithdrawal, goal) {
        const tolerance = 1e-8;
        return paths.reduce((count, path) => {
          if (!monteCarloPathEligibleAtZero(path, goal)) return count;
          return count + (monteCarloCapacityForGoal(path, goal) + tolerance >= monthlyWithdrawal ? 1 : 0);
        }, 0);
      }

      function monteCarloTargetWithdrawal(values, context, paths) {
        const goal = normalizedMonteCarloTargetGoal(values);
        const targetSuccessRate = Math.max(50, Math.min(99.9, Number(values.monteCarloTargetSuccess) || 90));
        const requiredSuccessfulPaths = Math.ceil(context.runs * targetSuccessRate / 100);
        const allLimits = paths.map(path => monteCarloCapacityForGoal(path, goal));
        const eligibleLimits = paths
          .filter(path => monteCarloPathEligibleAtZero(path, goal))
          .map(path => monteCarloCapacityForGoal(path, goal))
          .sort((a, b) => a - b);
        const eligibleWithoutWithdrawalRate = eligibleLimits.length / context.runs * 100;
        const targetAchievable = eligibleLimits.length >= requiredSuccessfulPaths;

        let monthlyWithdrawal = 0;
        if (targetAchievable) {
          const cutoffIndex = Math.max(0, eligibleLimits.length - requiredSuccessfulPaths);
          const rawWithdrawal = eligibleLimits[cutoffIndex] || 0;
          monthlyWithdrawal = Math.max(0, Math.floor(rawWithdrawal * 100) / 100);

          // Rundung auf Cent darf die gewünschte Zielquote niemals unterschreiten.
          while (
            monthlyWithdrawal > 0
            && countPathsMeetingMonteCarloGoal(paths, monthlyWithdrawal, goal) < requiredSuccessfulPaths
          ) {
            monthlyWithdrawal = Math.max(0, Math.round((monthlyWithdrawal - 0.01) * 100) / 100);
          }
        }

        const achievedSuccessRate = countPathsMeetingMonteCarloGoal(paths, monthlyWithdrawal, goal) / context.runs * 100;
        return {
          goal,
          goalLabel: monteCarloGoalLabel(goal),
          monthlyWithdrawal,
          targetSuccessRate,
          achievedSuccessRate,
          targetAchievable,
          eligibleWithoutWithdrawalRate,
          capacityP10: quantile(allLimits, 0.10),
          capacityMedian: quantile(allLimits, 0.50),
          capacityP90: quantile(allLimits, 0.90)
        };
      }

      function monteCarloTimelinePercentiles(paths, context, retirementYearlyValues) {
        const points = [];
        const lastAccumulationIndex = Math.max(0, context.accumulationDates.length - 1);
        const snapshotIndices = [];

        // Die DCA-Käufe werden monatlich simuliert. Für das Diagramm reichen
        // übersichtliche Jahresschnappschüsse plus der exakte Rentenstart.
        for (let index = 0; index < lastAccumulationIndex; index += 12) snapshotIndices.push(index);
        if (!snapshotIndices.includes(lastAccumulationIndex)) snapshotIndices.push(lastAccumulationIndex);

        snapshotIndices.forEach(index => {
          const valuesAtDate = paths.map(path => path.accumulationValues[index]);
          const isRetirementStart = index === lastAccumulationIndex;
          points.push({
            dateMs: context.accumulationDates[index],
            phase: isRetirementStart ? "retirementStart" : "accumulation",
            retirementYear: 0,
            p10: quantile(valuesAtDate, .1),
            p50: quantile(valuesAtDate, .5),
            p90: quantile(valuesAtDate, .9)
          });
        });

        for (let retirementYear = 1; retirementYear <= context.retirementMonths / 12; retirementYear++) {
          const valuesAtYear = retirementYearlyValues[retirementYear] || [];
          points.push({
            dateMs: context.retirementDates[retirementYear * 12],
            phase: "retirement",
            retirementYear,
            p10: quantile(valuesAtYear, .1),
            p50: quantile(valuesAtYear, .5),
            p90: quantile(valuesAtYear, .9)
          });
        }

        return points
          .filter(point => Number.isFinite(point.dateMs))
          .sort((a, b) => a.dateMs - b.dateMs);
      }

      function runMonteCarlo(values, deterministicResult) {
        const context = createMonteCarloContext(values);
        const paths = generateMonteCarloPaths(values, context);
        const recommendation = values.calculationMode === "preserve"
          ? monteCarloTargetWithdrawal(values, context, paths)
          : null;
        const fixedWithdrawal = values.calculationMode === "preserve"
          ? recommendation.monthlyWithdrawal
          : Math.max(0, values.monthlyWithdrawal);

        const yearlyValues = Array.from({ length: values.simulationYears + 1 }, () => []);
        const finalValues = [];
        const startValues = [];
        let successfulRuns = 0;
        let preservedRuns = 0;
        let totalInitialWithdrawal = 0;

        for (const path of paths) {
          let bitcoinAmount = path.startBitcoinAmount;
          const startPortfolio = path.startPortfolio;
          startValues.push(startPortfolio);
          yearlyValues[0].push(startPortfolio);
          const initialWithdrawal = values.calculationMode === "safeRule"
            ? startPortfolio * values.safeWithdrawalRate / 100 / 12
            : fixedWithdrawal;
          totalInitialWithdrawal += initialWithdrawal;

          let survived = true;
          let lastRecordedYear = 0;
          for (let monthIndex = 0; monthIndex < context.retirementMonths; monthIndex++) {
            const requested = values.calculationMode === "safeRule"
              ? initialWithdrawal * Math.pow(1 + values.inflationRate / 100, Math.floor(monthIndex / 12))
              : fixedWithdrawal;
            const withdrawalPrice = path.prices[monthIndex];
            const available = bitcoinAmount * withdrawalPrice;
            if (requested > available + 1e-8) {
              bitcoinAmount = 0;
              survived = false;
              for (let year = lastRecordedYear + 1; year <= values.simulationYears; year++) yearlyValues[year].push(0);
              break;
            }
            bitcoinAmount -= requested / withdrawalPrice;
            if ((monthIndex + 1) % 12 === 0) {
              lastRecordedYear = (monthIndex + 1) / 12;
              yearlyValues[lastRecordedYear].push(clampedMoney(bitcoinAmount * path.prices[monthIndex + 1]));
            }
          }

          const finalValue = survived
            ? clampedMoney(bitcoinAmount * path.prices[context.retirementMonths])
            : 0;
          finalValues.push(finalValue);
          if (survived) successfulRuns++;
          if (survived && finalValue + Math.max(0.01, startPortfolio * 1e-10) >= startPortfolio) preservedRuns++;
        }

        const percentiles = monteCarloTimelinePercentiles(paths, context, yearlyValues);
        const medianStart = quantile(startValues, .5);
        const recommendedAnnualRate = recommendation && medianStart > 0
          ? recommendation.monthlyWithdrawal * 12 / medianStart * 100
          : null;

        return {
          runs: context.runs,
          annualVolatility: context.annualVolatility,
          seed: values.monteCarloSeed,
          startDate: context.startDate,
          successRate: successfulRuns / context.runs * 100,
          preserveRate: preservedRuns / context.runs * 100,
          medianFinal: quantile(finalValues, .5),
          p10Final: quantile(finalValues, .1),
          p90Final: quantile(finalValues, .9),
          medianStart,
          averageInitialWithdrawal: totalInitialWithdrawal / context.runs,
          percentiles,
          recommendedWithdrawal: recommendation?.monthlyWithdrawal ?? null,
          recommendedAnnualRate,
          targetGoal: recommendation?.goal ?? null,
          targetGoalLabel: recommendation?.goalLabel ?? null,
          targetSuccessRate: recommendation?.targetSuccessRate ?? null,
          achievedTargetSuccessRate: recommendation?.achievedSuccessRate ?? null,
          targetAchievable: recommendation?.targetAchievable ?? null,
          eligibleWithoutWithdrawalRate: recommendation?.eligibleWithoutWithdrawalRate ?? null,
          capacityP10: recommendation?.capacityP10 ?? null,
          capacityMedian: recommendation?.capacityMedian ?? null,
          capacityP90: recommendation?.capacityP90 ?? null,
          deterministicWithdrawal: values.calculationMode === "preserve" ? deterministicResult.monthlyWithdrawal : null
        };
      }

      function setAdaptiveMetricText(elementOrId, text) {
        const element = typeof elementOrId === "string" ? document.getElementById(elementOrId) : elementOrId;
        if (!element) return;
        element.textContent = text;
        element.title = text;
        const length = text.replace(/\s/g, "").length;
        element.classList.toggle("metric-number-long", length > 14);
        element.classList.toggle("metric-number-very-long", length > 18);
      }

      function renderMonteCarlo(result, values) {
        currentMonteCarloData = result;
        currentMonteCarloHover = null;
        if (monteCarloTooltip) monteCarloTooltip.hidden = true;
        const panel = document.getElementById("monteCarloPanel");
        panel.hidden = false;

        document.getElementById("mcSuccessRate").textContent = `${percent.format(result.successRate)} %`;
        document.getElementById("mcPreserveRate").textContent = `${percent.format(result.preserveRate)} %`;
        const selectedTargetGoal = result.targetGoal || normalizedMonteCarloTargetGoal(values);
        document.getElementById("mcSuccessMetric")?.classList.toggle("is-target", values.calculationMode === "preserve" && selectedTargetGoal === "survival");
        document.getElementById("mcPreserveMetric")?.classList.toggle("is-target", values.calculationMode === "preserve" && selectedTargetGoal === "preserveEnd");
        setAdaptiveMetricText("mcMedianFinal", euro.format(result.medianFinal));
        setAdaptiveMetricText("mcP10Final", euro.format(result.p10Final));
        document.getElementById("mcSuccessSub").textContent = `${result.runs.toLocaleString("de-DE")} Pfade · ${percent.format(result.annualVolatility)} % Volatilität${result.targetSuccessRate ? ` · Ziel ${percent.format(result.targetSuccessRate)} %` : ""}`;
        setAdaptiveMetricText("mcMedianSub", `90. Perzentil: ${euro.format(result.p90Final)}`);

        const withdrawalBox = document.getElementById("mcWithdrawalResult");
        if (values.calculationMode === "preserve" && Number.isFinite(result.recommendedWithdrawal)) {
          withdrawalBox.hidden = false;
          const targetIsPreserveEnd = result.targetGoal === "preserveEnd";
          document.getElementById("mcWithdrawalLabel").textContent = targetIsPreserveEnd
            ? "Monte-Carlo-Kapitalerhalt-Entnahme"
            : "Monte-Carlo-Überlebensentnahme";
          document.getElementById("mcWithdrawalValue").textContent = `${euroPrecise.format(result.recommendedWithdrawal)} pro Monat`;
          const annualRateText = Number.isFinite(result.recommendedAnnualRate)
            ? ` Das entspricht rund ${percent.format(result.recommendedAnnualRate)} % des medianen Kapitals zum Rentenstart pro Jahr.`
            : "";
          const capacityText = Number.isFinite(result.capacityP10) && Number.isFinite(result.capacityMedian)
            ? ` Kontrollwerte aller Pfade für dieses Ziel: P10 ${euroPrecise.format(result.capacityP10)}, Median ${euroPrecise.format(result.capacityMedian)} tragfähige feste Monatsentnahme.`
            : "";
          const targetText = targetIsPreserveEnd
            ? "nominales Endkapital mindestens auf Höhe des jeweiligen Startkapitals"
            : "BTC-Bestand reicht bis zum Ende";
          const unattainableText = result.targetAchievable === false
            ? ` Die gewünschte Zielquote ist selbst bei 0 Entnahme nicht erreichbar: Ohne Entnahmen erfüllen nur ${percent.format(result.eligibleWithoutWithdrawalRate)} % der Pfade das Ziel.`
            : "";
          document.getElementById("mcWithdrawalNote").textContent = `Ziel: ${targetText} in ${percent.format(result.targetSuccessRate)} % der Pfade; tatsächlich erreicht: ${percent.format(result.achievedTargetSuccessRate)} %. Der glatte, schwankungsfreie Kapitalerhalt-Modus hatte ${euroPrecise.format(result.deterministicWithdrawal)} berechnet.${unattainableText}${annualRateText}${capacityText}`;
        } else {
          withdrawalBox.hidden = true;
        }

        const strategy = values.calculationMode === "safeRule"
          ? `${percent.format(values.safeWithdrawalRate)}-%-Regel mit ${percent.format(values.inflationRate)} % jährlicher Erhöhung`
          : values.calculationMode === "preserve"
            ? `${result.targetGoalLabel || monteCarloGoalLabel(normalizedMonteCarloTargetGoal(values))} · Zielquote ${percent.format(result.targetSuccessRate)} %`
            : `feste Entnahme von ${euroPrecise.format(values.monthlyWithdrawal)} pro Monat`;
        document.getElementById("monteCarloSubtitle").textContent = `${modelName(values.growthModel)} · ${strategy}`;

        const scalingNote = values.calculationMode === "safeRule" || values.calculationMode === "preserve"
          ? "Bei einer proportionalen Strategie verändert ein größerer BTC-Stack den Betrag in der gewählten Rechenwährung, aber nicht automatisch die prozentuale Erfolgsquote. "
          : "";
        const p10Note = result.p10Final <= 0.005
          ? "Das 10. Perzentil liegt bei " + euro.format(0) + ", weil mindestens 10 % der Pfade vorzeitig aufgebraucht wurden. "
          : "";
        const dcaNote = values.monthlyDca > 0 && result.startDate > todayUtc()
          ? `Die Ansparphase enthält monatliche DCA-Käufe von ${euroPrecise.format(values.monthlyDca)} zu den jeweils zufälligen Pfadpreisen. `
          : "";
        const targetExplanation = values.calculationMode === "preserve"
          ? result.targetGoal === "preserveEnd"
            ? `Für die empfohlene Entnahme ist das ausgewählte Ziel: nominales Endkapital mindestens auf Höhe des jeweiligen Kapitals zum Rentenstart in ${percent.format(result.targetSuccessRate)} % der Pfade. `
            : `Für die empfohlene Entnahme ist das ausgewählte Ziel: Der BTC-Bestand reicht in ${percent.format(result.targetSuccessRate)} % der Pfade bis zum Ende. `
          : "";
        document.getElementById("monteCarloNote").textContent = `Seed ${result.seed}. „Rente reicht“ zählt Pfade, in denen alle Entnahmen bedient werden können. „Endwert mindestens Startkapital“ zählt Pfade, deren nominales Endkapital mindestens dem jeweiligen Kapital zum Rentenstart entspricht. ${targetExplanation}Median des Kapitals zum Rentenstart: ${euro.format(result.medianStart)}. ${dcaNote}${values.calculationMode === "safeRule" ? `Durchschnittliche simulierte Startentnahme: ${euroPrecise.format(result.averageInitialWithdrawal)} pro Monat. ` : ""}${scalingNote}${p10Note}Die Verteilung ist eine vereinfachte lognormale Modellannahme und keine belastbare Zukunftswahrscheinlichkeit.`;
        drawMonteCarloChart(result.percentiles);
      }

      function monteCarloThemeColors() {
        const light = document.documentElement.dataset.theme === "light";
        return light
          ? { grid: "rgba(45,39,32,0.10)", muted: "#6f675d", panel: "rgba(247,244,239,0.96)", panelText: "#1e1b18", cross: "rgba(38,34,30,0.48)", axisBox: "#2b2824" }
          : { grid: "rgba(255,255,255,0.075)", muted: "#8f99ab", panel: "rgba(13,15,19,0.94)", panelText: "#f3f4f6", cross: "rgba(222,228,238,0.50)", axisBox: "#111419" };
      }

      function drawRoundedLabel(context, text, x, y, options = {}) {
        const paddingX = options.paddingX ?? 7;
        const height = options.height ?? 23;
        const radius = options.radius ?? 6;
        context.save();
        context.font = options.font || "10px Inter, system-ui, sans-serif";
        const width = context.measureText(text).width + paddingX * 2;
        let left = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
        left = Math.max(2, Math.min(left, (options.canvasWidth || 9999) - width - 2));
        const top = y - height / 2;
        context.beginPath();
        if (context.roundRect) context.roundRect(left, top, width, height, radius);
        else context.rect(left, top, width, height);
        context.fillStyle = options.background || "#111419";
        context.fill();
        context.fillStyle = options.color || "#fff";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, left + width / 2, y + .5);
        context.restore();
        return { left, width };
      }

      function drawMonteCarloChart(data) {
        if (!monteCarloCanvas || !monteCarloCtx || !data?.length) return;
        const rect = monteCarloCanvas.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        monteCarloCanvas.width = Math.round(rect.width * dpr);
        monteCarloCanvas.height = Math.round(rect.height * dpr);
        monteCarloCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;
        const compact = width < 520;
        const padding = compact ? { top: 24, right: 70, bottom: 55, left: 62 } : { top: 28, right: 88, bottom: 58, left: 82 };
        const plotW = Math.max(20, width - padding.left - padding.right);
        const plotH = Math.max(20, height - padding.top - padding.bottom);
        const maxValue = niceMax(Math.max(...data.map(item => item.p90), 1) * 1.05);
        const minDate = data[0].dateMs;
        const maxDate = data.at(-1).dateMs;
        const dateSpan = Math.max(DAY_MS, maxDate - minDate);
        const xDate = dateMs => padding.left + ((dateMs - minDate) / dateSpan) * plotW;
        const x = index => xDate(data[index].dateMs);
        const y = value => padding.top + plotH - Math.min(1, Math.max(0, value / maxValue)) * plotH;
        const colors = monteCarloThemeColors();
        const retirementStartIndex = data.findIndex(item => item.phase === "retirementStart");
        const retirementStartX = retirementStartIndex >= 0 ? x(retirementStartIndex) : padding.left;
        currentMonteCarloLayout = { width, height, padding, plotW, plotH, maxValue, x, xDate, y, data };

        monteCarloCtx.clearRect(0, 0, width, height);
        monteCarloCtx.lineWidth = 1;

        // Die gesamte stochastische Ansparphase einschließlich aller monatlichen
        // DCA-Käufe wird als eigener Bereich sichtbar gemacht.
        if (retirementStartIndex > 0) {
          monteCarloCtx.fillStyle = "rgba(98,168,255,0.065)";
          monteCarloCtx.fillRect(padding.left, padding.top, Math.max(0, retirementStartX - padding.left), plotH);
          monteCarloCtx.fillStyle = colors.muted;
          monteCarloCtx.textAlign = "left";
          monteCarloCtx.textBaseline = "top";
          monteCarloCtx.font = `700 ${compact ? 8 : 9}px Inter, system-ui, sans-serif`;
          monteCarloCtx.fillText("DCA-ANSPARPHASE", padding.left + 7, padding.top + 7);
        }

        monteCarloCtx.fillStyle = colors.muted;
        monteCarloCtx.textAlign = "left";
        monteCarloCtx.textBaseline = "top";
        monteCarloCtx.font = `700 ${compact ? 9 : 10}px Inter, system-ui, sans-serif`;
        monteCarloCtx.fillText("PORTFOLIO-WERT", padding.left, padding.top - 18);

        for (let index = 0; index <= 4; index++) {
          const py = padding.top + plotH / 4 * index;
          monteCarloCtx.beginPath();
          monteCarloCtx.strokeStyle = colors.grid;
          monteCarloCtx.moveTo(padding.left, py);
          monteCarloCtx.lineTo(width - padding.right, py);
          monteCarloCtx.stroke();
          monteCarloCtx.fillStyle = colors.muted;
          monteCarloCtx.textAlign = "right";
          monteCarloCtx.textBaseline = "middle";
          monteCarloCtx.font = `${compact ? 9 : 11}px Inter, system-ui, sans-serif`;
          monteCarloCtx.fillText(compactEuro.format(maxValue * (1 - index / 4)), padding.left - 9, py);
        }

        const startYear = new Date(minDate).getUTCFullYear();
        const endYear = new Date(maxDate).getUTCFullYear();
        const yearCount = Math.max(1, endYear - startYear);
        const desiredLabels = compact ? 4 : 8;
        const yearStep = Math.max(1, Math.ceil(yearCount / Math.max(1, desiredLabels - 1)));
        for (let year = startYear; year <= endYear; year += yearStep) {
          const tickDate = Math.max(minDate, Math.min(maxDate, Date.UTC(year, 0, 1)));
          monteCarloCtx.fillStyle = colors.muted;
          monteCarloCtx.textAlign = "center";
          monteCarloCtx.textBaseline = "top";
          monteCarloCtx.font = `${compact ? 9 : 11}px Inter, system-ui, sans-serif`;
          monteCarloCtx.fillText(String(year), xDate(tickDate), height - padding.bottom + 13);
        }
        if ((endYear - startYear) % yearStep !== 0) {
          monteCarloCtx.fillStyle = colors.muted;
          monteCarloCtx.textAlign = "center";
          monteCarloCtx.textBaseline = "top";
          monteCarloCtx.fillText(String(endYear), xDate(maxDate), height - padding.bottom + 13);
        }
        monteCarloCtx.fillStyle = colors.muted;
        monteCarloCtx.textAlign = "center";
        monteCarloCtx.textBaseline = "bottom";
        monteCarloCtx.font = `700 ${compact ? 9 : 10}px Inter, system-ui, sans-serif`;
        monteCarloCtx.fillText("KALENDERJAHR · ANSPARPHASE UND RENTENPHASE", padding.left + plotW / 2, height - 4);

        monteCarloCtx.beginPath();
        data.forEach((item, index) => {
          if (index === 0) monteCarloCtx.moveTo(x(index), y(item.p90));
          else monteCarloCtx.lineTo(x(index), y(item.p90));
        });
        for (let index = data.length - 1; index >= 0; index--) monteCarloCtx.lineTo(x(index), y(data[index].p10));
        monteCarloCtx.closePath();
        const band = monteCarloCtx.createLinearGradient(0, padding.top, 0, padding.top + plotH);
        band.addColorStop(0, "rgba(106,169,255,0.23)");
        band.addColorStop(1, "rgba(106,169,255,0.035)");
        monteCarloCtx.fillStyle = band;
        monteCarloCtx.fill();

        const line = (key, color, lineWidth, dash = []) => {
          monteCarloCtx.beginPath();
          data.forEach((item, index) => {
            if (index === 0) monteCarloCtx.moveTo(x(index), y(item[key]));
            else monteCarloCtx.lineTo(x(index), y(item[key]));
          });
          monteCarloCtx.strokeStyle = color;
          monteCarloCtx.lineWidth = lineWidth;
          monteCarloCtx.lineJoin = "round";
          monteCarloCtx.lineCap = "round";
          monteCarloCtx.setLineDash(dash);
          monteCarloCtx.stroke();
          monteCarloCtx.setLineDash([]);
        };
        line("p90", "#6aa9ff", 1.4, [5, 5]);
        line("p10", "#6aa9ff", 1.4, [5, 5]);
        line("p50", "#f7931a", 2.8);

        if (retirementStartIndex >= 0) {
          monteCarloCtx.save();
          monteCarloCtx.strokeStyle = "rgba(247,147,26,0.86)";
          monteCarloCtx.lineWidth = 1.4;
          monteCarloCtx.setLineDash([5, 5]);
          monteCarloCtx.beginPath();
          monteCarloCtx.moveTo(retirementStartX, padding.top);
          monteCarloCtx.lineTo(retirementStartX, padding.top + plotH);
          monteCarloCtx.stroke();
          monteCarloCtx.restore();
          drawRoundedLabel(monteCarloCtx, "Rentenstart", retirementStartX, padding.top + 14, { align: "center", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compact ? 8 : 9}px Inter, system-ui, sans-serif`, height: 21 });
        }

        if (currentMonteCarloHover) {
          const index = Math.max(0, Math.min(data.length - 1, currentMonteCarloHover.index));
          const item = data[index];
          const px = x(index);
          const py = Math.max(padding.top, Math.min(padding.top + plotH, currentMonteCarloHover.y));
          const cursorValue = maxValue * (1 - (py - padding.top) / plotH);

          monteCarloCtx.save();
          monteCarloCtx.strokeStyle = colors.cross;
          monteCarloCtx.lineWidth = 1;
          monteCarloCtx.setLineDash([4, 4]);
          monteCarloCtx.beginPath(); monteCarloCtx.moveTo(px, padding.top); monteCarloCtx.lineTo(px, padding.top + plotH); monteCarloCtx.stroke();
          monteCarloCtx.beginPath(); monteCarloCtx.moveTo(padding.left, py); monteCarloCtx.lineTo(width - padding.right, py); monteCarloCtx.stroke();
          monteCarloCtx.setLineDash([]);
          ["p10", "p50", "p90"].forEach(key => {
            monteCarloCtx.beginPath();
            monteCarloCtx.arc(px, y(item[key]), key === "p50" ? 4.5 : 3.5, 0, Math.PI * 2);
            monteCarloCtx.fillStyle = key === "p50" ? "#f7931a" : "#6aa9ff";
            monteCarloCtx.fill();
            monteCarloCtx.strokeStyle = colors.axisBox;
            monteCarloCtx.lineWidth = 1.5;
            monteCarloCtx.stroke();
          });
          monteCarloCtx.restore();

          drawRoundedLabel(monteCarloCtx, formatDate(item.dateMs), px, height - padding.bottom + 29, { align: "center", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compact ? 9 : 10}px Inter, system-ui, sans-serif` });
          drawRoundedLabel(monteCarloCtx, compactEuro.format(cursorValue), width - padding.right + 5, py, { align: "left", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compact ? 9 : 10}px Inter, system-ui, sans-serif` });
        }
      }

      function updateMonteCarloTooltip(index) {
        if (!monteCarloTooltip || !currentMonteCarloData?.percentiles?.length) return;
        const data = currentMonteCarloData.percentiles;
        const item = data[Math.max(0, Math.min(data.length - 1, index))];
        const phaseLabel = item.phase === "accumulation"
          ? "DCA-Ansparphase"
          : item.phase === "retirementStart"
            ? "Rentenstart"
            : `Rentenjahr ${item.retirementYear}`;
        document.getElementById("mcTooltipTitle").textContent = `${phaseLabel} · ${formatDate(item.dateMs)}`;
        document.getElementById("mcTooltipP90").textContent = euro.format(item.p90);
        document.getElementById("mcTooltipP50").textContent = euro.format(item.p50);
        document.getElementById("mcTooltipP10").textContent = euro.format(item.p10);
        monteCarloTooltip.hidden = false;
        const px = currentMonteCarloLayout?.x(index) ?? 0;
        monteCarloTooltip.classList.toggle("is-right", px < (currentMonteCarloLayout?.width ?? 0) / 2);
      }

      function initialiseMonteCarloInteraction() {
        if(!monteCarloCanvas)return;
        const setFromPointer=(event)=>{
          if(!currentMonteCarloLayout||!currentMonteCarloData?.percentiles?.length)return;
          const rect=monteCarloCanvas.getBoundingClientRect();
          const localX=event.clientX-rect.left;
          const localY=event.clientY-rect.top;
          const {padding,plotW,plotH,data}=currentMonteCarloLayout;
          if(localX<padding.left||localX>padding.left+plotW||localY<padding.top||localY>padding.top+plotH){
            if(event.pointerType==="mouse") { currentMonteCarloHover=null; monteCarloTooltip.hidden=true; drawMonteCarloChart(data); }
            return;
          }
          let index = 0;
          let nearestDistance = Infinity;
          data.forEach((_, candidateIndex) => {
            const distance = Math.abs(currentMonteCarloLayout.x(candidateIndex) - localX);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              index = candidateIndex;
            }
          });
          currentMonteCarloHover={index,y:localY};
          updateMonteCarloTooltip(index);
          drawMonteCarloChart(data);
        };
        monteCarloCanvas.addEventListener("pointermove",setFromPointer);
        monteCarloCanvas.addEventListener("pointerdown",event=>{monteCarloCanvas.setPointerCapture?.(event.pointerId);setFromPointer(event);});
        monteCarloCanvas.addEventListener("pointerleave",event=>{if(event.pointerType!=="mouse")return;currentMonteCarloHover=null;if(monteCarloTooltip)monteCarloTooltip.hidden=true;if(currentMonteCarloData)drawMonteCarloChart(currentMonteCarloData.percentiles);});
        monteCarloCanvas.addEventListener("keydown",event=>{
          if(!currentMonteCarloData?.percentiles?.length||!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
          event.preventDefault();
          const length=currentMonteCarloData.percentiles.length;
          let index=currentMonteCarloHover?.index??0;
          if(event.key==="ArrowLeft")index=Math.max(0,index-1);
          if(event.key==="ArrowRight")index=Math.min(length-1,index+1);
          if(event.key==="Home")index=0;
          if(event.key==="End")index=length-1;
          const layout=currentMonteCarloLayout;
          currentMonteCarloHover={index,y:layout?layout.y(currentMonteCarloData.percentiles[index].p50):0};
          updateMonteCarloTooltip(index);
          drawMonteCarloChart(currentMonteCarloData.percentiles);
        });
      }

      function renderSummary(result) {
        const statusCard = document.getElementById("statusCard");
        const statusValue = document.getElementById("statusValue");
        const statusSub = document.getElementById("statusSub");

        statusCard.classList.remove("status-ok", "status-bad");

        if (result.values.calculationMode === "preserve") {
          const startPortfolio = result.startPortfolioValue;
          const capitalPreserved = result.monthly.every(row => row.portfolioValue + Math.max(0.01, startPortfolio * 1e-10) >= startPortfolio);
          statusCard.classList.add(capitalPreserved ? "status-ok" : "status-bad");
          statusValue.textContent = capitalPreserved ? "Kapital erhalten" : "Kapital sinkt";
          statusSub.textContent = `Mindestwert ab ${formatDate(result.startDate)}: ${euro.format(startPortfolio)}`;
        } else if (result.depletedAt) {
          const date = formatDate(result.depletedAt.dateMs);
          statusCard.classList.add("status-bad");
          statusValue.textContent = "Aufgebraucht";
          statusSub.textContent = `Der Bestand reicht bis ${date}`;
        } else {
          statusCard.classList.add("status-ok");
          statusValue.textContent = "Bestand reicht";
          statusSub.textContent = `Entnahmen ab ${formatDate(result.startDate)} · Startkapital ${euro.format(result.startPortfolioValue)}`;
        }

        const remainingShare = result.startBitcoinAmount > 0 ? result.finalBitcoinAmount / result.startBitcoinAmount * 100 : 0;
        if (result.values.calculationMode === "preserve") {
          document.getElementById("remainingMetricLabel").textContent = "Monatlich möglich";
          document.getElementById("remainingBtc").textContent = euroPrecise.format(result.monthlyWithdrawal);
          document.getElementById("btcShare").textContent = `Restbestand: ${number.format(result.finalBitcoinAmount)} BTC`;
        } else if (result.values.calculationMode === "safeRule") {
          document.getElementById("remainingMetricLabel").textContent = "Startentnahme";
          document.getElementById("remainingBtc").textContent = euroPrecise.format(result.initialMonthlyWithdrawal);
          document.getElementById("btcShare").textContent = `Im letzten Rentenjahr: ${euroPrecise.format(result.finalMonthlyWithdrawal)} pro Monat`;
        } else {
          document.getElementById("remainingMetricLabel").textContent = "Restbestand";
          document.getElementById("remainingBtc").textContent = `${number.format(result.finalBitcoinAmount)} BTC`;
          document.getElementById("btcShare").textContent = `${Math.max(0, remainingShare).toFixed(1).replace(".", ",")} % des Bestands zum Rentenstart`;
        }
        document.getElementById("portfolioValue").textContent = euro.format(result.finalPortfolioValue);
        document.getElementById("endPrice").textContent = `BTC-Preis am Ende: ${euro.format(result.finalPrice)}`;
        document.getElementById("totalWithdrawn").textContent = euro.format(result.totalWithdrawn);
        document.getElementById("withdrawnBtc").textContent = result.values.calculationMode === "preserve"
          ? `${euroPrecise.format(result.monthlyWithdrawal)} pro Monat · ${number.format(result.totalWithdrawnBtc)} BTC verkauft`
          : result.values.calculationMode === "safeRule"
            ? `${percent.format(result.values.safeWithdrawalRate)} % Startsatz · ${number.format(result.totalWithdrawnBtc)} BTC verkauft`
            : `entspricht ${number.format(result.totalWithdrawnBtc)} BTC`;
        document.getElementById("activeModelBadge").textContent = modelName(result.values.growthModel);
      }

      function buildYearlyOverview(result) {
        const rows = buildPortfolioTimeline(result);
        const groups = new Map();

        rows.forEach(row => {
          const year = new Date(row.dateMs).getUTCFullYear();
          if (!groups.has(year)) {
            groups.set(year, {
              year,
              phases: new Set(),
              firstPrice: row.bitcoinPrice,
              bitcoinPrice: row.bitcoinPrice,
              bitcoinAmount: row.bitcoinAmount,
              portfolioValue: row.portfolioValue,
              dcaContributed: 0,
              dcaBitcoin: 0,
              dcaPurchases: 0,
              withdrawnThisYear: 0
            });
          }
          const group = groups.get(year);
          group.phases.add(row.phase);
          group.bitcoinPrice = row.bitcoinPrice;
          group.bitcoinAmount = row.bitcoinAmount;
          group.portfolioValue = row.portfolioValue;
          group.dcaContributed += Math.max(0, Number(row.dcaEur) || 0);
          group.dcaBitcoin += Math.max(0, Number(row.purchasedBitcoin) || 0);
          if ((Number(row.purchasedBitcoin) || 0) > 0) group.dcaPurchases += 1;
          group.withdrawnThisYear += Math.max(0, Number(row.withdrawalEur) || 0);
        });

        return [...groups.values()].sort((a, b) => a.year - b.year).map(group => {
          const hasAccumulation = group.phases.has("accumulation");
          const hasRetirement = group.phases.has("retirement");
          const hasStart = group.phases.has("retirementStart");
          const phase = hasAccumulation && (hasRetirement || hasStart)
            ? "Übergang"
            : hasAccumulation
              ? "Ansparen"
              : hasRetirement
                ? "Rente"
                : "Rentenstart";
          return {
            ...group,
            phase,
            annualReturn: group.firstPrice > 0 ? (group.bitcoinPrice / group.firstPrice - 1) * 100 : 0
          };
        });
      }

      function renderTable(result) {
        const body = document.getElementById("yearTableBody");
        const rows = buildYearlyOverview(result);
        body.innerHTML = rows.map(row => `
          <tr class="year-row year-row-${row.phase.toLowerCase().replace("ü", "ue")}">
            <td>${row.year}</td>
            <td><span class="year-phase">${row.phase}</span></td>
            <td>${euro.format(row.bitcoinPrice)}</td>
            <td>${number.format(row.bitcoinAmount)} BTC</td>
            <td>${euro.format(row.portfolioValue)}</td>
            <td>${percent.format(row.annualReturn)} %</td>
            <td>${row.dcaContributed > 0 ? `${euro.format(row.dcaContributed)} · ${row.dcaPurchases} Käufe` : "–"}</td>
            <td>${row.dcaBitcoin > 0 ? `+${number.format(row.dcaBitcoin)} BTC` : "–"}</td>
            <td>${row.withdrawnThisYear > 0 ? euro.format(row.withdrawnThisYear) : "–"}</td>
          </tr>
        `).join("");

        if (!rows.length) {
          body.innerHTML = '<tr><td colspan="9">Keine Jahreswerte verfügbar.</td></tr>';
        }
      }

      function buildPortfolioTimeline(result) {
        const accumulationRows = (result.accumulationMonthly || []).map(row => ({
          ...row,
          chartDateMs: row.valuationDateMs ?? row.dateMs
        }));
        const retirementRows = (result.monthly || []).map(row => ({
          ...row,
          chartDateMs: row.valuationDateMs ?? row.dateMs
        }));
        return [...accumulationRows, ...retirementRows]
          .filter(row => Number.isFinite(row.chartDateMs) && Number.isFinite(row.bitcoinPrice) && Number.isFinite(row.bitcoinAmount) && Number.isFinite(row.portfolioValue))
          .sort((a, b) => a.chartDateMs - b.chartDateMs);
      }

      function renderMonthly(result) {
        const log = document.getElementById("monthlyLog");
        const rows = buildPortfolioTimeline(result);
        if (!rows.length) {
          log.innerHTML = '<div class="monthly-empty">Keine Monatswerte verfügbar.</div>';
          return;
        }

        const header = `
          <div class="monthly-row monthly-row-header" aria-hidden="true">
            <span>Phase</span><span>Datum</span><span>BTC-Preis</span><span>BTC-Bestand</span><span>Portfolio</span><span>Vorgang</span>
          </div>`;
        const body = rows.map(row => {
          const phaseLabel = row.phase === "accumulation" ? "Ansparen" : row.phase === "retirementStart" ? "Rentenstart" : "Rente";
          const action = row.phase === "accumulation" && row.dcaEur > 0
            ? `+${euroPrecise.format(row.dcaEur)} DCA · +${number.format(row.purchasedBitcoin)} BTC`
            : row.phase === "retirementStart"
              ? "Beginn der Entnahmen"
              : row.withdrawalEur > 0
                ? `−${euroPrecise.format(row.withdrawalEur)} Entnahme`
                : "Keine Entnahme";
          return `
            <div class="monthly-row monthly-row-${row.phase}">
              <span class="monthly-phase" data-label="Phase">${phaseLabel}</span>
              <span data-label="Datum">${formatDate(row.dateMs)}</span>
              <span data-label="BTC-Preis">${euroPrecise.format(row.bitcoinPrice)}</span>
              <span data-label="BTC-Bestand">${number.format(row.bitcoinAmount)} BTC</span>
              <span data-label="Portfolio">${euroPrecise.format(row.portfolioValue)}</span>
              <span class="monthly-action" data-label="Vorgang">${action}</span>
            </div>`;
        }).join("");
        log.innerHTML = header + body;
      }

      function renderHistory(metrics = bearBottomDecayMetrics(Number(document.getElementById("decayFloor")?.value) || 8)) {
        const body = document.getElementById("historyTableBody");
        const currency = selectedCalculationCurrency();
        const priceFormatter = currencyFormatters(currency).whole;
        const shortDate = new Intl.DateTimeFormat("de-DE", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          timeZone: "UTC"
        });

        if (!metrics.observations?.length) {
          body.innerHTML = '<tr><td colspan="5">Noch keine gültigen CAGR-Perioden verfügbar.</td></tr>';
          return;
        }

        body.innerHTML = metrics.observations.map((row, index) => {
          const previous = index > 0 ? metrics.observations[index - 1].cagr : null;
          const decline = previous && Number.isFinite(previous) && previous !== 0
            ? (1 - row.cagr / previous) * 100
            : null;
          return `
            <tr>
              <td>${shortDate.format(new Date(row.start.dateMs))} – ${shortDate.format(new Date(row.end.dateMs))}</td>
              <td>${Number.isFinite(bearBottomPriceForDisplay(row.start.priceUsd, currency)) ? priceFormatter.format(bearBottomPriceForDisplay(row.start.priceUsd, currency)) : "–"}</td>
              <td>${Number.isFinite(bearBottomPriceForDisplay(row.end.priceUsd, currency)) ? priceFormatter.format(bearBottomPriceForDisplay(row.end.priceUsd, currency)) : "–"}</td>
              <td>${percent.format(row.cagr)} %</td>
              <td>${decline === null ? "–" : `${percent.format(decline)} %`}</td>
            </tr>
          `;
        }).join("") + (metrics.valid ? `
          <tr>
            <td><strong>Modell ab heute</strong></td>
            <td>–</td>
            <td>–</td>
            <td><strong>${percent.format(metrics.currentRate)} %</strong></td>
            <td>${percent.format(metrics.initialReduction)} % im nächsten Jahr</td>
          </tr>
        ` : "");
      }

      function niceMax(value) {
        if (!Number.isFinite(value) || value <= 0) return 1;
        const exponent = Math.floor(Math.log10(value));
        const fraction = value / Math.pow(10, exponent);
        const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
        return niceFraction * Math.pow(10, exponent);
      }

      function drawChart(data) {
        currentChartData = Array.isArray(data) ? data : [];
        const rect = canvas.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;
        ctx.clearRect(0, 0, width, height);
        if (!currentChartData.length) return;

        const dataRows = currentChartData;
        const compactLayout = width < 520;
        const padding = compactLayout
          ? { top: 29, right: 72, bottom: 56, left: 62 }
          : { top: 34, right: 92, bottom: 60, left: 82 };
        const plotW = Math.max(20, width - padding.left - padding.right);
        const plotH = Math.max(20, height - padding.top - padding.bottom);
        const maxPortfolio = niceMax(Math.max(...dataRows.map(d => d.portfolioValue), 1) * 1.05);
        const maxBtc = niceMax(Math.max(...dataRows.map(d => d.bitcoinAmount), 0.00000001) * 1.05);
        const minDate = dataRows[0].chartDateMs;
        const maxDate = Math.max(minDate + DAY_MS, dataRows.at(-1).chartDateMs);
        const xDate = dateMs => padding.left + ((dateMs - minDate) / (maxDate - minDate)) * plotW;
        const x = index => xDate(dataRows[index].chartDateMs);
        const yPortfolio = value => padding.top + plotH - Math.min(1, Math.max(0, value / maxPortfolio)) * plotH;
        const yBtc = value => padding.top + plotH - Math.min(1, Math.max(0, value / maxBtc)) * plotH;
        const colors = monteCarloThemeColors();
        const retirementStartIndex = dataRows.findIndex(row => row.phase === "retirementStart");
        const retirementStartX = retirementStartIndex >= 0 ? x(retirementStartIndex) : padding.left;
        currentPortfolioLayout = { width, height, padding, plotW, plotH, maxPortfolio, maxBtc, minDate, maxDate, x, xDate, yPortfolio, yBtc, data: dataRows, retirementStartIndex };

        ctx.font = `${compactLayout ? 9 : 11}px Inter, system-ui, sans-serif`;
        ctx.lineWidth = 1;

        // Anspar-/DCA-Phase sichtbar hinterlegen.
        if (retirementStartX > padding.left + 1) {
          const dcaGradient = ctx.createLinearGradient(padding.left, 0, retirementStartX, 0);
          dcaGradient.addColorStop(0, "rgba(98,168,255,0.12)");
          dcaGradient.addColorStop(1, "rgba(98,168,255,0.035)");
          ctx.fillStyle = dcaGradient;
          ctx.fillRect(padding.left, padding.top, retirementStartX - padding.left, plotH);
          ctx.fillStyle = colors.muted;
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.font = `700 ${compactLayout ? 8 : 9}px Inter, system-ui, sans-serif`;
          ctx.fillText("DCA / ANSPAREN", padding.left + 7, padding.top + 7);
        }

        ctx.fillStyle = colors.muted;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = `700 ${compactLayout ? 9 : 10}px Inter, system-ui, sans-serif`;
        ctx.fillText("PORTFOLIO", padding.left, padding.top - 21);
        ctx.textAlign = "right";
        ctx.fillText("BTC-BESTAND", width - padding.right, padding.top - 21);

        for (let i = 0; i <= 4; i++) {
          const py = padding.top + (plotH / 4) * i;
          const portfolioLabel = maxPortfolio * (1 - i / 4);
          const btcLabel = maxBtc * (1 - i / 4);
          ctx.beginPath();
          ctx.strokeStyle = colors.grid;
          ctx.moveTo(padding.left, py);
          ctx.lineTo(width - padding.right, py);
          ctx.stroke();
          ctx.fillStyle = colors.muted;
          ctx.font = `${compactLayout ? 9 : 11}px Inter, system-ui, sans-serif`;
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(compactEuro.format(portfolioLabel), padding.left - 9, py);
          ctx.textAlign = "left";
          ctx.fillText(`${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 }).format(btcLabel)} BTC`, width - padding.right + 9, py);
        }

        // Kalenderjahre auf der X-Achse.
        const startYear = new Date(minDate).getUTCFullYear();
        const endYear = new Date(maxDate).getUTCFullYear();
        const yearCount = Math.max(1, endYear - startYear);
        const desiredLabels = compactLayout ? 4 : 8;
        const yearStep = Math.max(1, Math.ceil(yearCount / Math.max(1, desiredLabels - 1)));
        for (let year = startYear; year <= endYear; year += yearStep) {
          const tickDate = Math.max(minDate, Math.min(maxDate, Date.UTC(year, 0, 1)));
          ctx.fillStyle = colors.muted;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.font = `${compactLayout ? 9 : 11}px Inter, system-ui, sans-serif`;
          ctx.fillText(String(year), xDate(tickDate), height - padding.bottom + 13);
        }
        if ((endYear - startYear) % yearStep !== 0) {
          ctx.fillStyle = colors.muted;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(String(endYear), xDate(maxDate), height - padding.bottom + 13);
        }
        ctx.fillStyle = colors.muted;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.font = `700 ${compactLayout ? 9 : 10}px Inter, system-ui, sans-serif`;
        ctx.fillText("KALENDERJAHR", padding.left + plotW / 2, height - 4);

        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, "rgba(247,147,26,0.30)");
        gradient.addColorStop(1, "rgba(247,147,26,0.01)");
        ctx.beginPath();
        dataRows.forEach((item, index) => {
          const px = x(index), py = yPortfolio(item.portfolioValue);
          if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.lineTo(x(dataRows.length - 1), padding.top + plotH);
        ctx.lineTo(x(0), padding.top + plotH);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        const drawSeries = (selector, color, lineWidth, dash = []) => {
          ctx.beginPath();
          dataRows.forEach((item, index) => {
            const px = x(index), py = selector(item);
            if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          });
          ctx.strokeStyle = color;
          ctx.lineWidth = lineWidth;
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.setLineDash(dash);
          ctx.stroke();
          ctx.setLineDash([]);
        };
        drawSeries(item => yPortfolio(item.portfolioValue), "#f7931a", 3);
        drawSeries(item => yBtc(item.bitcoinAmount), "#62a8ff", 2.2, [7, 7]);

        // Rentenstart als feste vertikale Trennlinie.
        if (retirementStartIndex >= 0) {
          ctx.save();
          ctx.strokeStyle = "rgba(247,147,26,0.82)";
          ctx.lineWidth = 1.4;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(retirementStartX, padding.top);
          ctx.lineTo(retirementStartX, padding.top + plotH);
          ctx.stroke();
          ctx.restore();
          drawRoundedLabel(ctx, "Rentenstart", retirementStartX, padding.top + 14, { align: "center", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compactLayout ? 8 : 9}px Inter, system-ui, sans-serif`, height: 21 });
        }

        if (currentPortfolioHover) {
          const index = Math.max(0, Math.min(dataRows.length - 1, currentPortfolioHover.index));
          const item = dataRows[index];
          const px = x(index);
          const py = Math.max(padding.top, Math.min(padding.top + plotH, currentPortfolioHover.y));
          const cursorPortfolio = maxPortfolio * (1 - (py - padding.top) / plotH);

          ctx.save();
          ctx.strokeStyle = colors.cross;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(px, padding.top); ctx.lineTo(px, padding.top + plotH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(padding.left, py); ctx.lineTo(width - padding.right, py); ctx.stroke();
          ctx.setLineDash([]);

          ctx.beginPath(); ctx.arc(px, yPortfolio(item.portfolioValue), 4.5, 0, Math.PI * 2); ctx.fillStyle = "#f7931a"; ctx.fill(); ctx.strokeStyle = colors.axisBox; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.arc(px, yBtc(item.bitcoinAmount), 4, 0, Math.PI * 2); ctx.fillStyle = "#62a8ff"; ctx.fill(); ctx.strokeStyle = colors.axisBox; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.restore();

          drawRoundedLabel(ctx, formatDate(item.chartDateMs), px, height - padding.bottom + 31, { align: "center", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compactLayout ? 9 : 10}px Inter, system-ui, sans-serif` });
          drawRoundedLabel(ctx, compactEuro.format(cursorPortfolio), width - padding.right + 5, py, { align: "left", canvasWidth: width, background: colors.axisBox, color: "#fff", font: `700 ${compactLayout ? 9 : 10}px Inter, system-ui, sans-serif` });
        }
      }

      function updatePortfolioTooltip(index) {
        if (!portfolioChartTooltip || !currentPortfolioLayout?.data?.length) return;
        const data = currentPortfolioLayout.data;
        const item = data[Math.max(0, Math.min(data.length - 1, index))];
        const phase = item.phase === "accumulation" ? "Ansparphase" : item.phase === "retirementStart" ? "Rentenstart" : "Rentenphase";
        document.getElementById("portfolioTooltipTitle").textContent = `${phase} · ${formatDate(item.chartDateMs)}`;
        document.getElementById("portfolioTooltipValue").textContent = euro.format(item.portfolioValue);
        document.getElementById("portfolioTooltipBtc").textContent = `${number.format(item.bitcoinAmount)} BTC`;
        document.getElementById("portfolioTooltipPrice").textContent = euro.format(item.bitcoinPrice);
        const actionRow = document.getElementById("portfolioTooltipActionRow");
        const actionLabel = document.getElementById("portfolioTooltipActionLabel");
        const actionValue = document.getElementById("portfolioTooltipAction");
        if (item.phase === "accumulation" && item.dcaEur > 0) {
          actionLabel.textContent = "DCA-Kauf";
          actionValue.textContent = `${euroPrecise.format(item.dcaEur)} · +${number.format(item.purchasedBitcoin)} BTC`;
          actionRow.hidden = false;
        } else if (item.phase === "retirement" && item.withdrawalEur > 0) {
          actionLabel.textContent = "Entnahme";
          actionValue.textContent = `−${euroPrecise.format(item.withdrawalEur)}`;
          actionRow.hidden = false;
        } else if (item.phase === "retirementStart") {
          actionLabel.textContent = "Übergang";
          actionValue.textContent = "Beginn der Entnahmen";
          actionRow.hidden = false;
        } else {
          actionRow.hidden = true;
        }
        portfolioChartTooltip.hidden = false;
        const px = currentPortfolioLayout.x(index);
        portfolioChartTooltip.classList.toggle("is-right", px < currentPortfolioLayout.width / 2);
      }

      function initialisePortfolioChartInteraction() {
        if (!canvas) return;
        const setFromPointer = event => {
          if (!currentPortfolioLayout?.data?.length) return;
          const rect = canvas.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          const localY = event.clientY - rect.top;
          const { padding, plotW, plotH, data, x } = currentPortfolioLayout;
          if (localX < padding.left || localX > padding.left + plotW || localY < padding.top || localY > padding.top + plotH) {
            if (event.pointerType === "mouse") {
              currentPortfolioHover = null;
              portfolioChartTooltip.hidden = true;
              drawChart(data);
            }
            return;
          }
          let nearestIndex = 0;
          let nearestDistance = Infinity;
          data.forEach((_, index) => {
            const distance = Math.abs(x(index) - localX);
            if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
          });
          currentPortfolioHover = { index: nearestIndex, y: localY };
          updatePortfolioTooltip(nearestIndex);
          drawChart(data);
        };
        canvas.addEventListener("pointermove", setFromPointer);
        canvas.addEventListener("pointerdown", event => { canvas.setPointerCapture?.(event.pointerId); setFromPointer(event); });
        canvas.addEventListener("pointerleave", event => {
          if (event.pointerType !== "mouse") return;
          currentPortfolioHover = null;
          if (portfolioChartTooltip) portfolioChartTooltip.hidden = true;
          drawChart(currentChartData);
        });
        canvas.addEventListener("keydown", event => {
          if (!currentPortfolioLayout?.data?.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const data = currentPortfolioLayout.data;
          let index = currentPortfolioHover?.index ?? 0;
          if (event.key === "ArrowLeft") index = Math.max(0, index - 1);
          if (event.key === "ArrowRight") index = Math.min(data.length - 1, index + 1);
          if (event.key === "Home") index = 0;
          if (event.key === "End") index = data.length - 1;
          currentPortfolioHover = { index, y: currentPortfolioLayout.yPortfolio(data[index].portfolioValue) };
          updatePortfolioTooltip(index);
          drawChart(data);
        });
      }

      function updateHero(values) {
        const heroWithdrawal=document.getElementById("heroWithdrawal"),heroYears=document.getElementById("heroYears");
        if(heroWithdrawal)heroWithdrawal.textContent=values.calculationMode==="safeRule"?`${percent.format(values.safeWithdrawalRate)} % Regel`:values.calculationMode==="preserve"?"Automatisch":euro.format(values.monthlyWithdrawal);
        if(heroYears)heroYears.textContent=`${values.simulationYears} ${values.simulationYears===1?"Jahr":"Jahre"}`;
      }

      function updateStartPreview(values) {
        const preview = document.getElementById("startPreview");
        const startCapitalValue = document.getElementById("startCapitalValue");
        const startDate = parseWithdrawalStart(values.withdrawalStart);
        if (!Number.isFinite(startDate) || !(values.bitcoinPrice > 0) || !(values.bitcoinAmount > 0)) {
          startCapitalValue.textContent = "Bitte Ausgangswerte eintragen";
          preview.textContent = "BTC-Preis, Bestand und Rentenstart werden für die Ansparphase benötigt.";
          return;
        }

        const accumulation = accumulationAtRetirementStart(values, startDate);
        if (!Number.isFinite(accumulation.startPortfolioValue)) {
          startCapitalValue.textContent = "Modellwerte prüfen";
          preview.textContent = "Aus den aktuellen Eingaben konnte kein gültiges Startkapital berechnet werden.";
          return;
        }

        startCapitalValue.textContent = `${euro.format(accumulation.startPortfolioValue)} · ${number.format(accumulation.startBitcoinAmount)} BTC`;
        const waitDays = Math.max(0, (startDate - todayUtc()) / DAY_MS);
        if (waitDays < 1) {
          preview.textContent = `Die Rente beginnt heute bei einem Modellpreis von ${euro.format(accumulation.startPrice)}. Vorher findet kein DCA-Kauf statt.`;
          return;
        }

        const waitYears = waitDays / YEAR_DAYS;
        const duration = waitYears >= 1
          ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(waitYears)} Jahre`
          : `${Math.round(waitDays)} Tage`;
        const dcaText = accumulation.dcaPurchases > 0
          ? `${accumulation.dcaPurchases} DCA-Käufe über ${euro.format(accumulation.dcaContributed)} ergeben zusätzlich ${number.format(accumulation.dcaBitcoin)} BTC.`
          : "Es wurde kein zusätzlicher DCA berücksichtigt.";
        preview.textContent = `Ansparphase: ${duration} bis ${formatDate(startDate)}. Modellpreis zum Rentenstart: ${euro.format(accumulation.startPrice)}. ${dcaText}`;
      }

      function updateSafeRatePreset() {
        const value=Number(document.getElementById("safeWithdrawalRate").value); document.querySelectorAll("[data-safe-rate]").forEach(button=>button.classList.toggle("is-active",Math.abs(Number(button.dataset.safeRate)-value)<.0001));
      }
      function updatePowerLawImpact() {
        const output = document.getElementById("powerLawImpact");
        const input = document.getElementById("powerLawExponent");
        if (!output || !input) return;
        const exponent = Number(input.value);
        if (!(exponent > 0) || !Number.isFinite(exponent)) {
          output.textContent = "Bitte einen gültigen Exponenten größer als 0 eintragen.";
          return;
        }

        const anchorDate = todayUtc();
        const tenYearsLater = Date.UTC(
          new Date(anchorDate).getUTCFullYear() + 10,
          new Date(anchorDate).getUTCMonth(),
          new Date(anchorDate).getUTCDate()
        );
        const anchorAge = Math.max(1, (anchorDate - GENESIS_UTC) / DAY_MS);
        const futureAge = Math.max(1, (tenYearsLater - GENESIS_UTC) / DAY_MS);
        const factor = Math.pow(futureAge / anchorAge, exponent);
        const effectiveCagr = (Math.pow(factor, 1 / 10) - 1) * 100;
        const standard = 5.8451542;
        const classification = exponent > standard + 0.05
          ? "aggressiver als der Standard"
          : exponent < standard - 0.05
            ? "flacher als der Standard"
            : "nahe am hinterlegten Standard";
        const factorText = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(factor);
        const cagrText = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(effectiveCagr);
        output.textContent = `Mit β = ${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 }).format(exponent)} ist die Kurve ${classification}. Im glatten Modell läge der Preis in zehn Jahren beim Faktor ${factorText} des heutigen Preises; das entspricht über diesen Zeitraum rechnerisch etwa ${cagrText} % p. a. Je höher β, desto stärker wächst dieser Faktor.`;
      }

      function updateMonteCarloTargetHelp() {
        const help = document.getElementById("monteCarloTargetHelp");
        if (!help) return;
        const goal = form.elements.monteCarloTargetGoal?.value === "preserveEnd" ? "preserveEnd" : "survival";
        const rate = Number(document.getElementById("monteCarloTargetSuccess")?.value) || 90;
        help.textContent = goal === "preserveEnd"
          ? `Die maximale feste Monatsentnahme wird so gewählt, dass das nominale Endkapital in mindestens ${percent.format(rate)} % der Zufallspfade mindestens so hoch wie das jeweilige Kapital zum Rentenstart ist.`
          : `Die maximale feste Monatsentnahme wird so gewählt, dass der BTC-Bestand in mindestens ${percent.format(rate)} % der Zufallspfade bis zum Ende reicht.`;
      }

      function updateModelUi() {
        const model=selectedModel(),calculationMode=selectedCalculationMode(); document.querySelectorAll("[data-model-fields]").forEach(group=>{group.hidden=group.dataset.modelFields!==model;});
        const fixedMode=calculationMode==="fixed",preserveMode=calculationMode==="preserve",safeRuleMode=calculationMode==="safeRule";
        document.getElementById("fixedWithdrawalField").hidden=!fixedMode; document.getElementById("safeWithdrawalFields").hidden=!safeRuleMode; document.getElementById("calculatedWithdrawalBox").hidden=!preserveMode; document.getElementById("safeWithdrawalBox").hidden=!safeRuleMode; document.getElementById("preserveComparison").hidden=!preserveMode;
        document.getElementById("submitButton").textContent=preserveMode?"Entnahme berechnen":safeRuleMode?"3/4-%-Regel simulieren":"Simulation starten";
        const mc=document.getElementById("monteCarloEnabled").checked; document.getElementById("monteCarloInputs").classList.toggle("is-disabled",!mc); document.getElementById("monteCarloTargetField").hidden=!preserveMode; if(!mc)document.getElementById("monteCarloPanel").hidden=true; updateSafeRatePreset(); updatePowerLawImpact(); updateMonteCarloTargetHelp();
        const texts={constant:"Modellannahme: Der eingegebene BTC-Preis gilt für heute. Er wächst bereits bis zum gewählten Entnahmestart mit der konstanten Jahresrendite weiter. Erst danach beginnen die monatlichen Entnahmen. Keine Finanzberatung oder Kursprognose; Steuern und Gebühren sind nicht berücksichtigt.",decay:"Modellannahme: Der eingegebene BTC-Preis gilt für heute. Die aus Bärenmarkt-Böden abgeleitete Renditekurve läuft bereits während der Wartezeit bis zum Entnahmestart. Die Abschwächung ist hyperbolisch und wird mit der Zeit kleiner. Erst danach beginnen die monatlichen Entnahmen. Keine Finanzberatung oder Kursprognose; Steuern und Gebühren sind nicht berücksichtigt.",powerLaw:"Modellannahme: Der eingegebene BTC-Preis gilt für heute. Die relative Entwicklung folgt dem eingestellten Power-Law-Exponenten und wird bis zum gewählten Entnahmestart fortgeschrieben; erst dann beginnen die Entnahmen. Das Modell ist am heutigen Marktpreis verankert. Keine Finanzberatung oder Kursgarantie; Steuern und Gebühren sind nicht berücksichtigt."};
        if(preserveMode)document.getElementById("assumptionText").textContent=`Kapitalerhalt-Modus mit ${modelName(model)}: Bis zum gewählten Rentenstart werden der heutige Stack und der optionale DCA aufgebaut. Danach wird der maximale feste Monatsbetrag berechnet, bei dem der nominale Portfolio-Wert nach jedem Rentenmonat mindestens dem Kapital zum Rentenstart entspricht. Inflation, Steuern, Gebühren und reale Kursschwankungen sind nicht berücksichtigt. Keine Finanzberatung oder Kursprognose.`;
        else if(safeRuleMode)document.getElementById("assumptionText").textContent=`${percent.format(getValues().safeWithdrawalRate)}-%-Regel mit ${modelName(model)}: Der erste Jahresbetrag entspricht dem eingestellten Anteil des Kapitals zum Rentenstart und wird auf zwölf Monate verteilt. Anschließend steigt der Betrag in der gewählten Rechenwährung einmal jährlich um ${percent.format(getValues().inflationRate)} %. Die bekannte 4-%-Regel wurde für diversifizierte Wertpapierportfolios und einen begrenzten Ruhestand entwickelt; sie ist keine Garantie für Bitcoin. Keine Finanzberatung.`;
        else document.getElementById("assumptionText").textContent=texts[model]; updateStartPreview(getValues());
      }

      function saveValues(values) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
        } catch (_) {
          // Die Seite funktioniert auch ohne lokalen Speicher.
        }
      }

      function loadValues() {
        try {
          const currentRaw = localStorage.getItem(STORAGE_KEY);
          const legacyRaw = currentRaw
            || localStorage.getItem(PREVIOUS_STORAGE_KEY)
            || localStorage.getItem(OLDER_STORAGE_KEY)
            || localStorage.getItem(LEGACY_STORAGE_KEY)
            || localStorage.getItem(OLDEST_STORAGE_KEY)
            || localStorage.getItem(ANCIENT_STORAGE_KEY);
          const stored = JSON.parse(legacyRaw);
          if (!stored) {
            const initialCurrency = (() => {
              try { return localStorage.getItem(LIVE_TICKER_FIAT_KEY) === "EUR" ? "EUR" : "USD"; }
              catch (_) { return defaults.calculationCurrency; }
            })();
            activeCalculationCurrency = initialCurrency;
            setCalculationCurrency(initialCurrency, { convert: false });
            updateBitcoinAmountUnitUi();
            applyLiveBitcoinPrice();
            return;
          }

          const storedCurrency = stored.calculationCurrency === "USD"
            ? "USD"
            : stored.calculationCurrency === "EUR"
              ? "EUR"
              : defaults.calculationCurrency;
          activeCalculationCurrency = storedCurrency;
          const currencyRadio = form.querySelector(`input[name="calculationCurrency"][value="${storedCurrency}"]`);
          if (currencyRadio) currencyRadio.checked = true;
          updateCurrencyUnits();

          const model = ["constant", "decay", "powerLaw"].includes(stored.growthModel)
            ? stored.growthModel
            : defaults.growthModel;
          const radio = form.querySelector(`input[name="growthModel"][value="${model}"]`);
          if (radio) radio.checked = true;

          const calculationMode = ["fixed", "preserve", "safeRule"].includes(stored.calculationMode)
            ? stored.calculationMode
            : defaults.calculationMode;
          const modeRadio = form.querySelector(`input[name="calculationMode"][value="${calculationMode}"]`);
          if (modeRadio) modeRadio.checked = true;

          const monteCarloTargetGoal = stored.monteCarloTargetGoal === "preserveEnd" ? "preserveEnd" : defaults.monteCarloTargetGoal;
          const targetGoalRadio = form.querySelector(`input[name="monteCarloTargetGoal"][value="${monteCarloTargetGoal}"]`);
          if (targetGoalRadio) targetGoalRadio.checked = true;

          const amountUnit = stored.bitcoinAmountUnit === "sats" ? "sats" : "btc";
          const unitRadio = form.querySelector(`input[name="bitcoinAmountUnit"][value="${amountUnit}"]`);
          if (unitRadio) unitRadio.checked = true;
          updateBitcoinAmountUnitUi();

          if (stored.bitcoinAmount !== undefined && Number.isFinite(Number(stored.bitcoinAmount))) {
            const btcAmount = Number(stored.bitcoinAmount);
            bitcoinAmountInput.value = amountUnit === "sats"
              ? String(Math.round(btcAmount * SATS_PER_BTC))
              : trimDecimal(btcAmount);
          }

          bitcoinPriceIsManual = typeof stored.bitcoinPriceManual === "boolean"
            ? stored.bitcoinPriceManual
            : Number(stored.bitcoinPrice) > 0;

          if (typeof stored.monteCarloEnabled === "boolean") {
            document.getElementById("monteCarloEnabled").checked = stored.monteCarloEnabled;
          }

          Object.keys(defaults)
            .filter(key => ![
              "growthModel", "calculationMode", "monteCarloEnabled", "monteCarloTargetGoal",
              "bitcoinAmount", "bitcoinAmountUnit", "calculationCurrency",
              "bitcoinPriceManual"
            ].includes(key))
            .forEach(key => {
              if (key === "withdrawalStart") {
                if (/^\d{4}-\d{2}$/.test(stored[key] || "")) document.getElementById(key).value = stored[key];
                return;
              }
              if (stored[key] !== undefined && Number.isFinite(Number(stored[key]))) {
                document.getElementById(key).value = stored[key];
              }
            });

          if (!bitcoinPriceIsManual) applyLiveBitcoinPrice();
          updateLivePriceStatus();
          updateBitcoinAmountEquivalent();
        } catch (_) {
          activeCalculationCurrency = defaults.calculationCurrency;
          setCalculationCurrency(activeCalculationCurrency, { convert: false });
          updateBitcoinAmountUnitUi();
          applyLiveBitcoinPrice();
          // Ungültige oder nicht verfügbare gespeicherte Daten werden ignoriert.
        }
      }

      function runSimulation() {
        const values=getValues(); updateHero(values); updateModelUi(); if(!validate(values))return; let result;
        if(values.calculationMode==="preserve") { const comparison=calculatePreserveComparison(values),selected=comparison[values.growthModel]; result=selected.result; document.getElementById("calculatedWithdrawalValue").textContent=`${euroPrecise.format(selected.monthlyWithdrawal)} pro Monat`; document.getElementById("calculatedWithdrawalNote").textContent=`Berechnet für ${values.simulationYears} Rentenjahre ab ${formatDate(selected.result.startDate)}. Startstack: ${number.format(selected.result.startBitcoinAmount)} BTC · nominaler Mindestwert nach jedem Rentenmonat: ${euro.format(selected.targetPortfolio)}.`; renderPreserveComparison(comparison,values.growthModel); }
        else { result=simulate(values); if(values.calculationMode==="safeRule"){document.getElementById("safeWithdrawalValue").textContent=`${euroPrecise.format(result.initialMonthlyWithdrawal)} pro Monat`;document.getElementById("safeWithdrawalNote").textContent=`${percent.format(values.safeWithdrawalRate)} % von ${euro.format(result.startPortfolioValue)} im ersten Rentenjahr. Im letzten simulierten Rentenjahr beträgt die monatliche Entnahme ${euroPrecise.format(result.finalMonthlyWithdrawal)} bei ${percent.format(values.inflationRate)} % jährlicher Erhöhung.`;} }
        currentPortfolioHover = null; if (portfolioChartTooltip) portfolioChartTooltip.hidden = true; saveValues(values); renderSummary(result); renderTable(result); renderMonthly(result); drawChart(buildPortfolioTimeline(result));
        if(values.monteCarloEnabled)renderMonteCarlo(runMonteCarlo(values,result),values); else {currentMonteCarloData=null;document.getElementById("monteCarloPanel").hidden=true;}
      }

      form.querySelectorAll('input[name="bitcoinAmountUnit"]').forEach(input => {
        input.addEventListener("change", event => {
          const previousUnit = event.target.value === "sats" ? "btc" : "sats";
          updateBitcoinAmountUnitUi({ convertFrom: previousUnit });
          bitcoinAmountInput.classList.remove("invalid");
          updateHero(getValues());
          if (bitcoinAmountInput.value.trim() !== "") runSimulation();
        });
      });

      form.querySelectorAll('input[name="calculationCurrency"]').forEach(input => {
        input.addEventListener("change", event => {
          setCalculationCurrency(event.target.value, {
            convert: true,
            syncNavigation: true,
            run: true
          });
        });
      });

      bitcoinPriceInput.addEventListener("input", () => {
        bitcoinPriceIsManual = bitcoinPriceInput.value.trim() !== "";
        updateLivePriceStatus();
      });

      applyLiveBitcoinPriceButton.addEventListener("click", () => {
        applyLiveBitcoinPrice({ run: true });
      });

      document.addEventListener("bitcoin:live-update", event => {
        const bearEditorWasWaitingForRate = selectedCalculationCurrency() === "EUR" && !(bearEditorUsdToDisplayRatio > 0);
        if (event.detail?.prices) latestLivePrices = event.detail.prices;
        const navCurrency = event.detail?.fiat === "EUR" ? "EUR" : "USD";
        if (navCurrency !== selectedCalculationCurrency()) {
          setCalculationCurrency(navCurrency, { convert: true, syncNavigation: false, run: false });
        } else if (!bitcoinPriceIsManual) {
          applyLiveBitcoinPrice();
        }
        updateLivePriceStatus();
        if (bearEditorWasWaitingForRate && selectedCalculationCurrency() === "EUR" && bearBottomCurrencyRatioFromUsd("EUR") > 0) {
          renderBearBottomEditor();
          applyLiveHistoricalDefaultsToPage({ applyToInputs: false });
        }
        const values = getValues();
        if (values.bitcoinPrice > 0 && values.bitcoinAmount > 0 && values.simulationYears >= 1) {
          updateStartPreview(values);
        }
      });

      bitcoinAmountInput.addEventListener("input", updateBitcoinAmountEquivalent);

      form.addEventListener("submit", event => {
        event.preventDefault();
        runSimulation();
      });

      form.addEventListener("input", event => {
        if (event.target.matches("input") && event.target.name !== "bitcoinAmountUnit") {
          event.target.classList.remove("invalid");
          updateModelUi();
          updateHero(getValues());
        }
      });

      form.addEventListener("change", event => {
        if (event.target.matches('input[name="growthModel"], input[name="calculationMode"], input[name="monteCarloTargetGoal"], #monteCarloEnabled')) { updateModelUi(); runSimulation(); }
      });
      document.querySelectorAll("[data-safe-rate]").forEach(button=>button.addEventListener("click",()=>{document.getElementById("safeWithdrawalRate").value=button.dataset.safeRate;updateSafeRatePreset();updateModelUi();runSimulation();}));
      document.getElementById("safeWithdrawalRate").addEventListener("input",updateSafeRatePreset);
      document.getElementById("powerLawExponent").addEventListener("input",updatePowerLawImpact);
      document.getElementById("rerunMonteCarlo").addEventListener("click",()=>{const input=document.getElementById("monteCarloSeed"),seed=Math.max(1,Math.trunc(Number(input.value)||1));input.value=seed>=2147483646?1:seed+1;runSimulation();});

      bearBottomRowsElement.addEventListener("input", event => {
        if (!event.target.matches("[data-bear-field]")) return;
        clearTimeout(bearEditorTimer);
        bearEditorTimer = setTimeout(() => refreshBearBottomModel({ run: true }), 350);
      });

      bearBottomRowsElement.addEventListener("change", event => {
        if (!event.target.matches("[data-bear-field]")) return;
        clearTimeout(bearEditorTimer);
        refreshBearBottomModel({ run: true, reorder: true });
      });

      bearBottomRowsElement.addEventListener("click", event => {
        const button = event.target.closest("[data-remove-bear]");
        if (!button || bearMarketBottoms.length <= 3) return;
        bearMarketBottoms.splice(Number(button.dataset.removeBear), 1);
        renderBearBottomEditor();
        refreshBearBottomModel({ run: true, reorder: true });
      });

      addBearBottomButton.addEventListener("click", () => {
        if (!collectBearBottomsFromEditor()) return;
        const today = new Date(todayUtc()).toISOString().slice(0, 10);
        bearMarketBottoms.push({ label: `Boden ${bearMarketBottoms.length + 1}`, date: today, priceUsd: "" });
        renderBearBottomEditor();
        setBearBottomStatus(`Neuen Boden ergänzen: Datum und ${selectedCalculationCurrency()}-Schlusskurs eintragen.`);
        const lastPrice = bearBottomRowsElement.querySelector('.bear-bottom-row:last-child [data-bear-field="priceUsd"]');
        if (lastPrice) lastPrice.focus();
      });

      resetBearBottomsButton.addEventListener("click", () => {
        bearMarketBottoms = cloneDefaultBearBottoms();
        saveBearMarketBottoms();
        renderBearBottomEditor();
        applyLiveHistoricalDefaultsToPage({ applyToInputs: true });
        runSimulation();
      });

      applyHistoricalDefaultsButton.addEventListener("click", () => {
        applyLiveHistoricalDefaultsToPage({ applyToInputs: true });
        const decayRadio = form.querySelector('input[name="growthModel"][value="decay"]');
        if (decayRadio) decayRadio.checked = true;
        updateModelUi();
        runSimulation();
      });

      resetButton.addEventListener("click", () => {
        try { localStorage.removeItem(BEAR_BOTTOMS_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(PREVIOUS_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(OLDER_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(OLDEST_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(ANCIENT_STORAGE_KEY); } catch (_) {}
        window.location.reload();
      });

      let resizeTimer;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { drawChart(currentChartData); if (currentMonteCarloData) drawMonteCarloChart(currentMonteCarloData.percentiles); }, 100);
      });

      function initialisePanelScrollChaining() {
        const desktopLayout = window.matchMedia("(min-width: 821px)");
        const panels = document.querySelectorAll(".settings-panel, .results-scroll-panel");

        panels.forEach(panel => {
          panel.addEventListener("wheel", event => {
            if (!desktopLayout.matches || event.defaultPrevented) return;

            const scrollingUp = event.deltaY < 0;
            const panelAtTop = panel.scrollTop <= 1;
            const pageCanScrollUp = window.scrollY > 0;

            if (!scrollingUp || !panelAtTop || !pageCanScrollUp) return;

            // Chrome/Firefox liefern je nach Eingabegerät Pixel, Zeilen oder Seiten.
            const deltaMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? 16
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? window.innerHeight
                : 1;

            event.preventDefault();
            window.scrollBy({
              top: event.deltaY * deltaMultiplier,
              left: 0,
              behavior: "auto"
            });
          }, { passive: false });
        });
      }

      const withdrawalStartInput = document.getElementById("withdrawalStart");
      withdrawalStartInput.min = currentMonthValue();
      if (!withdrawalStartInput.value) withdrawalStartInput.value = defaults.withdrawalStart;

      const initialCurrencyRadio = form.querySelector(`input[name="calculationCurrency"][value="${defaults.calculationCurrency}"]`);
      if (initialCurrencyRadio) initialCurrencyRadio.checked = true;
      activeCalculationCurrency = defaults.calculationCurrency;
      updateCurrencyUnits();

      const cachedTicker = readLiveTickerCache();
      if (cachedTicker?.prices) latestLivePrices = cachedTicker.prices;

      initialisePortfolioChartInteraction();
      initialiseMonteCarloInteraction();
      initialisePanelScrollChaining();
      renderBearBottomEditor();
      applyLiveHistoricalDefaultsToPage({ applyToInputs: true });
      loadValues();
      updateModelUi();

      const initialValues = getValues();
      const hasInitialInputs = initialValues.bitcoinPrice > 0
        && initialValues.bitcoinAmount > 0
        && initialValues.simulationYears >= 1
        && (["preserve", "safeRule"].includes(initialValues.calculationMode) || initialValues.monthlyWithdrawal >= 0
          && document.getElementById("monthlyWithdrawal").value !== "");

      if (hasInitialInputs) {
        runSimulation();
      } else {
        form.querySelectorAll("input.invalid").forEach(input => input.classList.remove("invalid"));
        updateStartPreview(initialValues);
      }
    })();
