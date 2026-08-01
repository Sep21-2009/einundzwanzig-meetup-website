/**
 * Simuliert den Karten-Hover auf Geräten ohne echte Maus.
 *
 * Rechnerseite:
 * - Große Karten reagieren früh, sobald ihr oberer Bereich das Sichtfeld erreicht.
 * - Kleine Karten werden in einer ruhigen Zone um die Bildschirmmitte betont.
 * - Es wird kein translateY verwendet, damit Android-Browser beim Scrollen nicht flackern.
 *
 * Übrige Seiten:
 * - Der bisherige Fokus nahe der Bildschirmmitte bleibt erhalten.
 */
document.addEventListener("DOMContentLoaded", () => {
  const touchLikeDevice = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  if (!touchLikeDevice) return;

  const calculatorLargeCards = [...document.querySelectorAll(
    ".calculator-page .panel, .calculator-page .legal-callout"
  )];

  const calculatorSmallCards = [...document.querySelectorAll(
    ".calculator-page .metric, .calculator-page .comparison-card, .calculator-page .historical-value, .calculator-page .method-stat"
  )];

  calculatorLargeCards.forEach((card) => card.classList.add("touch-large-card"));
  calculatorSmallCards.forEach((card) => card.classList.add("touch-small-card"));

  const genericCards = [...document.querySelectorAll(
    ".feature-card, .info-card, .step-card, .screen-card, .callout, .social-link"
  )].filter((card) => !card.closest(".calculator-page"));

  if ("IntersectionObserver" in window) {
    /*
     * Untere Root-Margin: Eine große Karte wird bereits aktiv, wenn ihr oberer
     * Rand ungefähr in die unteren 82 % des Bildschirms eintritt. Bei sehr hohen
     * Karten bleibt der Effekt dadurch nicht bis zur Kartenmitte aus.
     */
    const largeObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("in-view", entry.isIntersecting);
      });
    }, {
      root: null,
      rootMargin: "0px 0px -18% 0px",
      threshold: 0.02
    });

    calculatorLargeCards.forEach((card) => largeObserver.observe(card));

    /*
     * Kleine Rechnerkarten: immer nur eine Karte gleichzeitig. Da sie auf dem
     * Smartphone untereinander stehen, gibt es keine Gleichstände zwischen zwei
     * Karten einer Zeile mehr. Der Verzicht auf transform verhindert zusätzlich
     * das bisherige Aufblitzen beim Wechsel.
     */
    let activeSmallCard = null;
    let smallTicking = false;

    const updateSmallCard = () => {
      const focusY = window.innerHeight * 0.48;
      let closest = null;
      let closestDistance = Number.POSITIVE_INFINITY;

      calculatorSmallCards.forEach((card) => {
        if (card.hidden || card.offsetParent === null) return;
        const rect = card.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;

        const center = rect.top + rect.height / 2;
        const distance = Math.abs(center - focusY);
        if (distance < closestDistance) {
          closest = card;
          closestDistance = distance;
        }
      });

      const maxDistance = window.innerHeight * 0.42;
      const next = closestDistance <= maxDistance ? closest : null;

      if (next !== activeSmallCard) {
        activeSmallCard?.classList.remove("in-view");
        next?.classList.add("in-view");
        activeSmallCard = next;
      }

      smallTicking = false;
    };

    const requestSmallUpdate = () => {
      if (smallTicking) return;
      smallTicking = true;
      window.requestAnimationFrame(updateSmallCard);
    };

    window.addEventListener("scroll", requestSmallUpdate, { passive: true });
    window.addEventListener("resize", requestSmallUpdate);
    window.addEventListener("orientationchange", requestSmallUpdate);

    const calculatorRoot = document.querySelector(".calculator-page");
    if (calculatorRoot && "MutationObserver" in window) {
      new MutationObserver(requestSmallUpdate).observe(calculatorRoot, {
        subtree: true,
        attributes: true,
        attributeFilter: ["hidden", "style", "class"]
      });
    }

    requestSmallUpdate();

    const genericObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("in-view", entry.isIntersecting);
      });
    }, {
      root: null,
      rootMargin: "-30% 0px -30% 0px",
      threshold: 0.04
    });

    genericCards.forEach((card) => genericObserver.observe(card));
    return;
  }

  /* Fallback für ältere Browser ohne IntersectionObserver. */
  const allCards = [...calculatorLargeCards, ...calculatorSmallCards, ...genericCards];
  if (!allCards.length) return;

  let ticking = false;
  const updateFocusedCards = () => {
    const viewportHeight = window.innerHeight;
    const viewportCenter = viewportHeight / 2;

    calculatorLargeCards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const active = rect.bottom > 0 && rect.top < viewportHeight * 0.82;
      card.classList.toggle("in-view", active);
    });

    [...calculatorSmallCards, ...genericCards].forEach((card) => {
      const rect = card.getBoundingClientRect();
      const cardCenter = rect.top + rect.height / 2;
      const active = rect.bottom > viewportHeight * 0.25 &&
        rect.top < viewportHeight * 0.75 &&
        Math.abs(cardCenter - viewportCenter) < viewportHeight * 0.36;
      card.classList.toggle("in-view", active);
    });

    ticking = false;
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(updateFocusedCards);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  window.addEventListener("orientationchange", requestUpdate);
  requestUpdate();
});
