/**
 * Gemeinsame Navigation für alle Seiten.
 * Funktioniert sowohl mit statisch eingebetteter Navigation als auch nach
 * einem späteren Komponenten-Reload. Jede Navigation wird nur einmal initialisiert.
 */
(() => {
  "use strict";

  function initialiseNavigation() {
    const header = document.querySelector(".site-header");
    if (!header || header.dataset.navigationInitialised === "true") return;
    header.dataset.navigationInitialised = "true";

    markCurrentPage();
    initialiseMobileMenu();
    initialiseDropdowns();
    initialiseAndroidDataSourceSettings();
    initialiseStickyHeader();
  }

  function initialiseAndroidDataSourceSettings() {
    const link = document.getElementById("appDataSourceSettings");
    if (!link) return;

    const bridgeAvailable = window.AndroidApp
      && typeof window.AndroidApp.openDataSourceSettings === "function";
    if (!bridgeAvailable) return;

    link.hidden = false;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.AndroidApp.openDataSourceSettings();
    });
  }

  function markCurrentPage() {
    const currentPage = location.pathname.split("/").pop() || "index.html";

    document.querySelectorAll(".page-link[data-page], .page-link[data-pages]").forEach((link) => {
      const pages = link.dataset.pages
        ? link.dataset.pages.split(",").map((page) => page.trim()).filter(Boolean)
        : [link.dataset.page];
      const isCurrentPage = pages.includes(currentPage);
      link.classList.toggle("active", isCurrentPage);

      if (isCurrentPage) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
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
    const closeDelayMs = 650;

    function closeAll(except = null) {
      groups.forEach((group) => {
        if (group !== except) group.removeAttribute("open");
      });
    }

    groups.forEach((group) => {
      let closeTimer = null;

      const cancelScheduledClose = () => {
        if (closeTimer === null) return;
        window.clearTimeout(closeTimer);
        closeTimer = null;
      };

      const scheduleClose = () => {
        cancelScheduledClose();
        closeTimer = window.setTimeout(() => {
          group.removeAttribute("open");
          closeTimer = null;
        }, closeDelayMs);
      };

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
      header.classList.toggle("scrolled", currentScrollY > 48);

      // Auf Touch-Geräten bleiben geöffnete Menüs auch bei kleinen Scrollimpulsen offen.
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
    window.addEventListener("scroll", () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateHeader);
    }, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiseNavigation, { once: true });
  } else {
    initialiseNavigation();
  }

  document.addEventListener("includes:loaded", initialiseNavigation);
  document.addEventListener("components:loaded", initialiseNavigation);
})();
