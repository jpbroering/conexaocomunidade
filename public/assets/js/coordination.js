"use strict";
(() => {
  const status = document.getElementById("coordination-status");
  const fields = [
    ["name", "Nome", 120],
    ["category", "Atividade", 80],
    ["address", "Endereço", 250],
    ["contact", "Contato", 120],
    ["hours", "Horário de atendimento", 200],
    ["description", "Descrição", 2000],
    ["products", "Produtos e serviços", 1500],
  ];
  const dirty = new Set(), dirtyForms = new WeakSet(), snapshots = new Map();
  let loading = false, saving = false;
  const list = document.getElementById("coordination-list");
  function changedElsewhere(article, id) {
    if (article.querySelector(".remote-change")) return;
    const notice = document.createElement("p"); notice.className = "remote-change"; notice.setAttribute("role", "status");
    notice.textContent = "Este cadastro mudou em outra sessão. Seus campos foram preservados. ";
    const reload = document.createElement("button"); reload.type = "button"; reload.textContent = "Carregar versão salva";
    reload.onclick = () => { if (!saving && confirm("Descartar os campos não salvos e carregar a versão atual?")) { dirty.delete(id); load(); } };
    notice.append(reload); article.prepend(notice);
  }
  function markSaved(form, id) {
    dirtyForms.delete(form);
    const article = form.closest("article");
    if (![...article.querySelectorAll("form")].some(form => dirtyForms.has(form))) dirty.delete(id);
  }
  function companyCard(company) {
    const article = document.createElement("article");
    article.className = "panel";
    article.dataset.id = company.id;
    article.addEventListener("input", event => { dirty.add(company.id); dirtyForms.add(event.target.closest("form")); });
    const title = document.createElement("h3");
    title.textContent = company.name;
    const details = document.createElement("p");
    details.textContent = [company.category, company.address, company.published ? "No catálogo" : "Rascunho"].filter(Boolean).join(" · ");
    const editor = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Editar dados básicos";
    const form = document.createElement("form");
    form.className = "form-grid";
    for (const [field, label, limit] of fields) {
      const wrapper = document.createElement("label");
      wrapper.textContent = label;
      const input = document.createElement(["description", "products"].includes(field) ? "textarea" : "input");
      input.name = field;
      input.maxLength = limit;
      input.value = company[field] || "";
      if (field === "name") { input.required = true; input.minLength = 2; }
      wrapper.append(input);
      form.append(wrapper);
    }
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "primary";
    button.textContent = "Salvar alterações";
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    form.append(button, message);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (saving || loading) return;
      const updated = Object.fromEntries(new FormData(form));
      saving = true;
      const finish = ccUI.startOperation(button, "Salvando alterações…", form);
      try {
        const saved = await readApiResponse(await ccFetch("/api/coordination", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: company.id, revision: company.revision, data: updated }),
        }));
        company.revision = saved.revision;
        markSaved(form, company.id);
        title.textContent = updated.name;
        details.textContent = [updated.category, updated.address, company.published ? "No catálogo" : "Rascunho"].filter(Boolean).join(" · ");
        message.textContent = "Alterações salvas.";
        finish(message.textContent);
      } catch (error) { message.textContent = error.message; finish(error.message, "error"); }
      finally { saving = false; }
    };
    editor.append(summary, form);
    article.append(title, details, editor);
    if (company.informal) {
      const access = document.createElement('details');
      const label = document.createElement('summary');
      label.textContent = 'Acesso do empreendedor';
      const accountStatus = document.createElement('p');
      accountStatus.textContent = company.account ? 'Usuário: ' + company.account.username + (company.account.active ? ' · acesso liberado' : ' · acesso desativado') : 'Este cadastro ainda não tem conta. A escola pode criar e liberar o acesso.';
      access.append(label, accountStatus);
      if (!company.account?.active) {
        const accessForm = document.createElement('form');
        if (!company.account) {
          const usernameLabel = document.createElement('label');usernameLabel.textContent = 'Usuário para o empreendedor';
          const username = document.createElement('input');username.name='username';username.required=true;username.minLength=3;username.maxLength=40;username.pattern='[A-Za-z0-9_.\\-]{3,40}';username.autocomplete='off';usernameLabel.append(username);
          const passwordLabel = document.createElement('label');passwordLabel.textContent = 'Senha inicial de 15 a 128 caracteres';
          const password = document.createElement('input');password.name='password';password.type='password';password.required=true;password.minLength=15;password.maxLength=128;password.autocomplete='new-password';passwordLabel.append(password);
          accessForm.append(usernameLabel,passwordLabel);
        }
        const release = document.createElement('button');release.type='submit';release.className='primary';release.textContent=company.account?'Liberar acesso':'Criar e liberar conta';
        const notice = document.createElement('p');notice.setAttribute('role','status');accessForm.append(release,notice);
        accessForm.onsubmit=async event=>{
          event.preventDefault();
          if (saving || loading) return;
          const credentials=Object.fromEntries(new FormData(accessForm));
          saving = true;
          const finish = ccUI.startOperation(release, "Liberando acesso…", accessForm);
          try {
            await readApiResponse(await ccFetch('/api/coordination',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release-account',id:company.id,revision:company.revision,accountRevision:company.account?.revision,...credentials})}));
            markSaved(accessForm, company.id);
            finish('Acesso liberado.');
            saving = false;
            await load();
          } catch(error) {notice.textContent=error.message;finish(error.message,"error");} finally {saving=false;}
        };
        access.append(accessForm);
      }
      article.append(access);
    }

    return article;
  }
  async function load() {
    if (loading || saving) return;
    loading = true;
    if (!snapshots.size) ccUI.message(status, "Carregando cadastros…", "pending");
    try {
      const data = await readApiResponse(await ccFetch("/api/coordination", { cache: "no-store" }));
      ccUI.message(status, data.name + " · " + data.companies.length + " cadastro(s)");
      ccUI.preserveView(() => {
        const ids = new Set(data.companies.map(company => company.id));
        for (const article of [...list.children]) if (!ids.has(article.dataset.id)) {
          if (dirty.has(article.dataset.id)) changedElsewhere(article, article.dataset.id);
          else { snapshots.delete(article.dataset.id); article.remove(); }
        }
        document.getElementById("coordination-reports").hidden = false;
        for (const company of data.companies) {
          const snapshot = JSON.stringify(company);
          const previous = list.querySelector(`[data-id="${CSS.escape(company.id)}"]`);
          if (previous && snapshots.get(company.id) === snapshot) continue;
          if (previous && dirty.has(company.id)) { changedElsewhere(previous, company.id); continue; }
          snapshots.set(company.id, snapshot);
          const article = companyCard(company);
          if (previous) previous.replaceWith(article); else list.append(article);
        }
      });
    } catch (error) { ccUI.message(status, error.message, "error"); return false; }
    finally { loading = false; }
  }
  load();
  ccUI.refreshWhileVisible(load, () => !saving && !loading);
  window.addEventListener("beforeunload", event => { if (dirty.size || saving) { event.preventDefault(); event.returnValue = ""; } });
})();

