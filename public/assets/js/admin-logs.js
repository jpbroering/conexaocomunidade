const status = document.getElementById("status"),
  refresh = document.getElementById("refresh"),
  root = document.getElementById("events");
let loading = false, lastSnapshot = "";
const checkedAt = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
async function load({ quiet = false } = {}) {
  if (loading) return;
  loading = true;
  if (!quiet) {
    ccUI.setBusy(refresh, true, "Atualizando…");
    root.setAttribute("aria-busy", "true");
    ccUI.message(status, "Carregando registros…", "pending");
  }
  try {
    const d = await readApiResponse(await ccFetch("/api/admin-activity", { cache: "no-store" }));
    const snapshot = JSON.stringify(d.events);
    if (snapshot !== lastSnapshot) {
      root.replaceChildren();
      for (const e of d.events) {
        const row = document.createElement("article");
        row.className = "panel";
        const h = document.createElement("h2");
        h.textContent = e.type;
        const p = document.createElement("p");
        p.textContent = e.name + " · " + e.status;
        const time = document.createElement("small");
        time.textContent = new Date(e.time).toLocaleString("pt-BR");
        row.append(h, p, time);
        root.append(row);
      }
      lastSnapshot = snapshot;
    }
    const count = d.events.length ? `${d.events.length} registros` : "Nenhum registro";
    ccUI.message(status, `${count} · Atualizado às ${checkedAt()}.`, "success");
  } catch (e) {
    ccUI.message(status, e.message, "error");
  } finally {
    loading = false;
    if (!quiet) {
      ccUI.setBusy(refresh, false);
      root.removeAttribute("aria-busy");
    }
  }
}
refresh.onclick = () => load();
ccUI.message(status, "Carregando registros…", "pending");
load();
ccUI.refreshWhileVisible(() => load({ quiet: true }));
