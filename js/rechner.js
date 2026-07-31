(() => {
      "use strict";

      const STORAGE_KEY = "bitcoin-retirement-calculator-v10-manual-bottoms";
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
        annualRate: 21,
        decayStartRate: 35.0,
        decayReduction: 8.8,
        decayFloor: 8,
        powerLawExponent: 5.8451542,
        monthlyWithdrawal: "",
        simulationYears: "",
        withdrawalStart: currentMonthValue()
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
      let currentChartData = [];
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
          return { valid: false, message: "Bitte für jeden Boden ein gültiges Datum und einen Preis größer als 0 USD eintragen.", bottoms: normalized };
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
        bearBottomRowsElement.innerHTML = bearMarketBottoms.map((item, index) => `
          <div class="bear-bottom-row" data-bear-index="${index}">
            <span class="bear-bottom-index">Boden ${index + 1}</span>
            <label>Datum
              <input type="date" data-bear-field="date" value="${item.date || ""}" aria-label="Datum von Boden ${index + 1}">
            </label>
            <label>Preis in USD
              <input type="number" data-bear-field="priceUsd" value="${item.priceUsd || ""}" min="0.01" step="0.01" inputmode="decimal" aria-label="USD-Preis von Boden ${index + 1}">
            </label>
            <button class="bear-bottom-remove" type="button" data-remove-bear="${index}" ${bearMarketBottoms.length <= 3 ? "disabled" : ""} aria-label="Boden ${index + 1} entfernen">×</button>
          </div>
        `).join("");
        document.getElementById("bottomCountLabel").textContent = `${bearMarketBottoms.length} ${bearMarketBottoms.length === 1 ? "Boden" : "Böden"}`;
      }

      function collectBearBottomsFromEditor() {
        bearMarketBottoms = [...bearBottomRowsElement.querySelectorAll(".bear-bottom-row")].map((row, index) => ({
          label: `Boden ${index + 1}`,
          date: row.querySelector('[data-bear-field="date"]').value,
          priceUsd: row.querySelector('[data-bear-field="priceUsd"]').value
        }));
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
        collectBearBottomsFromEditor();
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

      const euro = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0
      });

      const euroPrecise = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      const number = new Intl.NumberFormat("de-DE", {
        maximumFractionDigits: 8
      });

      const percent = new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      });

      const compactEuro = new Intl.NumberFormat("de-DE", {
        style: "currency",
        currency: "EUR",
        notation: "compact",
        maximumFractionDigits: 1
      });

      function readValue(id) {
        return Number(document.getElementById(id).value);
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
          bitcoinAmount: readValue("bitcoinAmount"),
          annualRate: readValue("annualRate"),
          decayStartRate: readValue("decayStartRate"),
          decayReduction: readValue("decayReduction"),
          decayFloor: readValue("decayFloor"),
          powerLawExponent: readValue("powerLawExponent"),
          monthlyWithdrawal: readValue("monthlyWithdrawal"),
          simulationYears: Math.trunc(readValue("simulationYears")),
          withdrawalStart: document.getElementById("withdrawalStart").value
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
          simulationYears: values.simulationYears >= 1 && values.simulationYears <= 100
        };

        if (values.calculationMode === "fixed") {
          commonRules.monthlyWithdrawal = values.monthlyWithdrawal >= 0;
        } else {
          document.getElementById("monthlyWithdrawal").classList.remove("invalid");
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

        if (values.calculationMode === "fixed") {
          const parsedStart = parseWithdrawalStart(values.withdrawalStart);
          const currentMonthStart = (() => {
            const now = new Date();
            return Date.UTC(now.getFullYear(), now.getMonth(), 1);
          })();
          if (!setInvalid("withdrawalStart", !(Number.isFinite(parsedStart) && parsedStart >= currentMonthStart))) valid = false;
        } else {
          document.getElementById("withdrawalStart").classList.remove("invalid");
        }

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

      function simulate(values, options = {}) {
        const startDate = Number.isFinite(options.startDate)
          ? options.startDate
          : parseWithdrawalStart(values.withdrawalStart);
        const monthlyWithdrawal = Number.isFinite(options.monthlyWithdrawal)
          ? options.monthlyWithdrawal
          : values.monthlyWithdrawal;
        const startPrice = priceAtDate(values, startDate);
        const totalMonths = values.simulationYears * 12;
        let bitcoinAmount = values.bitcoinAmount;
        let totalWithdrawn = 0;
        let totalWithdrawnBtc = 0;
        let depletedAt = null;
        let currentYearRow = null;
        const monthly = [];
        const yearly = [];

        for (let monthIndex = 0; monthIndex < totalMonths; monthIndex++) {
          const withdrawalDate = addUtcMonthsClamped(startDate, monthIndex);
          const nextDate = addUtcMonthsClamped(startDate, monthIndex + 1);
          const year = new Date(withdrawalDate).getUTCFullYear();
          const month = new Date(withdrawalDate).getUTCMonth() + 1;
          const withdrawalPrice = priceAtDate(values, withdrawalDate);

          if (!currentYearRow || currentYearRow.year !== year) {
            if (currentYearRow) yearly.push(currentYearRow);
            currentYearRow = {
              year,
              bitcoinPrice: withdrawalPrice,
              bitcoinAmount,
              portfolioValue: bitcoinAmount * withdrawalPrice,
              annualReturn: 0,
              withdrawnThisYear: 0,
              yearStartPrice: withdrawalPrice
            };
          }

          const requestedWithdrawalBtc = monthlyWithdrawal / withdrawalPrice;
          const withdrawalBtc = Math.min(requestedWithdrawalBtc, bitcoinAmount);
          const actualWithdrawalEur = withdrawalBtc * withdrawalPrice;
          bitcoinAmount -= withdrawalBtc;
          totalWithdrawn += actualWithdrawalEur;
          totalWithdrawnBtc += withdrawalBtc;
          currentYearRow.withdrawnThisYear += actualWithdrawalEur;

          if (bitcoinAmount <= 1e-12 && monthlyWithdrawal > 0) {
            bitcoinAmount = 0;
            depletedAt = { year, month, dateMs: withdrawalDate };
            monthly.push({
              year,
              month,
              dateMs: withdrawalDate,
              bitcoinPrice: withdrawalPrice,
              bitcoinAmount: 0,
              portfolioValue: 0,
              withdrawalBtc
            });
            currentYearRow.bitcoinPrice = withdrawalPrice;
            currentYearRow.bitcoinAmount = 0;
            currentYearRow.portfolioValue = 0;
            currentYearRow.annualReturn = currentYearRow.yearStartPrice > 0
              ? (withdrawalPrice / currentYearRow.yearStartPrice - 1) * 100
              : 0;
            break;
          }

          const closingPrice = priceAtDate(values, nextDate);
          const portfolioValue = bitcoinAmount * closingPrice;
          monthly.push({
            year,
            month,
            dateMs: withdrawalDate,
            bitcoinPrice: closingPrice,
            bitcoinAmount,
            portfolioValue,
            withdrawalBtc
          });

          currentYearRow.bitcoinPrice = closingPrice;
          currentYearRow.bitcoinAmount = bitcoinAmount;
          currentYearRow.portfolioValue = portfolioValue;
          currentYearRow.annualReturn = currentYearRow.yearStartPrice > 0
            ? (closingPrice / currentYearRow.yearStartPrice - 1) * 100
            : 0;
        }

        if (currentYearRow) yearly.push(currentYearRow);

        const last = monthly.at(-1) || {
          bitcoinPrice: startPrice,
          bitcoinAmount: values.bitcoinAmount,
          portfolioValue: startPrice * values.bitcoinAmount
        };

        return {
          values,
          monthlyWithdrawal,
          monthly,
          yearly,
          depletedAt,
          totalWithdrawn,
          totalWithdrawnBtc,
          startDate,
          startPrice,
          finalPrice: last.bitcoinPrice,
          finalBitcoinAmount: last.bitcoinAmount,
          finalPortfolioValue: last.portfolioValue
        };
      }

      function calculatePreservingWithdrawal(values) {
        const startDate = todayUtc();
        const targetPortfolio = values.bitcoinAmount * values.bitcoinPrice;
        const tolerance = Math.max(0.01, targetPortfolio * 1e-10);

        const preservesCapital = monthlyWithdrawal => {
          const result = simulate(values, { startDate, monthlyWithdrawal });
          if (result.depletedAt || result.monthly.length !== values.simulationYears * 12) return false;
          return result.monthly.every(row => row.portfolioValue + tolerance >= targetPortfolio);
        };

        if (!preservesCapital(0)) {
          return {
            monthlyWithdrawal: 0,
            targetPortfolio,
            result: simulate(values, { startDate, monthlyWithdrawal: 0 })
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
          result: simulate(values, { startDate, monthlyWithdrawal })
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
          document.getElementById(subId).textContent = `Nach ${item.result.values.simulationYears} Jahren: ${euro.format(item.result.finalPortfolioValue)} Portfolio`;
        });

        document.querySelectorAll("[data-comparison-model]").forEach(card => {
          card.classList.toggle("is-active", card.dataset.comparisonModel === activeModel);
        });
      }

      function renderSummary(result) {
        const statusCard = document.getElementById("statusCard");
        const statusValue = document.getElementById("statusValue");
        const statusSub = document.getElementById("statusSub");

        statusCard.classList.remove("status-ok", "status-bad");

        if (result.values.calculationMode === "preserve") {
          const startPortfolio = result.values.bitcoinAmount * result.values.bitcoinPrice;
          const capitalPreserved = result.monthly.every(row => row.portfolioValue + Math.max(0.01, startPortfolio * 1e-10) >= startPortfolio);
          statusCard.classList.add(capitalPreserved ? "status-ok" : "status-bad");
          statusValue.textContent = capitalPreserved ? "Kapital erhalten" : "Kapital sinkt";
          statusSub.textContent = `Nominaler Mindestwert: ${euro.format(startPortfolio)} · Entnahmen ab heute`;
        } else if (result.depletedAt) {
          const date = formatDate(result.depletedAt.dateMs);
          statusCard.classList.add("status-bad");
          statusValue.textContent = "Aufgebraucht";
          statusSub.textContent = `Der Bestand reicht bis ${date}`;
        } else {
          statusCard.classList.add("status-ok");
          statusValue.textContent = "Bestand reicht";
          statusSub.textContent = `Entnahmen ab ${formatDate(result.startDate)} · Startpreis ${euro.format(result.startPrice)}`;
        }

        const remainingShare = result.finalBitcoinAmount / result.values.bitcoinAmount * 100;
        if (result.values.calculationMode === "preserve") {
          document.getElementById("remainingMetricLabel").textContent = "Monatlich möglich";
          document.getElementById("remainingBtc").textContent = euroPrecise.format(result.monthlyWithdrawal);
          document.getElementById("btcShare").textContent = `Restbestand: ${number.format(result.finalBitcoinAmount)} BTC`;
        } else {
          document.getElementById("remainingMetricLabel").textContent = "Restbestand";
          document.getElementById("remainingBtc").textContent = `${number.format(result.finalBitcoinAmount)} BTC`;
          document.getElementById("btcShare").textContent = `${Math.max(0, remainingShare).toFixed(1).replace(".", ",")} % des Startbestands`;
        }
        document.getElementById("portfolioValue").textContent = euro.format(result.finalPortfolioValue);
        document.getElementById("endPrice").textContent = `BTC-Preis am Ende: ${euro.format(result.finalPrice)}`;
        document.getElementById("totalWithdrawn").textContent = euro.format(result.totalWithdrawn);
        document.getElementById("withdrawnBtc").textContent = result.values.calculationMode === "preserve"
          ? `${euroPrecise.format(result.monthlyWithdrawal)} pro Monat · ${number.format(result.totalWithdrawnBtc)} BTC verkauft`
          : `entspricht ${number.format(result.totalWithdrawnBtc)} BTC`;
        document.getElementById("activeModelBadge").textContent = modelName(result.values.growthModel);
      }

      function renderTable(result) {
        const body = document.getElementById("yearTableBody");
        body.innerHTML = result.yearly.map(row => `
          <tr>
            <td>${row.year}</td>
            <td>${euro.format(row.bitcoinPrice)}</td>
            <td>${number.format(row.bitcoinAmount)} BTC</td>
            <td>${euro.format(row.portfolioValue)}</td>
            <td>${percent.format(row.annualReturn)} %</td>
            <td>${euro.format(row.withdrawnThisYear)}</td>
          </tr>
        `).join("");

        if (!result.yearly.length) {
          body.innerHTML = '<tr><td colspan="6">Keine Jahreswerte verfügbar.</td></tr>';
        }
      }

      function renderMonthly(result) {
        const log = document.getElementById("monthlyLog");
        log.innerHTML = result.monthly.map(row => `
          <div class="monthly-row">
            <span>${formatDate(row.dateMs)}</span>
            <span>${euroPrecise.format(row.bitcoinPrice)}</span>
            <span>${number.format(row.bitcoinAmount)} BTC</span>
            <span>${euroPrecise.format(row.portfolioValue)}</span>
          </div>
        `).join("");
      }

      function renderHistory(metrics = bearBottomDecayMetrics(Number(document.getElementById("decayFloor")?.value) || 8)) {
        const body = document.getElementById("historyTableBody");
        const usd = new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: 0
        });
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
              <td>${usd.format(row.start.priceUsd)}</td>
              <td>${usd.format(row.end.priceUsd)}</td>
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
        currentChartData = data;
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = rect.width;
        const height = rect.height;
        ctx.clearRect(0, 0, width, height);

        if (!data.length) return;

        const compactLayout = width < 500;
        const padding = compactLayout
          ? { top: 20, right: 46, bottom: 40, left: 56 }
          : { top: 25, right: 62, bottom: 42, left: 72 };
        const plotW = width - padding.left - padding.right;
        const plotH = height - padding.top - padding.bottom;
        const maxPortfolio = niceMax(Math.max(...data.map(d => d.portfolioValue)) * 1.05);
        const maxBtc = niceMax(Math.max(...data.map(d => d.bitcoinAmount)) * 1.05);

        const x = index => padding.left + (data.length === 1 ? plotW / 2 : index / (data.length - 1) * plotW);
        const yPortfolio = value => padding.top + plotH - (value / maxPortfolio) * plotH;
        const yBtc = value => padding.top + plotH - (value / maxBtc) * plotH;

        ctx.font = `${compactLayout ? 9 : 12}px Inter, system-ui, sans-serif`;
        ctx.lineWidth = 1;

        for (let i = 0; i <= 4; i++) {
          const y = padding.top + (plotH / 4) * i;
          const portfolioLabel = maxPortfolio * (1 - i / 4);
          const btcLabel = maxBtc * (1 - i / 4);

          ctx.beginPath();
          ctx.strokeStyle = "rgba(255,255,255,0.075)";
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.stroke();

          ctx.fillStyle = "#8f99ab";
          ctx.textAlign = "right";
          ctx.textBaseline = "middle";
          ctx.fillText(compactEuro.format(portfolioLabel), padding.left - 10, y);
          ctx.textAlign = "left";
          ctx.fillText(`${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(btcLabel)} BTC`, width - padding.right + 10, y);
        }

        const desiredLabels = compactLayout ? 3 : 7;
        const labelStep = Math.max(1, Math.ceil((data.length - 1) / Math.max(1, desiredLabels - 1)));
        data.forEach((item, index) => {
          if (index % labelStep !== 0 && index !== data.length - 1) return;
          ctx.fillStyle = "#8f99ab";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(String(item.year), x(index), height - padding.bottom + 14);
        });

        const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        gradient.addColorStop(0, "rgba(247,147,26,0.32)");
        gradient.addColorStop(1, "rgba(247,147,26,0.01)");

        ctx.beginPath();
        data.forEach((item, index) => {
          const px = x(index);
          const py = yPortfolio(item.portfolioValue);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.lineTo(x(data.length - 1), padding.top + plotH);
        ctx.lineTo(x(0), padding.top + plotH);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        data.forEach((item, index) => {
          const px = x(index);
          const py = yPortfolio(item.portfolioValue);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = "#f7931a";
        ctx.lineWidth = 3;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();

        ctx.beginPath();
        data.forEach((item, index) => {
          const px = x(index);
          const py = yBtc(item.bitcoinAmount);
          if (index === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = "#62a8ff";
        ctx.lineWidth = 2.2;
        ctx.setLineDash([7, 7]);
        ctx.stroke();
        ctx.setLineDash([]);

        data.forEach((item, index) => {
          if (index !== 0 && index !== data.length - 1) return;
          ctx.beginPath();
          ctx.arc(x(index), yPortfolio(item.portfolioValue), 4.5, 0, Math.PI * 2);
          ctx.fillStyle = "#f7931a";
          ctx.fill();
        });
      }

      function updateHero(values) {
        const heroWithdrawal = document.getElementById("heroWithdrawal");
        const heroYears = document.getElementById("heroYears");
        if (heroWithdrawal) heroWithdrawal.textContent = euro.format(values.monthlyWithdrawal);
        if (heroYears) heroYears.textContent = `${values.simulationYears} ${values.simulationYears === 1 ? "Jahr" : "Jahre"}`;
      }

      function updateStartPreview(values) {
        const preview = document.getElementById("startPreview");
        if (values.calculationMode === "preserve") {
          preview.textContent = "Im Modus Kapitalerhalt beginnen die berechneten Entnahmen immer heute.";
          return;
        }
        const startDate = parseWithdrawalStart(values.withdrawalStart);
        if (!Number.isFinite(startDate) || !(values.bitcoinPrice > 0)) {
          preview.textContent = "Bitte einen gültigen Entnahmestart auswählen.";
          return;
        }

        const waitDays = Math.max(0, (startDate - todayUtc()) / DAY_MS);
        const startPrice = priceAtDate(values, startDate);
        if (!Number.isFinite(startPrice)) {
          preview.textContent = "Bitte die Modellwerte prüfen.";
          return;
        }
        if (waitDays < 1) {
          preview.textContent = `Die Entnahmen beginnen heute. Modellpreis zum Start: ${euro.format(startPrice)}.`;
          return;
        }

        const waitYears = waitDays / YEAR_DAYS;
        const duration = waitYears >= 1
          ? `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(waitYears)} Jahre`
          : `${Math.round(waitDays)} Tage`;
        preview.textContent = `Wartezeit: ${duration}. Der heutige Preis von ${euro.format(values.bitcoinPrice)} wird bis ${formatDate(startDate)} auf ${euro.format(startPrice)} fortgeschrieben. Vorher erfolgen keine Entnahmen.`;
      }

      function updateModelUi() {
        const model = selectedModel();
        const calculationMode = selectedCalculationMode();
        document.querySelectorAll("[data-model-fields]").forEach(group => {
          group.hidden = group.dataset.modelFields !== model;
        });

        const preserveMode = calculationMode === "preserve";
        document.getElementById("fixedWithdrawalField").hidden = preserveMode;
        document.getElementById("withdrawalStartField").hidden = preserveMode;
        document.getElementById("calculatedWithdrawalBox").hidden = !preserveMode;
        document.getElementById("preserveComparison").hidden = !preserveMode;
        document.getElementById("submitButton").textContent = preserveMode ? "Entnahme berechnen" : "Simulation starten";

        const texts = {
          constant: "Modellannahme: Der eingegebene BTC-Preis gilt für heute. Er wächst bereits bis zum gewählten Entnahmestart mit der konstanten Jahresrendite weiter. Erst danach beginnen die monatlichen Entnahmen. Keine Finanzberatung oder Kursprognose; Steuern, Inflation und Gebühren sind nicht berücksichtigt.",
          decay: "Modellannahme: Der eingegebene BTC-Preis gilt für heute. Die aus Bärenmarkt-Böden abgeleitete Renditekurve läuft bereits während der Wartezeit bis zum Entnahmestart. Die Abschwächung ist hyperbolisch: Sie beträgt im ersten Jahr den eingestellten Wert und wird danach automatisch kleiner. Erst danach beginnen die monatlichen Entnahmen. Keine Finanzberatung oder Kursprognose; Steuern, Inflation und Gebühren sind nicht berücksichtigt.",
          powerLaw: "Modellannahme: Der eingegebene BTC-Preis gilt für heute. Die relative Entwicklung folgt dem eingestellten Power-Law-Exponenten und wird bis zum gewählten Entnahmestart fortgeschrieben; erst dann beginnen die Entnahmen. Das Modell ist am heutigen Marktpreis verankert. Keine Finanzberatung oder Kursgarantie; Steuern, Inflation und Gebühren sind nicht berücksichtigt."
        };
        document.getElementById("assumptionText").textContent = preserveMode
          ? `Kapitalerhalt-Modus mit ${modelName(model)}: Berechnet wird der maximale feste Monatsbetrag ab heute, bei dem der nominale Portfolio-Wert nach jedem Simulationsmonat mindestens dem heutigen Ausgangswert entspricht. Zwischenzeitliche reale Kursschwankungen, Inflation, Steuern und Gebühren sind nicht berücksichtigt. Keine Finanzberatung oder Kursprognose.`
          : texts[model];
        updateStartPreview(getValues());
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
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
          if (!stored) return;

          const model = ["constant", "decay", "powerLaw"].includes(stored.growthModel)
            ? stored.growthModel
            : defaults.growthModel;
          const radio = form.querySelector(`input[name="growthModel"][value="${model}"]`);
          if (radio) radio.checked = true;

          const calculationMode = ["fixed", "preserve"].includes(stored.calculationMode)
            ? stored.calculationMode
            : defaults.calculationMode;
          const modeRadio = form.querySelector(`input[name="calculationMode"][value="${calculationMode}"]`);
          if (modeRadio) modeRadio.checked = true;

          Object.keys(defaults).filter(key => !["growthModel", "calculationMode"].includes(key)).forEach(key => {
            if (key === "withdrawalStart") {
              if (/^\d{4}-\d{2}$/.test(stored[key] || "")) {
                document.getElementById(key).value = stored[key];
              }
              return;
            }
            if (Number.isFinite(Number(stored[key]))) {
              document.getElementById(key).value = stored[key];
            }
          });
        } catch (_) {
          // Ungültige oder nicht verfügbare gespeicherte Daten werden ignoriert.
        }
      }

      function runSimulation() {
        const values = getValues();
        updateHero(values);
        updateModelUi();
        if (!validate(values)) return;

        let result;
        if (values.calculationMode === "preserve") {
          const comparison = calculatePreserveComparison(values);
          const selected = comparison[values.growthModel];
          result = selected.result;
          document.getElementById("calculatedWithdrawalValue").textContent = `${euroPrecise.format(selected.monthlyWithdrawal)} pro Monat`;
          document.getElementById("calculatedWithdrawalNote").textContent = `Berechnet für ${values.simulationYears} Jahre ab heute. Mindestwert nach jedem Monat: ${euro.format(selected.targetPortfolio)}.`;
          renderPreserveComparison(comparison, values.growthModel);
        } else {
          result = simulate(values);
        }

        saveValues(values);
        renderSummary(result);
        renderTable(result);
        renderMonthly(result);
        drawChart(result.yearly);
      }

      form.addEventListener("submit", event => {
        event.preventDefault();
        runSimulation();
      });

      form.addEventListener("input", event => {
        if (event.target.matches("input")) {
          event.target.classList.remove("invalid");
          updateModelUi();
          updateHero(getValues());
        }
      });

      form.addEventListener("change", event => {
        if (event.target.matches('input[name="growthModel"], input[name="calculationMode"]')) {
          updateModelUi();
          runSimulation();
        }
      });

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
        collectBearBottomsFromEditor();
        const today = new Date(todayUtc()).toISOString().slice(0, 10);
        bearMarketBottoms.push({ label: `Boden ${bearMarketBottoms.length + 1}`, date: today, priceUsd: "" });
        renderBearBottomEditor();
        setBearBottomStatus("Neuen Boden ergänzen: Datum und USD-Schlusskurs eintragen.");
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
        window.location.reload();
      });

      let resizeTimer;
      window.addEventListener("resize", () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => drawChart(currentChartData), 100);
      });

      const withdrawalStartInput = document.getElementById("withdrawalStart");
      withdrawalStartInput.min = currentMonthValue();
      if (!withdrawalStartInput.value) withdrawalStartInput.value = defaults.withdrawalStart;

      renderBearBottomEditor();
      applyLiveHistoricalDefaultsToPage({ applyToInputs: true });
      loadValues();
      updateModelUi();

      const initialValues = getValues();
      const hasInitialInputs = initialValues.bitcoinPrice > 0
        && initialValues.bitcoinAmount > 0
        && initialValues.simulationYears >= 1
        && (initialValues.calculationMode === "preserve" || initialValues.monthlyWithdrawal >= 0
          && document.getElementById("monthlyWithdrawal").value !== "");

      if (hasInitialInputs) {
        runSimulation();
      } else {
        form.querySelectorAll("input.invalid").forEach(input => input.classList.remove("invalid"));
        updateStartPreview(initialValues);
      }
    })();
