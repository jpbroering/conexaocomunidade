"use strict";
(() => {
  const buttons = new WeakMap();
  let pageIndicator;
  let pageOperation;
  const navigationKey = "cc-navigation-feedback";
  let navigationMessage = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(navigationKey) || "null");
    sessionStorage.removeItem(navigationKey);
    if (saved?.url === location.href && Date.now() - saved.time < 30000 && typeof saved.label === "string") navigationMessage = saved.label;
  } catch { /* Navigation feedback also works when storage is unavailable. */ }

  function rememberNavigation(url, label) {
    try { sessionStorage.setItem(navigationKey, JSON.stringify({ url: new URL(url, location.href).href, label, time: Date.now() })); }
    catch { /* The destination still shows its own loading state. */ }
  }

  function showPageLoading(label) {
    const operation = {};
    pageOperation = operation;
    if (!pageIndicator) {
      pageIndicator = document.createElement("div");
      pageIndicator.className = "cc-page-loading";
      pageIndicator.setAttribute("role", "status");
      pageIndicator.setAttribute("aria-live", "polite");
      pageIndicator.setAttribute("aria-atomic", "true");
      const spinner = document.createElement("span");
      spinner.className = "cc-loading";
      spinner.setAttribute("aria-hidden", "true");
      pageIndicator.append(spinner, document.createElement("strong"));
      document.body.append(pageIndicator);
    }
    pageIndicator.querySelector("strong").textContent = label;
    pageIndicator.hidden = false;
    return () => {
      if (pageOperation === operation) clearPageLoading();
    };
  }

  function clearPageLoading() {
    pageOperation = null;
    if (pageIndicator) pageIndicator.hidden = true;
  }

  function navigate(url, label = "Carregando sua conta…") {
    rememberNavigation(url, label);
    showPageLoading(label);
    location.href = url;
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      if (!buttons.has(button)) {
        buttons.set(button, { nodes: [...button.childNodes], disabled: button.disabled, ariaBusy: button.getAttribute("aria-busy") });
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.classList.add("cc-loading");
      if (label) button.textContent = label;
      return;
    }
    const original = buttons.get(button);
    if (!original) return;
    button.replaceChildren(...original.nodes);
    button.disabled = original.disabled;
    if (original.ariaBusy === null) button.removeAttribute("aria-busy");
    else button.setAttribute("aria-busy", original.ariaBusy);
    button.classList.remove("cc-loading");
    buttons.delete(button);
  }

  function message(element, text, state = "info") {
    if (!element) return;
    element.textContent = text;
    element.hidden = !text;
    element.classList.add("cc-feedback");
    element.dataset.state = state;
    element.setAttribute("role", state === "error" ? "alert" : "status");
    element.setAttribute("aria-live", state === "error" ? "assertive" : "polite");
    if (state === "error" && text) {
      const bounds = element.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight) {
        element.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      }
    }
  }

  document.addEventListener("click", event => {
    if (event.target.closest?.('a[aria-disabled="true"]')) event.preventDefault();
  }, true);
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const target = new URL(link.href);
    if (target.origin !== location.origin || target.href === location.href || (target.pathname === location.pathname && target.search === location.search)) return;
    const page = target.pathname.split("/").pop();
    if (page === "comunidade.html") {
      rememberNavigation(target.href, "Carregando o mapa comunitário…");
      showPageLoading("Carregando o mapa comunitário…");
    }
    else if (["entrar.html", "cadastro.html"].includes(page) || (["teste.html", "index.html"].includes(page) && ["business", "business-panel"].includes(target.searchParams.get("area")))) {
      rememberNavigation(target.href, "Carregando sua conta…");
      showPageLoading("Carregando sua conta…");
    }
  });
  window.addEventListener("load", () => {
    window.addEventListener("beforeunload", event => {
      if (event.defaultPrevented) {
        clearPageLoading();
        try { sessionStorage.removeItem(navigationKey); } catch {}
      }
    });
  });
  window.addEventListener("pageshow", event => { if (event.persisted) clearPageLoading(); });

  window.ccUI = { setBusy, message, showPageLoading, navigate, navigationMessage };
})();
