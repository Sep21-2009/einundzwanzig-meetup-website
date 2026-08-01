/**
 * Navigation und Dropdowns.
 * Desktop: Dropdown schließt mit kurzer Verzögerung.
 * Mobil: Navigation wird über den Menüknopf ein- und ausgeblendet.
 */
document.addEventListener("includes:loaded", () => {
  markCurrentPage();
  initialiseMobileMenu();
  initialiseDropdowns();
});

function markCurrentPage() {
  const currentPage = location.pathname.split("/").pop() || "index.html";

  document.querySelectorAll(".page-link[data-page], .page-link[data-pages]").forEach((link) => {
    const pages = link.dataset.pages
      ? link.dataset.pages.split(",").map((page) => page.trim()).filter(Boolean)
      : [link.dataset.page];
    const isCurrentPage = pages.includes(currentPage);
    link.classList.toggle("active", isCurrentPage);

    if (isCurrentPage) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function initialiseMobileMenu() {
  const menuButton = document.querySelector(".menu-toggle");
  const navigation = document.querySelector(".main-nav");

  if (!menuButton || !navigation) return;

  menuButton.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      navigation.classList.remove("open");
      menuButton.setAttribute("aria-expanded", "false");
    });
  });
}

function initialiseDropdowns() {
  const groups = Array.from(document.querySelectorAll(".nav-group"));
  const desktopPointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const CLOSE_DELAY_MS = 650;

  function closeAll(except = null) {
    groups.forEach((group) => {
      if (group !== except) group.removeAttribute("open");
    });
  }

  groups.forEach((group) => {
    let closeTimer = null;

    function cancelScheduledClose() {
      if (closeTimer === null) return;
      window.clearTimeout(closeTimer);
      closeTimer = null;
    }

    function scheduleClose() {
      cancelScheduledClose();
      closeTimer = window.setTimeout(() => {
        group.removeAttribute("open");
        closeTimer = null;
      }, CLOSE_DELAY_MS);
    }

    group.querySelector("summary")?.addEventListener("click", () => closeAll(group));
    group.addEventListener("mouseenter", cancelScheduledClose);
    group.addEventListener("mouseleave", () => {
      if (desktopPointer.matches) scheduleClose();
    });

    group.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        cancelScheduledClose();
        group.removeAttribute("open");
      });
    });
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".nav-group")) closeAll();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    closeAll();
    document.querySelector(".menu-toggle")?.focus();
  });
}

/**
 * Hält die Navigation beim Scrollen kompakt und gut erkennbar.
 * Gleichzeitig werden offene Dropdowns und das mobile Menü geschlossen,
 * damit sie den Seiteninhalt beim Scrollen nicht verdecken.
 */
document.addEventListener("includes:loaded", () => {
  initialiseStickyHeader();
});

function initialiseStickyHeader() {
  const header = document.querySelector(".site-header");
  const navigation = document.querySelector(".main-nav");
  const menuButton = document.querySelector(".menu-toggle");
  const groups = Array.from(document.querySelectorAll(".nav-group"));
  const mobileNavigation = window.matchMedia("(max-width: 900px), (hover: none), (pointer: coarse)");

  if (!header) return;

  let previousScrollY = window.scrollY;
  let framePending = false;

  function updateHeader() {
    const currentScrollY = window.scrollY;
    header.classList.toggle("scrolled", currentScrollY > 18);

    /*
     * Auf Smartphones bleiben das Hauptmenü und geöffnete Untermenüs bewusst
     * offen. Das Aufklappen eines <details>-Menüs verändert die Seitenhöhe und
     * kann selbst einen kleinen Scrollimpuls auslösen. Früher wurde "Direkt zu"
     * dadurch unmittelbar wieder geschlossen. Auf Desktop bleibt das bisherige
     * automatische Schließen beim echten Scrollen erhalten.
     */
    if (!mobileNavigation.matches && Math.abs(currentScrollY - previousScrollY) > 2) {
      groups.forEach((group) => group.removeAttribute("open"));

      if (navigation?.classList.contains("open")) {
        navigation.classList.remove("open");
        menuButton?.setAttribute("aria-expanded", "false");
      }
    }

    previousScrollY = currentScrollY;
    framePending = false;
  }

  updateHeader();

  window.addEventListener(
    "scroll",
    () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateHeader);
    },
    { passive: true }
  );
}
