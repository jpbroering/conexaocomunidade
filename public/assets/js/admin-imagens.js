"use strict";
const slots = {
  "student-1": "Natanael Vieira Sousa",
  "student-2": "Vitor Hugo Pereira",
  "student-3": "Cauê Vinicius Teixeira da Silva",
  "teacher-1": "Diego Paulo Garcia",
  "teacher-2": "Silvania Matos de Lima",
  "teacher-3": "Willian de França",
  "teacher-4": "Gabriela da Silva Loh",
  "developer-1": "Eugênio",
  "developer-2": "João Paulo Broering",
  manager: "Leandro Pickler",
  coordination: "Daniela Amorim",
  team: "Toda a equipe",
  institution: "Parceria — aba Sobre",
};
const status = document.getElementById("status"),
  root = document.getElementById("images"),
  refresh = document.getElementById("refresh-images"),
  summary = document.getElementById("image-summary");
let loading = false, actionPending = false, lastSnapshot = "";
const approvalLabels = {
  approved: "✓ Aprovada",
  pending: "Aguardando aprovação",
  rejected: "✕ Não aprovada",
};
const checkedAt = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const message = (text, state = "info") => ccUI.message(status, text, state);
async function api(url, method = "GET", body) {
  return readApiResponse(
    await ccFetch(url, {
      method,
      cache: "no-store",
      ...(body instanceof FormData
        ? { body }
        : body
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
          : {}),
    }),
  );
}
async function act(work, trigger, label = "Salvando alteração…") {
  if (actionPending || loading) return;
  actionPending = true;
  const finish = ccUI.startOperation(trigger, label, root);
  let result = "", state = "success";
  try {
    message(label, "pending");
    await work();
    const updated = await load({ quiet: true, afterWrite: true });
    result = updated ? "Alteração salva. Lista atualizada." : "Alteração salva; não foi possível atualizar a lista. Tente atualizar novamente.";
    state = updated ? "success" : "error";
  } catch (e) { result = e.message; state = "error"; }
  finally {
    actionPending = false;
    message(result, state);
    finish(result, state);
  }
}
function button(parent, text, work, confirmation) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.action = text;
  b.className = "secondary";
  b.textContent = text;
  b.onclick = () => {
    if (actionPending || loading) return;
    if (confirmation && !confirm(confirmation)) return;
    const label = text.startsWith("Excluir") ? "Excluindo imagem…" : text === "Aprovar" ? "Aprovando imagem…" : "Salvando revisão…";
    act(work, b, label);
  };
  parent.append(b);
}
function upload(parent, label, work) {
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.onchange = () => {
    if (input.files[0]) act(() => work(input.files[0]), input, "Enviando imagem…");
  };
  l.append(input);
  parent.append(l);
}
function render(data, about) {
  const previousImages = new Map([...root.querySelectorAll("img[data-media-id]")].map(img => [img.dataset.mediaId, img]));
  root.replaceChildren();
  for (const c of data.companies) {
    const panel = document.createElement("section");
    panel.className = "panel";
    const h = document.createElement("h2");
    h.textContent = c.name;
    panel.append(h);
    for (const a of c.images) {
      const card = document.createElement("article");
      card.className = "moderation-photo";
      card.dataset.id = a.id;
      const img = previousImages.get(a.id) || document.createElement("img");
      if (!img.dataset.mediaId) img.src = ccImage("/api/company-image?id=" + a.id);
      img.dataset.mediaId = a.id;
      img.alt = "Foto da empresa";
      const state = a.approval || "pending";
      const p = document.createElement("p");
      p.className = `moderation-photo-status approval-${state}`;
      p.setAttribute("role", "status");
      p.textContent = `${{gallery: "Galeria", logo: "Logo", facade: "Fachada"}[a.kind] || "Foto"} · ${approvalLabels[state] || approvalLabels.pending}`;
      card.append(img, p);
      for (const [text, approval] of [
        ["Aprovar", "approved"],
        ["Não aprovar", "rejected"],
      ].filter(([, approval]) => approval !== state))
        button(card, text, () =>
          api("/api/company-image", "PATCH", { id: a.id, revision: a.revision, approval }),
        );
      upload(card, "Substituir foto", (file) => {
        const f = new FormData();
        f.set("company", c.id);
        f.set("revision", c.revision);
        f.set("kind", a.kind);
        f.set("replace", a.id);
        f.set("image", file);
        return api("/api/company-image", "POST", f);
      });
      button(card, "Excluir", () => api("/api/company-image", "DELETE", {
            company: c.id,
            id: a.id,
            revision: c.revision,
          }), "Excluir esta imagem?");
      panel.append(card);
    }
    upload(panel, "Adicionar foto aprovada", (file) => {
      const f = new FormData();
      f.set("company", c.id);
      f.set("revision", c.revision);
      f.set("kind", "gallery");
      f.set("image", file);
      return api("/api/company-image", "POST", f);
    });
    root.append(panel);
  }
  const section = document.createElement("section");
  section.className = "panel";
  const h = document.createElement("h2");
  h.textContent = "Fotos da aba Sobre";
  section.append(h);
  for (const slot of data.aboutSlots) {
    const row = about.slots.find((r) => r.slot === slot);
    const card = document.createElement("article");
    card.className = "moderation-photo";
    const title = document.createElement("h3");
    title.textContent = slots[slot];
    card.append(title);
    if (row?.image || row?.defaultSrc) {
      const img = document.createElement("img");
      img.src = row.defaultSrc || ccImage("/api/about-images?id=" + row.image);
      img.alt = slots[slot];
      card.append(img);
    }
    upload(card, "Adicionar ou substituir foto", (file) => {
      const f = new FormData();
      f.set("slot", slot);
      f.set("revision", row?.revision || "");
      f.set("image", file);
      return api("/api/about-images", "POST", f);
    });
    if (row?.image || row?.defaultSrc)
      button(card, "Excluir foto", () => api("/api/about-images", "DELETE", { slot, revision: row.revision }), "Excluir esta foto?");
    section.append(card);
  }
  root.append(section);
}
async function load({ quiet = false, afterWrite = false } = {}) {
  if (loading || (actionPending && !afterWrite)) return false;
  loading = true;
  if (!quiet) {
    ccUI.setBusy(refresh, true, "Atualizando…");
    root.setAttribute("aria-busy", "true");
    message("Carregando fila de imagens…", "pending");
  }
  try {
    const [data, about] = await Promise.all([api("/api/admin-images"), api("/api/about-images")]);
    const snapshot = JSON.stringify([data, about]);
    if (snapshot !== lastSnapshot) ccUI.preserveView(() => render(data, about));
    lastSnapshot = snapshot;
    const counts = data.companies.flatMap(company => company.images).reduce((total, image) => {
      total[image.approval || "pending"] = (total[image.approval || "pending"] || 0) + 1;
      return total;
    }, {});
    summary.textContent = `${counts.pending || 0} aguardando revisão · ${counts.approved || 0} aprovadas · ${counts.rejected || 0} não aprovadas · Conferido às ${checkedAt()}`;
    if (!quiet) message("Lista atualizada.", "success");
    return true;
  } catch (e) {
    message(e.message, "error");
    return false;
  } finally {
    loading = false;
    if (!quiet) {
      ccUI.setBusy(refresh, false);
      root.removeAttribute("aria-busy");
    }
  }
}
refresh.onclick = () => load();
message("Carregando fila de imagens…", "pending");
load();
ccUI.refreshWhileVisible(() => load({ quiet: true }), () => !actionPending && !loading);
