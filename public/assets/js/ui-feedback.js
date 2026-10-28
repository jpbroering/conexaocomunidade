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
    if (notice && !notice.hidden && notice.dataset.state === "pending") {
      element.setAttribute("role", "presentation"); element.setAttribute("aria-live", "off");
      return;
    }
    if (state === "error" && text) {
      const bounds = element.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > innerHeight) {
        element.setAttribute("aria-live", "off");
        element.setAttribute("role", "presentation");
        notify(text, state);
      }
    }
  }

  let notice, noticeTimer, noticeOwner;
  function notify(text, state = "info", owner = {}) {
    clearTimeout(noticeTimer);
    noticeOwner = owner;
    if (!notice) {
      notice = document.createElement("aside");
      notice.className = "cc-operation-notice";
      notice.setAttribute("popover", "manual");
      const content = document.createElement("span");
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.setAttribute("aria-label", "Dispensar aviso");
      close.onclick = () => { notice.hidePopover?.(); notice.hidden = true; };
      notice.append(content, close);
      document.body.append(notice);
    }
    notice.hidden = false;
    notice.dataset.state = state;
    const content = notice.firstElementChild;
    content.className = state === "pending" ? "cc-loading" : "";
    content.setAttribute("role", state === "error" ? "alert" : "status");
    content.textContent = text;
    notice.lastElementChild.hidden = state === "pending";
    if (notice.showPopover) notice.showPopover();
    else (document.querySelector("dialog[open]") || document.body).append(notice);
    if (state === "success") noticeTimer = setTimeout(() => { notice.hidePopover?.(); notice.hidden = true; }, 5000);
    return owner;
  }
  function startOperation(button, label, region = button) {
    const owner = notify(label, "pending");
    const controls = [...(region?.querySelectorAll("button,input,textarea,select") || [])]
      .map(control => [control, control.disabled]);
    const oldBusy = region?.getAttribute("aria-busy");
    setBusy(button, true, label);
    for (const [control] of controls) control.disabled = true;
    region?.setAttribute("aria-busy", "true");
    return (text, state = "success") => {
      setBusy(button, false);
      for (const [control, disabled] of controls) control.disabled = disabled;
      if (oldBusy == null) region?.removeAttribute("aria-busy");
      else region?.setAttribute("aria-busy", oldBusy);
      if (noticeOwner === owner) {
        if (text) notify(text, state, owner);
        else { notice.hidePopover?.(); notice.hidden = true; }
      }
    };
  }
  function focusSelector(element) {
    if (element?.id) return `#${CSS.escape(element.id)}`;
    if (element?.dataset.id) return `[data-id="${CSS.escape(element.dataset.id)}"]`;
    const record = element?.closest("[data-id]");
    if (element?.dataset.action && record) {
      return `[data-id="${CSS.escape(record.dataset.id)}"] [data-action="${CSS.escape(element.dataset.action)}"]`;
    }
    const form = element?.closest("form[id]");
    if (element?.name && form) return `#${CSS.escape(form.id)} [name="${CSS.escape(element.name)}"]`;
    return null;
  }
  function preserveView(work) {
    const focused = document.activeElement;
    let deepFocus = focused;
    while (deepFocus?.shadowRoot?.activeElement) deepFocus = deepFocus.shadowRoot.activeElement;
    const key = focusSelector(focused);
    const x = scrollX, y = scrollY;
    const positions = [...document.querySelectorAll("dialog[open], .detail-gallery")]
      .map(element => [element, element.scrollTop, element.scrollLeft]);
    const result = work();
    if (key && !focused.isConnected) document.querySelector(key)?.focus({preventScroll:true});
    else if (deepFocus?.isConnected && deepFocus !== document.body && document.activeElement !== focused) deepFocus.focus({preventScroll:true});
    for (const [element, top, left] of positions) { element.scrollTop = top; element.scrollLeft = left; }
    window.scrollTo({left:x, top:y, behavior:"instant"});
    return result;
  }
  function syncGallery(root, ids, source, alt = "Foto enviada pela empresa") {
    const desired = [...new Set(ids.filter(Boolean))];
    const existing = new Map([...root.querySelectorAll("img[data-media-id]")].map(img => [img.dataset.mediaId, img]));
    root.querySelector(".cc-empty-gallery")?.remove();
    for (const [id, img] of existing) {
      if (desired.includes(id)) continue;
      if (img.nextElementSibling?.matches(".cc-image-error")) img.nextElementSibling.remove();
      img.remove();
    }
    for (const id of desired) {
      if (existing.has(id)) continue;
      const img = document.createElement("img");
      img.dataset.mediaId = id;
      img.src = source(id);
      img.alt = alt;
      img.loading = "lazy";
      root.append(img);
    }
    if (!desired.length) {
      const empty = document.createElement("p");
      empty.className = "cc-empty-gallery";
      empty.textContent = "Nenhuma foto disponível.";
      root.append(empty);
    }
  }
  function refreshWhileVisible(load, canLoad = () => true, {showStatus = true} = {}) {
    let running = false, timer, failures = 0;
    const meta = document.createElement("p");
    meta.className = "cc-refresh-status";
    const label = document.createElement("span");
    label.textContent = "Atualização automática a cada 30 segundos.";
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "secondary"; retry.textContent = "Atualizar agora";
    meta.append(label, retry);
    if (showStatus) document.querySelector("main")?.append(meta);
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, Math.min(300000, 30000 * 2 ** failures)); };
    async function refresh() {
      if (running) return;
      if (document.visibilityState !== "visible" || !canLoad()) { schedule(); return; }
      running = true;
      retry.disabled = true;
      try {
        if (await load() === false) throw Error("refresh failed");
        failures = 0;
        label.textContent = "Conferido às " + new Date().toLocaleTimeString("pt-BR") + " · atualização automática";
      } catch {
        failures = Math.min(failures + 1, 4);
        label.textContent = "Dados podem estar desatualizados. Tentaremos novamente; você também pode atualizar manualmente.";
      } finally { running = false; retry.disabled = false; schedule(); }
    }
    retry.onclick = refresh;
    document.addEventListener("visibilitychange", refresh);
    schedule();
    return refresh;
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

  window.ccUI = { setBusy, message, notify, startOperation, preserveView, syncGallery, refreshWhileVisible, showPageLoading, navigate, navigationMessage };
})();
