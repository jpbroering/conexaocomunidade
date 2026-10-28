(() => {
  const revisions = new Map();
  let loading = false;
  async function update() {
    if (loading) return;
    loading = true;
    try {
      const d = await readApiResponse(await ccFetch("/api/about-images", { cache: "no-store" }));
      for (const r of d.slots) {
        const target = document.querySelector('[data-photo-slot="' + r.slot + '"]');
        if (!target) continue;
        const snapshot = JSON.stringify(r);
        if (revisions.get(r.slot) === snapshot) continue;
        revisions.set(r.slot, snapshot);
        if (r.image || r.defaultSrc) {
          const img = document.createElement("img");
          img.src = r.defaultSrc || ccImage("/api/about-images?id=" + r.image);
          img.alt = target.getAttribute("aria-label") || "Foto do projeto";
          target.replaceChildren(img);
        } else if (target.tagName !== "IMG") target.innerHTML = "<span>Foto</span>";
      }
    } catch { return false; } finally { loading = false; }
  }
  update();
  ccUI.refreshWhileVisible(update, () => !loading, {showStatus:false});
})();
