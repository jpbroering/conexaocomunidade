"use strict";
(() => {
  const buttons = new WeakMap();

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

  window.ccUI = { setBusy, message };
})();
