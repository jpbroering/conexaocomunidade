"use strict";
const reportEl = (id) => document.getElementById(id);
let reportBusy = false,
  reportRows = [],
  inboxLoading = false,
  inboxLoaded = false,
  inboxSnapshot = "",
  reportLocation = null,
  reportLocating = false,
  gpsAddress = "",
  gpsRequest = 0;
async function reportCall(method = "GET", body) {
  const r = await ccFetch("/api/reports", {
    method,
    cache: "no-store",
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  return readApiResponse(r);
}
const reportForm = reportEl("report-form");
if (reportForm) {
  const identity = () => {
    const anonymous = reportForm.elements.identity.value === "anonymous";
    reportEl("report-identity").hidden = anonymous;
    for (const key of ["name", "contact"]) reportForm.elements[key].disabled = anonymous;
    reportForm.elements.name.required = !anonymous;
  };
  reportForm.querySelectorAll("[name=identity]").forEach((el) => (el.onchange = identity));
  reportForm.onsubmit = async (e) => {
    e.preventDefault();
    if (reportBusy || reportLocating) return;
    reportBusy = true;
    const button = reportForm.querySelector("button[type=submit]"),
      status = reportEl("report-status");
    ccUI.setBusy(button, true, "Enviando…");
    status.hidden = false;
    ccUI.message(status, "Enviando relato…", "pending");
    const f = new FormData(reportForm),
      anonymous = f.get("identity") === "anonymous";
    try {
      const data = await reportCall("POST", {
        anonymous,
        name: anonymous ? "" : f.get("name") || "",
        contact: anonymous ? "" : f.get("contact") || "",
        title: f.get("title"),
        address: f.get("address"),
        description: f.get("description"),
        location: reportLocation,
        images: await encodeReportPhotos(),
      });
      reportForm.reset();
      reportEl("report-photo-count").textContent = "Nenhuma foto selecionada.";
      clearReportLocation();
      identity();
      ccUI.message(status, "Relato enviado à administração. Referência: " + data.id + ".", "success");
    } catch (e) {
      ccUI.message(status, e.message, "error");
    } finally {
      reportBusy = false;
      ccUI.setBusy(button, false);
    }
  };
}
async function loadInbox({ quiet = false } = {}) {
  if (inboxLoading) return;
  inboxLoading = true;
  const refresh = reportEl("inbox-refresh"), summary = reportEl("inbox-summary");
  if (!quiet) {
    ccUI.setBusy(refresh, true, "Atualizando…");
    summary.setAttribute("aria-busy", "true");
    ccUI.message(summary, inboxLoaded ? "Verificando se há atualizações…" : "Carregando relatos…", "pending");
  }
  try {
    const data = await reportCall();
    reportRows = data.reports;
    reportEl("inbox-export").hidden = !!data.readOnly;
    ccUI.message(summary, `${data.unread} novo(s) · ${reportRows.length} relato(s) recebido(s) · Atualizado às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`, "success");
    reportEl("inbox-error").textContent = "";
    reportEl("inbox-login").hidden = true;
    reportEl("inbox-tools").hidden = false;
    inboxLoaded = true;
    const list = reportEl("inbox-list");
    const snapshot = JSON.stringify([reportRows, !!data.readOnly]);
    if (snapshot !== inboxSnapshot) {
      inboxSnapshot = snapshot;
      list.replaceChildren();
      if (!reportRows.length) {
        const p = document.createElement("p");
        p.textContent = "Ainda não há relatos recebidos.";
        list.append(p);
      }
      for (const row of reportRows) {
        const card = document.createElement("article");
        card.className = "panel";
        card.style.marginTop = "18px";
        const title = document.createElement("h2");
        title.textContent = row.title;
        const status = document.createElement("p");
        status.className = "admin-record-status";
        if (row.approval === "approved" || row.status === "Aprovado") status.classList.add("is-approved");
        if (row.approval === "rejected" || row.status === "Rejeitado") status.classList.add("is-rejected");
        status.textContent =
          (row.read_at ? "" : "NOVO · ") +
          row.status +
          " · " +
          new Date(row.created_at).toLocaleString("pt-BR");
        const sender = document.createElement("p");
        sender.textContent = row.anonymous
          ? "Envio anônimo"
          : "Nome: " + row.name + (row.contact ? " · Contato: " + row.contact : "");
        const address = document.createElement("p");
        address.textContent = "Local: " + row.address;
        if (row.location && Number.isFinite(row.location.lat) && Number.isFinite(row.location.lng)) {
          const link = document.createElement("a");
          link.className = "secondary";
          link.href =
            "https://www.google.com/maps/search/?api=1&query=" +
            row.location.lat +
            "," +
            row.location.lng;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent =
            "📍 Abrir localização fixa · precisão aproximada de " +
            Math.round(row.location.accuracy) +
            " m";
          address.append(document.createElement("br"), link);
        }
        const description = document.createElement("p");
        description.style.whiteSpace = "pre-wrap";
        description.style.overflowWrap = "anywhere";
        description.textContent = row.description;
        const actions = document.createElement("div");
        actions.className = "actions";
        for (const status of (data.readOnly ? [] : ["Lido", "Aprovado", "Em acompanhamento", "Resolvido", "Rejeitado"]).filter(value => value !== row.status)) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = status === "Rejeitado" ? "danger" : "secondary";
          button.textContent =
            status === "Lido"
              ? "Marcar como lido"
              : status === "Rejeitado"
                ? "Rejeitar relato"
                : status === "Aprovado"
                  ? "Aprovar relato"
                  : status;
          button.onclick = async () => {
            if (
              status === "Rejeitado" &&
              !confirm(
                "Rejeitar este relato por conteúdo impróprio ou fora do contexto? Ele continuará restrito à administração.",
              )
            )
              return;
            if (reportBusy) return;
            reportBusy = true;
            ccUI.message(summary, "Salvando a revisão do relato…", "pending");
            actions.setAttribute("aria-busy", "true");
            actions.querySelectorAll("button").forEach((b) => (b.disabled = true));
            try {
              await reportCall("PATCH", { id: row.id, revision: row.revision, status });
              await loadInbox({ quiet: true });
            } catch (e) {
              ccUI.message(reportEl("inbox-error"), e.message, "error");
            } finally {
              reportBusy = false;
              actions.removeAttribute("aria-busy");
              actions.querySelectorAll("button").forEach((b) => (b.disabled = false));
            }
          };
          actions.append(button);
        }
        const photos = document.createElement("div");
        photos.className = "report-photo-gallery";
        for (let i = 0; i < (row.photoCount || row.images?.length || 0); i++) {
          const image = document.createElement("img");
          image.alt = "Foto anexada ao relato";
          image.loading = "lazy";
          image.src = row.images?.[i]
            ? "data:" + row.images[i].type + ";base64," + row.images[i].body
            : ccImage("/api/reports?id=" + encodeURIComponent(row.id) + "&photo=" + i);
          photos.append(image);
        }
        card.append(title, status, sender, address, description, photos, actions);
        list.append(card);
      }
    }
  } catch (e) {
    ccUI.message(reportEl("inbox-error"), e.message, "error");
    if (!inboxLoaded && [401, 403].includes(e.status)) {
      reportEl("inbox-tools").hidden = true;
      summary.textContent = "Acesso reservado à administração.";
      reportEl("inbox-login").hidden = false;
    } else if (!inboxLoaded) {
      summary.textContent = "Não foi possível carregar os relatos. Tente novamente.";
      reportEl("inbox-tools").hidden = true;
      reportEl("inbox-login").hidden = true;
    } else {
      ccUI.message(summary, "Não foi possível atualizar. Exibindo os dados carregados anteriormente.", "error");
    }
  } finally {
    inboxLoading = false;
    if (!quiet) {
      ccUI.setBusy(refresh, false);
      summary.removeAttribute("aria-busy");
    }
  }
}
if (reportEl("inbox-list")) {
  loadInbox();
  reportEl("inbox-refresh").onclick = () => loadInbox();
  ccUI.refreshWhileVisible(
    () => loadInbox({ quiet: true }),
    () => !reportBusy && !inboxLoading,
  );
  reportEl("inbox-export").onclick = () => {
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob(
          [JSON.stringify({ exportedAt: new Date().toISOString(), reports: reportRows }, null, 2)],
          { type: "application/json" },
        ),
      );
    a.href = url;
    a.download = "Relatos-Comunidade.private.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

function clearReportLocation() {
  gpsRequest++;
  reportLocation = null;
  reportLocating = false;
  reportEl("report-gps").disabled = false;
  reportForm.querySelector("button[type=submit]").disabled = reportBusy;
  reportEl("report-clear-gps").hidden = true;
  reportEl("report-gps-map").hidden = true;
  if (gpsAddress && reportForm.elements.address.value === gpsAddress)
    reportForm.elements.address.value = "";
  gpsAddress = "";
  reportEl("report-gps-status").textContent =
    "Opcional: adicione um ponto fixo quando estiver no local do problema. A localização não será acompanhada.";
}
if (reportForm) {
  reportEl("report-clear-gps").onclick = clearReportLocation;
  reportEl("report-gps").onclick = () => {
    if (reportBusy || reportLocating) return;
    const status = reportEl("report-gps-status");
    if (!navigator.geolocation) {
      status.textContent =
        "GPS indisponível neste dispositivo. Você pode informar o local por escrito.";
      return;
    }
    const request = ++gpsRequest;
    reportLocating = true;
    reportEl("report-gps").disabled = true;
    reportForm.querySelector("button[type=submit]").disabled = true;
    status.textContent = "Obtendo sua localização. Permita o acesso ao GPS…";
    const done = () => {
      reportLocating = false;
      reportEl("report-gps").disabled = false;
      reportForm.querySelector("button[type=submit]").disabled = reportBusy;
    };
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (request !== gpsRequest) return;
        done();
        const c = p.coords;
        if (
          !Number.isFinite(c.latitude) ||
          !Number.isFinite(c.longitude) ||
          !Number.isFinite(c.accuracy)
        ) {
          status.textContent = "Não foi possível obter um ponto válido. Tente novamente.";
          return;
        }
        reportLocation = {
          lat: c.latitude,
          lng: c.longitude,
          accuracy: c.accuracy,
          capturedAt: Date.now(),
        };
        if (
          !reportForm.elements.address.value.trim() ||
          reportForm.elements.address.value === gpsAddress
        ) {
          gpsAddress = "Localização GPS: " + c.latitude.toFixed(6) + ", " + c.longitude.toFixed(6);
          reportForm.elements.address.value = gpsAddress;
        }
        status.textContent =
          "Ponto fixo adicionado · precisão aproximada de " +
          Math.round(c.accuracy) +
          " metros. Confira se corresponde ao local do problema antes de enviar.";
        const link = reportEl("report-gps-map");
        link.href =
          "https://www.google.com/maps/search/?api=1&query=" + c.latitude + "," + c.longitude;
        link.hidden = false;
        reportEl("report-clear-gps").hidden = false;
      },
      (e) => {
        if (request !== gpsRequest) return;
        done();
        status.textContent =
          e.code === 1
            ? "Acesso ao GPS não permitido. Você pode informar o local por escrito."
            : e.code === 3
              ? "O GPS demorou a responder. Tente novamente ou informe o local por escrito."
              : "Não foi possível localizar. Ative o GPS ou informe o local por escrito.";
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  };
}

async function encodeReportPhotos() {
  const files = [...(reportEl("report-photos")?.files || [])];
  if (files.length > 3) throw Error("Envie até 3 fotos por relato.");
  const photos = [];
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5000000)
      throw Error("Use JPG, PNG ou WebP de até 5 MB por foto.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const ratio = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const context = canvas.getContext("2d");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let body = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
      if (body.length > 800000) body = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
      if (body.length > 800000) throw Error("A foto ficou muito grande. Escolha uma imagem menor.");
      photos.push({ type: "image/jpeg", body });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return photos;
}
if (reportEl("report-photos"))
  reportEl("report-photos").onchange = () => {
    reportEl("report-photo-count").textContent =
      reportEl("report-photos").files.length + " foto(s) selecionada(s). Até 3 por relato.";
  };