(() => {
  const list = document.getElementById("coord-list-panel");
  const informal = document.getElementById("coord-informal");
  const form = document.getElementById("informal-form");
  const status = document.getElementById("informal-status");
  let coordinates = null;
  let locating = false;
  let saving = false;
  let request = 0;
  function tab(showInformal) {
    list.hidden = showInformal;
    informal.hidden = !showInformal;
    document.getElementById("coord-tab-list").setAttribute("aria-pressed", String(!showInformal));
    document.getElementById("coord-tab-informal").setAttribute("aria-pressed", String(showInformal));
  }
  const categorySelect = document.getElementById("informal-category");
  const categoryOther = document.getElementById("informal-other");
  categorySelect.addEventListener("change", () => {
    const other = categorySelect.value === "Outros";
    document.getElementById("informal-other-label").hidden = !other;
    categoryOther.disabled = !other;
    categoryOther.required = other;
    if (other) categoryOther.focus();
  });
  document.getElementById("coord-tab-list").onclick = () => tab(false);
  document.getElementById("coord-tab-informal").onclick = () => tab(true);
  document.getElementById("informal-gps").onclick = () => {
    const output = document.getElementById("informal-gps-status");
    if (!navigator.geolocation) { output.textContent = "GPS indisponível. Use o endereço ou a referência."; return; }
    if (locating || saving) return;
    const sequence = ++request;
    locating = true;
    form.querySelector("[type=submit]").disabled = true;
    output.textContent = "Obtendo a localização. Permita o GPS do dispositivo…";
    navigator.geolocation.getCurrentPosition((position) => {
      if (sequence !== request) return;
      locating = false;
      form.querySelector("[type=submit]").disabled = false;
      coordinates = {lat: position.coords.latitude, lng: position.coords.longitude};
      document.getElementById("informal-clear-gps").hidden = false;
      output.textContent = "Ponto fixo adicionado. Precisão aproximada: " + Math.round(position.coords.accuracy) + " m.";
    }, () => {
      if (sequence !== request) return;
      locating = false;
      form.querySelector("[type=submit]").disabled = false;
      output.textContent = "Não foi possível obter o GPS. O cadastro pode ser salvo com endereço ou referência.";
    }, {enableHighAccuracy: true, timeout: 15000, maximumAge: 0});
  };
  document.getElementById("informal-clear-gps").onclick = () => {
    ++request;
    locating = false;
    coordinates = null;
    form.querySelector("[type=submit]").disabled = saving;
    document.getElementById("informal-clear-gps").hidden = true;
    document.getElementById("informal-gps-status").textContent = "Localização removida.";
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (saving || locating) return;
    saving = true;
    const button = form.querySelector("[type=submit]");
    const finish = ccUI.startOperation(button, "Salvando cadastro…");
    status.textContent = "Salvando cadastro…";
    try {
      const data = Object.fromEntries(new FormData(form));
      if (data.category === "Outros") {
        data.category = categoryOther.value.trim();
        if (data.category.length < 2) throw new Error("Informe a atividade da pessoa com pelo menos 2 caracteres.");
      }
      delete data.categoryOther;
      data.published = form.elements.published.checked;
      data.lat = coordinates?.lat ?? null;
      data.lng = coordinates?.lng ?? null;
      await readApiResponse(await ccFetch("/api/coordination", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
      }));
      location.href = "./coordenacao.html?salvo=1";
    } catch (error) { status.textContent = error.message; finish(error.message, "error"); }
    finally { saving = false; }
  };
  if (new URLSearchParams(location.search).get("salvo") === "1") {
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.textContent = "Cadastro informal salvo. Ele já está na lista de registros da equipe.";
    list.prepend(notice);
  }
})();
