(() => {
  "use strict";

  const app = document.getElementById("app");
  const params = new URLSearchParams(window.location.search);
  const isStaff = window.location.pathname.startsWith("/staff") || params.get("mode") === "staff";
  const steps = ["Dados", "Saúde", "Local", "Pele", "Consentimento", "Revisão"];
  const stepCopy = [
    { title: "Vamos começar", lead: "Confirme seus dados para que a equipe associe a ficha ao procedimento correto." },
    { title: "Sobre sua saúde", lead: "Responda com atenção. Se não souber, escolha a opção que permite falar com o profissional." },
    { title: "Local do procedimento", lead: "Toque na região e marque o ponto aproximado da aplicação." },
    { title: "Condições pré-existentes", lead: "Envie uma foto atual da área para registrar a condição da pele antes do procedimento." },
    { title: "Termo e consentimento", lead: "Leia o termo, envie seu documento e assine para confirmar o consentimento." },
    { title: "Confira antes de enviar", lead: "Revise os dados. Você poderá voltar para corrigir qualquer item." }
  ];

  const state = {
    mode: isStaff ? "staff" : "client",
    sessionId: params.get("session") || localStorage.getItem("anamnese-session") || "demo",
    config: null,
    session: null,
    staffSessions: [],
    selectedSessionId: null,
    staffDetail: null,
    started: false,
    submitted: false,
    step: 0,
    mapMode: "body",
    bodyView: "front",
    headView: "front",
    loading: true,
    saving: false,
    error: "",
    notice: "",
    form: {
      client: { name: "", contact: "", service: "Tatuagem" },
      answers: {},
      bodyMap: [],
      skinPhotos: [],
      document: null,
      signature: null,
      termsAccepted: false
    }
  };

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const uid = () => window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function statusLabel(status) {
    const labels = {
      waiting_client: "Aguardando cliente",
      draft: "Rascunho",
      submitted: "Enviada",
      ready: "Pronta para iniciar",
      needs_review: "Revisão necessária",
      blocked: "Bloqueada",
      started: "Em andamento",
      completed: "Concluída",
      clear: "Sem alertas",
      pending: "Pendente",
      acknowledged: "Visualizado",
      resolved: "Resolvido"
    };
    return labels[status] || status || "Pendente";
  }

  function formatDate(value) {
    if (!value) return "—";
    try {
      return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
    } catch (_) {
      return value;
    }
  }

  function answerLabel(value) {
    return { yes: "Sim", no: "Não", unknown: "Não sei" }[value] || "Não respondido";
  }

  function logoMarkup() {
    return `<div class="brand">
      <img src="/static/assets/logo.svg" alt="Logo do estúdio" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';" />
      <span class="brand-mark" style="display:none" aria-hidden="true"></span>
    </div>`;
  }

  function topbar() {
    return `<header class="topbar">
      ${logoMarkup()}
      <div class="topbar-actions">
        ${isStaff
          ? `<a class="button button-secondary" href="/">Fluxo cliente</a>`
          : `<a class="button button-secondary" href="/staff">Painel equipe</a>`}
      </div>
    </header>`;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    let body = null;
    try { body = await response.json(); } catch (_) { body = null; }
    if (!response.ok) {
      const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message || "Não foi possível concluir a operação.";
      const error = new Error(detail);
      error.payload = body?.detail;
      throw error;
    }
    return body;
  }

  function formPayload() {
    return {
      client: state.form.client,
      answers: state.form.answers,
      bodyMap: state.form.bodyMap,
      skinPhotos: state.form.skinPhotos,
      document: state.form.document,
      signature: state.form.signature,
      termsAccepted: state.form.termsAccepted
    };
  }

  function hydrate(session) {
    state.session = session;
    state.form = {
      client: { name: session.client?.name || "", contact: session.client?.contact || "", service: session.client?.service || "Tatuagem" },
      answers: { ...(session.answers || {}) },
      bodyMap: [...(session.bodyMap || [])],
      skinPhotos: [...(session.skinPhotos || [])],
      document: session.document || null,
      signature: session.signature || null,
      termsAccepted: Boolean(session.termsAccepted)
    };
    state.submitted = Boolean(session.submittedAt);
  }

  async function initialize() {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/static/service-worker.js").catch(() => {});
    try {
      state.config = await api("/api/config");
      if (isStaff) {
        state.staffSessions = await api("/api/sessions");
      } else {
        let session;
        if (params.get("fresh") === "1") {
          session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ clientName: "", service: "Tatuagem" }) });
          state.sessionId = session._id;
          localStorage.setItem("anamnese-session", session._id);
          window.history.replaceState({}, "", `/?session=${encodeURIComponent(session._id)}`);
        } else {
          session = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}`);
        }
        hydrate(session);
        const localDraft = localStorage.getItem(`anamnese-draft-${state.sessionId}`);
        if (localDraft && !session.submittedAt && params.get("fresh") !== "1") {
          try {
            const parsed = JSON.parse(localDraft);
            state.form = { ...state.form, ...parsed.form, client: { ...state.form.client, ...(parsed.form?.client || {}) } };
            state.notice = "Rascunho recuperado neste dispositivo.";
          } catch (_) {}
        }
      }
    } catch (error) {
      state.error = error.message || "Não foi possível carregar a sessão.";
    } finally {
      state.loading = false;
      render();
    }
  }

  function render() {
    if (state.loading) {
      app.innerHTML = `${topbar()}<main class="main-content"><div class="loading">Carregando sua sessão…</div></main>`;
      return;
    }
    if (state.error && !state.config) {
      app.innerHTML = `${topbar()}<main class="main-content"><div class="client-width"><div class="notice notice-danger"><span class="notice-icon">!</span><div><strong>Não foi possível carregar</strong><p>${escapeHtml(state.error)}</p></div></div></div></main>`;
      return;
    }
    app.innerHTML = isStaff ? renderStaff() : renderClient();
    if (!isStaff && state.step === 4 && state.started && !state.submitted) mountSignature();
  }

  function renderProgress() {
    const percent = Math.round(((state.step + 1) / steps.length) * 100);
    return `<div class="progress-wrap" aria-label="Progresso do preenchimento">
      <div class="progress-meta"><span>Etapa ${state.step + 1} de ${steps.length}</span><span>${percent}%</span></div>
      <div class="progress-track"><div class="progress-value" style="width:${percent}%"></div></div>
      <div class="step-dots">${steps.map((_, index) => `<span class="step-dot ${index < state.step ? "done" : ""} ${index === state.step ? "current" : ""}"></span>`).join("")}</div>
    </div>`;
  }

  function renderClient() {
    const content = state.submitted ? renderSubmitted() : state.started ? renderClientStep() : renderWelcome();
    return `${topbar()}<main class="main-content"><div class="client-width">${state.notice ? `<div class="notice notice-info" style="margin-bottom:1rem"><span class="notice-icon">i</span><div><strong>Informação</strong><p>${escapeHtml(state.notice)}</p></div></div>` : ""}${content}</div></main>`;
  }

  function renderWelcome() {
    return `<section class="hero">
      <p class="eyebrow">Ficha digital do procedimento</p>
      <h1>Antes de começar, vamos conhecer você.</h1>
      <p class="lead">Responda algumas perguntas sobre sua saúde, indique a área do procedimento e confirme o termo de responsabilidade.</p>
    </section>
    <section class="card">
      <div class="notice notice-info"><span class="notice-icon">i</span><div><strong>Preenchimento rápido e seguro</strong><p>Suas respostas serão revisadas pela equipe antes do atendimento. Tenha um documento com foto por perto.</p></div></div>
      <div class="button-group" style="margin-top:1.1rem"><button class="button button-primary button-wide" data-action="start">Iniciar preenchimento</button></div>
      <p class="muted small" style="margin:0.9rem 0 0">Ao continuar, você terá acesso ao termo de responsabilidade antes da assinatura.</p>
    </section>`;
  }

  function renderClientStep() {
    const copy = stepCopy[state.step];
    let body = "";
    if (state.step === 0) body = renderIdentity();
    if (state.step === 1) body = renderHealth();
    if (state.step === 2) body = renderBodyMap();
    if (state.step === 3) body = renderSkinPhotos();
    if (state.step === 4) body = renderConsent();
    if (state.step === 5) body = renderReview();
    const isLast = state.step === steps.length - 1;
    return `${renderProgress()}<section class="hero" style="padding-top:0"><p class="eyebrow">${steps[state.step]}</p><h1>${copy.title}</h1><p class="lead">${copy.lead}</p></section>${state.error ? `<div class="notice notice-danger" style="margin-bottom:1rem"><span class="notice-icon">!</span><div><strong>Confira este item</strong><p>${escapeHtml(state.error)}</p></div></div>` : ""}${body}<div class="bottom-actions">${state.step > 0 ? `<button class="button button-secondary" data-action="back">Voltar</button>` : `<span></span>`}<button class="button button-primary" data-action="next" ${state.saving ? "disabled" : ""}>${state.saving ? "Salvando…" : isLast ? "Enviar ficha" : "Continuar"}</button></div>`;
  }

  function renderIdentity() {
    return `<section class="card">
      <div class="field"><label for="client-name">Nome completo</label><input id="client-name" data-field="name" value="${escapeHtml(state.form.client.name)}" placeholder="Digite seu nome" autocomplete="name" /></div>
      <div class="field"><label for="client-contact">Telefone ou e-mail <span class="muted">(opcional)</span></label><input id="client-contact" data-field="contact" value="${escapeHtml(state.form.client.contact)}" placeholder="Como podemos entrar em contato?" autocomplete="email" /></div>
      <div class="field"><label for="client-service">Procedimento</label><select id="client-service" data-field="service"><option ${state.form.client.service === "Tatuagem" ? "selected" : ""}>Tatuagem</option><option ${state.form.client.service === "Piercing" ? "selected" : ""}>Piercing</option><option ${state.form.client.service === "Estética" ? "selected" : ""}>Estética</option></select></div>
    </section>`;
  }

  function choiceMarkup(question, current) {
    const options = [["yes", "Sim"], ["no", "Não"], ["unknown", "Não sei"]];
    return `<div class="choice-grid" role="radiogroup" aria-label="${escapeHtml(question.label)}">${options.map(([value, label]) => `<button type="button" class="choice ${value === current ? "selected" : ""} ${value === "yes" ? "positive" : ""}" data-action="answer" data-code="${question.code}" data-value="${value}" aria-pressed="${value === current}">${label}</button>`).join("")}</div>`;
  }

  function renderHealth() {
    return `<section>${state.config.questions.map((question) => {
      const current = state.form.answers[question.code];
      const followup = current === "yes";
      return `<article class="card">
        <div class="card-header"><div><h2 class="card-title">${escapeHtml(question.label)}</h2><p class="card-helper">${escapeHtml(question.helper)}</p></div>${question.required ? '<span class="status-badge draft">Obrigatório</span>' : ''}</div>
        ${choiceMarkup(question, current)}
        ${followup ? `<div class="conditional"><div class="field"><label for="detail-${question.code}">Detalhe para o profissional <span class="muted">(opcional)</span></label><input id="detail-${question.code}" data-detail-code="${question.code}" value="${escapeHtml(state.form.answers[`${question.code}_detail`] || "")}" placeholder="Escreva uma informação útil" /></div></div>` : ""}
      </article>`;
    }).join("")}</section>`;
  }

  function regionMap(region) {
    return region.map || "body";
  }

  function selectedRegion(region) {
    return state.form.bodyMap.some((item) => item.regionId === region.id && (item.map || "body") === regionMap(region));
  }

  function regionMarkup(region) {
    const selected = selectedRegion(region);
    return `<g class="map-region ${selected ? "selected" : ""}" data-action="map-region" data-region="${region.id}" role="button" tabindex="0" aria-label="${escapeHtml(region.label)}" aria-pressed="${selected}"><rect x="${region.x}" y="${region.y}" width="${region.w}" height="${region.h}" /><text x="${region.x + region.w / 2}" y="${region.y + region.h / 2}">${escapeHtml(region.label.split(" ").slice(0, 2).join(" "))}</text></g>`;
  }

  function mapControls() {
    const views = state.mapMode === "head"
      ? [["front", "Frontal"], ["left", "Perfil esquerdo"], ["right", "Perfil direito"]]
      : [["front", "Frente"], ["back", "Costas"]];
    const activeView = state.mapMode === "head" ? state.headView : state.bodyView;
    return `<div class="map-mode-toolbar"><button class="map-toggle ${state.mapMode === "body" ? "active" : ""}" data-action="map-mode" data-mode="body">Corpo</button><button class="map-toggle ${state.mapMode === "head" ? "active" : ""}" data-action="map-mode" data-mode="head">Cabeça</button></div><div class="map-toolbar">${views.map(([view, label]) => `<button class="map-toggle ${activeView === view ? "active" : ""}" data-action="map-view" data-view="${view}">${label}</button>`).join("")}</div>`;
  }

  function bodySvg() {
    const regions = (state.config.bodyRegions || []).filter((region) => regionMap(region) === "body" && region.view === state.bodyView);
    return `<div class="map-panel">${mapControls()}<svg class="body-svg" viewBox="0 0 320 540" role="img" aria-label="Mapa corporal ${state.bodyView === "front" ? "frontal" : "traseiro"}">
      <circle class="body-silhouette" cx="160" cy="38" r="26" />
      <path class="body-silhouette" d="M137 65 L137 86 L112 96 L112 225 L122 236 L116 355 L111 507 L141 507 L160 361 L179 507 L209 507 L204 355 L198 236 L208 225 L208 96 L183 86 L183 65Z" />
      <path class="body-silhouette" d="M137 69 C125 72 115 81 104 92 L76 106 C72 108 72 114 75 120 L83 136 C85 140 90 141 94 138 L111 128 L116 196 C117 204 113 211 107 217 L120 226 C128 217 132 207 132 196 L132 91 C134 82 138 76 137 69Z" />
      <path class="body-silhouette" d="M183 69 C195 72 205 81 216 92 L244 106 C248 108 248 114 245 120 L237 136 C235 140 230 141 226 138 L209 128 L204 196 C203 204 207 211 213 217 L200 226 C192 217 188 207 188 196 L188 91 C186 82 182 76 183 69Z" />
      <path class="body-silhouette" d="M107 211 C98 210 91 216 91 226 C91 237 99 246 110 249 L124 232 L116 215Z" />
      <path class="body-silhouette" d="M213 211 C222 210 229 216 229 226 C229 237 221 246 210 249 L196 232 L204 215Z" />
      <path class="body-silhouette" d="M111 507 L98 516 C91 521 94 529 104 531 L145 531 L141 507Z" />
      <path class="body-silhouette" d="M209 507 L222 516 C229 521 226 529 216 531 L175 531 L179 507Z" />
      <path class="body-silhouette-detail" d="M160 66 L160 225 M112 96 L112 225 M208 96 L208 225 M116 355 L141 507 M204 355 L179 507" />
      ${regions.map(regionMarkup).join("")}
    </svg></div>`;
  }

  function headSvg() {
    const regions = (state.config.bodyRegions || []).filter((region) => regionMap(region) === "head" && region.view === state.headView);
    const side = state.headView !== "front";
    return `<div class="map-panel head-map-panel">${mapControls()}<svg class="head-svg" viewBox="0 0 300 360" role="img" aria-label="Mapa ampliado da cabeça ${state.headView}">
      <ellipse class="head-silhouette" cx="150" cy="170" rx="94" ry="126" />
      <path class="head-silhouette-detail" d="M105 92 Q150 55 195 92 M112 278 Q150 302 188 278 M150 46 L150 292" />
      ${side ? `<path class="head-silhouette-detail" d="M185 102 Q232 134 220 189 L244 206 L218 220 M126 104 Q99 142 108 187" />` : `<path class="head-silhouette-detail" d="M90 170 Q105 188 122 170 M178 170 Q195 188 210 170 M124 222 Q150 233 176 222" />`}
      ${regions.map(regionMarkup).join("")}
    </svg></div>`;
  }

  function mapCanvas() {
    return state.mapMode === "head" ? headSvg() : bodySvg();
  }

  function renderBodyMap() {
    const selected = state.form.bodyMap.map((item) => item.label);
    return `<section class="card"><div class="body-map-layout"><div><p class="muted small" style="margin-bottom:0.8rem">Você pode selecionar mais de uma região. Use “Cabeça” para detalhar olhos, nariz e boca.</p>${mapCanvas()}</div><div><div class="card surface-muted"><div class="card-header"><div><h2 class="card-title">Regiões selecionadas</h2><p class="card-helper">Marque o local mais próximo possível.</p></div></div><div class="selected-list">${selected.length ? state.form.bodyMap.map((item) => `<div class="selected-region"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml((item.map || "body") === "head" ? "Cabeça" : item.view === "back" ? "Costas" : item.view === "left" ? "Perfil esquerdo" : item.view === "right" ? "Perfil direito" : "Frente")}</small></span><button type="button" data-action="remove-region" data-region="${item.regionId}" aria-label="Remover ${escapeHtml(item.label)}">×</button></div>`).join("") : '<p class="muted small">Nenhuma região selecionada.</p>'}</div></div></div></div></section>`;
  }

  function renderPhotoPreview(photo, index) {
    return `<div class="preview-card"><img src="${photo.dataUrl}" alt="Foto da pele ${index + 1}" /><button class="preview-remove" type="button" data-action="remove-photo" data-index="${index}" aria-label="Remover foto">×</button></div>`;
  }

  function renderSkinPhotos() {
    return `<section class="card"><div class="notice notice-info" style="margin-bottom:1rem"><span class="notice-icon">i</span><div><strong>Registre a condição atual da pele</strong><p>Fotografe apenas a área necessária para o profissional conferir machucados, irritações ou queimaduras.</p></div></div><div class="upload-zone"><input id="skin-photo-input" type="file" accept="image/*" capture="environment" data-file-kind="skin" /><label class="upload-action" for="skin-photo-input">Abrir câmera ou galeria</label><span class="muted small">Use boa iluminação. Você pode enviar mais de uma foto.</span></div>${state.form.skinPhotos.length ? `<div class="preview-grid" style="margin-top:0.9rem">${state.form.skinPhotos.map(renderPhotoPreview).join("")}</div>` : ""}</section>`;
  }

  function renderConsent() {
    return `<section>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Termo de responsabilidade</h2><p class="card-helper">Versão ${escapeHtml(state.config.termsVersion)}. Leia antes de aceitar.</p></div><span class="status-badge ${state.form.termsAccepted ? "ready" : "draft"}">${state.form.termsAccepted ? "Aceito" : "Pendente"}</span></div><div class="notice notice-info"><span class="notice-icon">i</span><div><strong>O profissional revisará suas respostas</strong><p>O aceite registra que você recebeu as informações do procedimento e respondeu à ficha com honestidade.</p></div></div><div class="consent-row" style="margin-top:0.9rem"><input id="terms-accepted" type="checkbox" data-field="termsAccepted" ${state.form.termsAccepted ? "checked" : ""} /><label for="terms-accepted">Li e concordo com o termo de responsabilidade apresentado antes da assinatura.</label></div></article>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Foto do documento</h2><p class="card-helper">Envie um documento com foto para validação manual da equipe.</p></div><span class="status-badge ${state.form.document ? "ready" : "draft"}">${state.form.document ? "Anexado" : "Obrigatório"}</span></div><div class="upload-zone"><input id="document-input" type="file" accept="image/*" capture="environment" data-file-kind="document" /><label class="upload-action" for="document-input">Fotografar documento</label>${state.form.document ? `<div class="preview-grid"><div class="preview-card"><img src="${state.form.document.dataUrl}" alt="Documento enviado" /><button class="preview-remove" type="button" data-action="remove-document" aria-label="Remover documento">×</button></div></div>` : ""}</div></article>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Sua assinatura</h2><p class="card-helper">Assine dentro da área abaixo. É possível limpar e refazer.</p></div><span class="status-badge ${state.form.signature ? "ready" : "draft"}">${state.form.signature ? "Preenchida" : "Obrigatório"}</span></div><div class="signature-wrap"><canvas id="signature-canvas" class="signature-canvas" aria-label="Área para assinatura"></canvas><div class="signature-tools"><span class="muted small">Use o dedo ou o mouse.</span><button class="button button-tertiary" type="button" data-action="clear-signature">Limpar</button></div></div></article>
    </section>`;
  }

  function clientAlertPreview() {
    const critical = ["has_diabetes", "uses_anticoagulants", "has_keloid_tendency", "has_skin_injury"];
    const matched = critical.some((code) => ["yes", "unknown"].includes(state.form.answers[code])) || state.form.answers.has_allergy === "yes" || state.form.answers.uses_continuous_medication === "yes";
    return matched ? `<div class="notice notice-warning" style="margin-top:1rem"><span class="notice-icon">!</span><div><strong>Revisão profissional necessária</strong><p>Uma das respostas será encaminhada para conferência antes do procedimento.</p></div></div>` : "";
  }

  function summaryRow(label, value) {
    return `<div class="summary-row"><span class="summary-label">${escapeHtml(label)}</span><span class="summary-value">${escapeHtml(value)}</span></div>`;
  }

  function renderReview() {
    const answerCount = state.config.questions.filter((q) => state.form.answers[q.code]).length;
    return `<section>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Dados principais</h2></div><button class="button button-tertiary" data-action="edit-step" data-step="0">Editar</button></div><div class="summary-list">${summaryRow("Nome", state.form.client.name || "Não informado")}${summaryRow("Procedimento", state.form.client.service)}${summaryRow("Saúde", `${answerCount} de ${state.config.questions.length} respondidas`)}</div></article>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Local e pele</h2></div><button class="button button-tertiary" data-action="edit-step" data-step="2">Editar</button></div><div class="summary-list">${summaryRow("Regiões", state.form.bodyMap.map((item) => item.label).join(", ") || "Nenhuma")}${summaryRow("Fotos da pele", `${state.form.skinPhotos.length} anexada(s)`)}</div></article>
      <article class="card"><div class="card-header"><div><h2 class="card-title">Consentimento</h2></div><button class="button button-tertiary" data-action="edit-step" data-step="4">Editar</button></div><div class="summary-list">${summaryRow("Termo", state.form.termsAccepted ? "Aceito" : "Pendente")}${summaryRow("Documento", state.form.document ? "Anexado" : "Pendente")}${summaryRow("Assinatura", state.form.signature ? "Preenchida" : "Pendente")}</div>${clientAlertPreview()}</article>
    </section>`;
  }

  function renderSubmitted() {
    const alert = state.session?.alert;
    const reviewText = alert ? "Sua ficha foi enviada e precisa ser revisada pela equipe antes do procedimento." : "Sua ficha foi enviada para a equipe. Aguarde a confirmação do atendimento.";
    return `<section class="success-panel"><div class="success-icon">✓</div><p class="eyebrow">Ficha enviada</p><h1>Está tudo registrado.</h1><p class="lead" style="margin:0 auto 1.2rem">${reviewText}</p><div class="notice ${alert ? "notice-warning" : "notice-success"}" style="text-align:left"><span class="notice-icon">${alert ? "!" : "✓"}</span><div><strong>${alert ? "Revisão profissional pendente" : "Nenhuma regra de alerta foi acionada"}</strong><p>Não feche esta tela até conversar com a equipe, se solicitado.</p></div></div><div class="button-group" style="justify-content:center;margin-top:1.2rem"><a class="button button-primary" href="/?fresh=1">Começar nova ficha</a><a class="button button-secondary" href="/staff">Abrir painel profissional</a></div></section>`;
  }

  function renderStaff() {
    if (state.selectedSessionId && state.staffDetail) return renderStaffDetail();
    const records = state.staffSessions;
    const needsReview = records.filter((item) => item.status === "needs_review").length;
    const ready = records.filter((item) => item.status === "ready").length;
    return `${topbar()}<main class="main-content"><div class="staff-width"><div class="staff-header"><div><p class="eyebrow">Painel da equipe</p><h1>Revisão de sessões</h1><p class="lead">Confira consentimento e alertas antes de iniciar qualquer procedimento.</p></div><div class="button-group"><button class="button button-primary" data-action="new-session">Nova sessão</button><button class="button button-secondary" data-action="reload-staff">Atualizar</button></div></div><div class="metric-grid"><div class="metric"><div class="metric-label">Total de sessões</div><div class="metric-value">${records.length}</div></div><div class="metric"><div class="metric-label">Revisão necessária</div><div class="metric-value" style="color:var(--danger)">${needsReview}</div></div><div class="metric"><div class="metric-label">Prontas</div><div class="metric-value" style="color:var(--success)">${ready}</div></div><div class="metric"><div class="metric-label">Com consentimento</div><div class="metric-value">${records.filter((item) => item.consentStatus === "valid").length}</div></div></div><div class="session-grid">${records.length ? records.map(renderSessionRow).join("") : '<div class="empty">Nenhuma sessão criada.</div>'}</div></div></main>`;
  }

  function renderSessionRow(session) {
    const alert = session.alert;
    return `<article class="session-row"><div><p class="session-name">${escapeHtml(session.client?.name || "Cliente sem nome")}</p><span class="session-meta">${escapeHtml(session.client?.service || "Procedimento")} · atualizada ${formatDate(session.updatedAt)}</span></div><div><span class="status-badge ${session.status}">${statusLabel(session.status)}</span></div><div><span class="status-badge ${alert ? alert.level : "clear"}">${alert ? "Alerta ativo" : "Sem alertas"}</span></div><div class="session-actions"><button class="button button-secondary" data-action="staff-select" data-session="${session._id}">Abrir</button><button class="button button-danger" data-action="staff-delete" data-session="${session._id}">Excluir</button></div></article>`;
  }

  function renderStaffAlert(session) {
    if (!session.alert) return `<div class="notice notice-success"><span class="notice-icon">✓</span><div><strong>Nenhuma regra de alerta acionada</strong><p>O consentimento está ${session.consentStatus === "valid" ? "válido" : "pendente"}. Ainda confira os arquivos antes de iniciar.</p></div></div>`;
    const alert = session.alert;
    return `<div class="notice notice-danger"><span class="notice-icon">!</span><div style="width:100%"><strong>Revisão obrigatória antes de iniciar</strong><p>${alert.matchedRules.map((rule) => `${escapeHtml(rule.title)} — ${escapeHtml(rule.message)}`).join("<br />")}</p><div class="button-group" style="margin-top:0.9rem"><button class="button button-warning" data-action="alert-action" data-alert-action="acknowledge">Reconhecer</button><button class="button button-danger" data-action="alert-action" data-alert-action="block">Bloquear sessão</button><button class="button button-secondary" data-action="alert-action" data-alert-action="release">Liberar com justificativa</button></div>${alert.note ? `<p class="small" style="margin-top:0.75rem"><strong>Registro:</strong> ${escapeHtml(alert.note)}</p>` : ""}</div></div>`;
  }

  function renderStaffDetail() {
    const session = state.staffDetail;
    const questions = state.config.questions;
    return `${topbar()}<main class="main-content"><div class="staff-width"><div class="detail-header"><div><button class="button button-tertiary" data-action="back-staff">← Voltar para sessões</button><p class="eyebrow" style="margin-top:0.9rem">Ficha da sessão</p><h1>${escapeHtml(session.client?.name || "Cliente sem nome")}</h1><p class="lead">${escapeHtml(session.client?.service || "Procedimento")} · atualizada ${formatDate(session.updatedAt)}</p></div><span class="status-badge ${session.status}">${statusLabel(session.status)}</span></div>${renderStaffAlert(session)}<div class="detail-grid" style="margin-top:1rem"><div><section class="card detail-section"><div class="card-header"><div><h2 class="card-title">Cards de Saúde</h2><p class="card-helper">Respostas registradas pelo cliente.</p></div></div><div class="answer-grid">${questions.map((question) => `<div class="answer-item"><div class="answer-question">${escapeHtml(question.label)}</div><div class="answer-value">${answerLabel(session.answers?.[question.code])}</div>${session.answers?.[`${question.code}_detail`] ? `<div class="muted small" style="margin-top:0.25rem">${escapeHtml(session.answers[`${question.code}_detail`])}</div>` : ""}</div>`).join("")}</div></section><section class="card detail-section"><div class="card-header"><div><h2 class="card-title">Mapa corporal</h2><p class="card-helper">Regiões indicadas pelo cliente.</p></div></div><div class="selected-list">${session.bodyMap?.length ? session.bodyMap.map((item) => `<div class="selected-region"><span>${escapeHtml(item.label)}</span><span class="muted small">${escapeHtml((item.map || "body") === "head" ? `Cabeça · ${item.view === "left" ? "Perfil esquerdo" : item.view === "right" ? "Perfil direito" : "Frontal"}` : item.view === "back" ? "Corpo · Costas" : "Corpo · Frente")}</span></div>`).join("") : '<p class="muted small">Nenhuma região informada.</p>'}</div></section></div><div><section class="card detail-section"><div class="card-header"><div><h2 class="card-title">Fotos</h2><p class="card-helper">Condições pré-existentes e documento.</p></div></div><div class="media-strip">${(session.skinPhotos || []).map((photo) => `<img src="${photo.dataUrl}" alt="Foto da pele" />`).join("")}${session.document?.dataUrl ? `<img src="${session.document.dataUrl}" alt="Documento do cliente" />` : ""}</div>${!session.skinPhotos?.length && !session.document ? '<p class="muted small">Nenhuma foto disponível.</p>' : ""}</section><section class="card detail-section"><div class="card-header"><div><h2 class="card-title">Consentimento</h2></div><span class="status-badge ${session.consentStatus === "valid" ? "ready" : "draft"}">${statusLabel(session.consentStatus)}</span></div><div class="summary-list">${summaryRow("Termo", session.termsAccepted ? session.termsVersion || "v1.0" : "Não aceito")}${summaryRow("Assinatura", session.signature ? "Preenchida" : "Ausente")}${summaryRow("Enviada em", formatDate(session.submittedAt))}</div>${session.signature ? `<div style="margin-top:1rem;padding:0.5rem;border:1px solid var(--line);border-radius:9px;background:white"><img src="${session.signature}" alt="Assinatura do cliente" style="display:block;width:100%;height:120px;object-fit:contain" /></div>` : ""}</section><section class="card detail-section"><div class="card-header"><div><h2 class="card-title">Auditoria</h2></div></div><div class="audit-list">${(session.audit || []).length ? session.audit.map((item) => `<div class="audit-item"><div class="audit-action">${escapeHtml(item.action)}</div><div class="audit-detail">${escapeHtml(item.detail)}</div><div class="audit-time">${formatDate(item.at)}</div></div>`).join("") : '<p class="muted small">Nenhum evento registrado.</p>'}</div></section></div></div></div></main>`;
  }

  async function saveDraft() {
    state.saving = true;
    try {
      const saved = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/draft`, { method: "POST", body: JSON.stringify(formPayload()) });
      state.session = saved;
      localStorage.removeItem(`anamnese-draft-${state.sessionId}`);
    } catch (_) {
      localStorage.setItem(`anamnese-draft-${state.sessionId}`, JSON.stringify({ form: state.form, savedAt: new Date().toISOString() }));
      state.notice = "Sem conexão com o servidor. O rascunho foi mantido neste dispositivo.";
    } finally {
      state.saving = false;
    }
  }

  function validateStep() {
    if (state.step === 0 && !state.form.client.name.trim()) return "Informe seu nome completo.";
    if (state.step === 1) {
      const missing = state.config.questions.filter((question) => question.required && !state.form.answers[question.code]);
      if (missing.length) return `Responda: ${missing[0].label}`;
    }
    if (state.step === 2 && !state.form.bodyMap.length) return "Selecione pelo menos uma região no mapa corporal.";
    if (state.step === 3 && !state.form.skinPhotos.length) return "Envie pelo menos uma foto da área do procedimento.";
    if (state.step === 4) {
      if (!state.form.termsAccepted) return "Aceite o termo de responsabilidade para continuar.";
      if (!state.form.document) return "Envie a foto do documento.";
      if (!state.form.signature) return "Faça sua assinatura no campo indicado.";
    }
    return "";
  }

  async function nextStep() {
    state.error = validateStep();
    if (state.error) { render(); return; }
    await saveDraft();
    if (state.step < steps.length - 1) {
      state.step += 1;
      state.error = "";
      render();
    } else {
      await submitForm();
    }
  }

  async function submitForm() {
    state.saving = true;
    state.error = "";
    render();
    try {
      const submitted = await api(`/api/sessions/${encodeURIComponent(state.sessionId)}/submit`, { method: "POST", body: JSON.stringify(formPayload()) });
      state.session = submitted;
      state.submitted = true;
      localStorage.removeItem(`anamnese-draft-${state.sessionId}`);
    } catch (error) {
      state.error = error.message;
      if (error.payload?.items) state.error += ` (${error.payload.items.join(", ")})`;
    } finally {
      state.saving = false;
      render();
    }
  }

  function showToast(message) {
    const current = document.querySelector(".toast");
    if (current) current.remove();
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2800);
  }

  async function imageData(file) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Escolha uma imagem válida.");
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const max = 1400;
          const ratio = Math.min(1, max / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.width * ratio));
          canvas.height = Math.max(1, Math.round(image.height * ratio));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        image.onerror = () => reject(new Error("Não foi possível processar a imagem."));
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function mountSignature() {
    const canvas = document.getElementById("signature-canvas");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#172033";
    let drawing = false;

    const point = (event) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const start = (event) => {
      drawing = true;
      canvas.setPointerCapture?.(event.pointerId);
      const p = point(event);
      context.beginPath();
      context.moveTo(p.x, p.y);
    };
    const move = (event) => {
      if (!drawing) return;
      const p = point(event);
      context.lineTo(p.x, p.y);
      context.stroke();
    };
    const end = () => {
      if (!drawing) return;
      drawing = false;
      state.form.signature = canvas.toDataURL("image/png");
      state.notice = "Assinatura registrada neste dispositivo.";
    };
    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    if (state.form.signature) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height);
      image.src = state.form.signature;
    }
  }

  async function handleFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await imageData(file);
      const kind = input.dataset.fileKind;
      if (kind === "skin") {
        const firstRegion = state.form.bodyMap[0]?.regionId || null;
        state.form.skinPhotos.push({ id: uid(), kind: "skin", filename: file.name, dataUrl, regionId: firstRegion });
      } else {
        state.form.document = { kind: "document", filename: file.name, dataUrl };
      }
      state.error = "";
      render();
      await saveDraft();
      render();
    } catch (error) {
      state.error = error.message;
      render();
    }
  }

  async function loadStaffDetail(sessionId) {
    state.staffDetail = await api(`/api/sessions/${encodeURIComponent(sessionId)}?view=staff`);
    state.selectedSessionId = sessionId;
    render();
  }

  async function refreshStaff() {
    state.staffSessions = await api("/api/sessions");
    if (state.selectedSessionId) state.staffDetail = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}?view=staff`);
    render();
  }

  async function createSession() {
    const name = window.prompt("Nome do cliente:");
    if (name === null) return;
    const service = window.prompt("Procedimento:", "Tatuagem") || "Tatuagem";
    try {
      const created = await api("/api/sessions", { method: "POST", body: JSON.stringify({ clientName: name, service }) });
      state.staffSessions = await api("/api/sessions");
      showToast(`Sessão criada: ${created._id}`);
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function deleteSession(sessionId) {
    const session = state.staffSessions.find((item) => item._id === sessionId);
    const clientName = session?.client?.name || "esta ficha";
    if (!window.confirm(`Excluir ${clientName}? Esta ação não pode ser desfeita.`)) return;
    try {
      await api(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      state.staffSessions = state.staffSessions.filter((item) => item._id !== sessionId);
      if (state.selectedSessionId === sessionId) {
        state.selectedSessionId = null;
        state.staffDetail = null;
      }
      showToast("Ficha excluída.");
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  async function alertAction(action) {
    let note = "";
    if (action !== "acknowledge") {
      note = window.prompt(action === "block" ? "Justifique o bloqueio:" : "Justifique a liberação:", "") || "";
      if (!note.trim()) return;
    }
    try {
      state.staffDetail = await api(`/api/sessions/${encodeURIComponent(state.selectedSessionId)}/alert-action`, { method: "POST", body: JSON.stringify({ action, note }) });
      state.staffSessions = await api("/api/sessions");
      showToast("Alerta atualizado.");
      render();
    } catch (error) {
      showToast(error.message);
    }
  }

  function updateField(field, value) {
    if (field === "termsAccepted") state.form.termsAccepted = value;
    else state.form.client[field] = value;
  }

  app.addEventListener("input", (event) => {
    const field = event.target.dataset.field;
    const detailCode = event.target.dataset.detailCode;
    if (field) updateField(field, field === "termsAccepted" ? event.target.checked : event.target.value);
    if (detailCode) state.form.answers[`${detailCode}_detail`] = event.target.value;
  });

  app.addEventListener("change", (event) => {
    const field = event.target.dataset.field;
    if (field) updateField(field, field === "termsAccepted" ? event.target.checked : event.target.value);
    if (event.target.dataset.fileKind) handleFile(event.target);
  });

  app.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "start") { state.started = true; render(); return; }
    if (action === "next") { await nextStep(); return; }
    if (action === "back") { state.error = ""; state.step = Math.max(0, state.step - 1); render(); return; }
    if (action === "answer") { state.form.answers[target.dataset.code] = target.dataset.value; state.error = ""; render(); return; }
    if (action === "map-mode") { state.mapMode = target.dataset.mode; render(); return; }
    if (action === "map-view") { if (state.mapMode === "head") state.headView = target.dataset.view; else state.bodyView = target.dataset.view; render(); return; }
    if (action === "map-region") {
      const region = state.config.bodyRegions.find((item) => item.id === target.dataset.region);
      if (!region) return;
      const index = state.form.bodyMap.findIndex((item) => item.regionId === region.id && (item.map || "body") === regionMap(region));
      if (index >= 0) state.form.bodyMap.splice(index, 1);
      else state.form.bodyMap.push({ regionId: region.id, label: region.label, map: regionMap(region), view: region.view, point: { x: 0.5, y: 0.5 } });
      state.error = "";
      render();
      return;
    }
    if (action === "remove-region") { state.form.bodyMap = state.form.bodyMap.filter((item) => item.regionId !== target.dataset.region); render(); return; }
    if (action === "remove-photo") { state.form.skinPhotos.splice(Number(target.dataset.index), 1); render(); return; }
    if (action === "remove-document") { state.form.document = null; render(); return; }
    if (action === "clear-signature") { state.form.signature = null; render(); return; }
    if (action === "edit-step") { state.step = Number(target.dataset.step); state.error = ""; render(); return; }
    if (action === "staff-select") { await loadStaffDetail(target.dataset.session); return; }
    if (action === "back-staff") { state.selectedSessionId = null; state.staffDetail = null; render(); return; }
    if (action === "reload-staff") { await refreshStaff(); return; }
    if (action === "new-session") { await createSession(); return; }
    if (action === "staff-delete") { await deleteSession(target.dataset.session); return; }
    if (action === "alert-action") { await alertAction(target.dataset.alertAction); return; }
  });

  initialize();
})();
