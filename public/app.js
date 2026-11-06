const $ = (s) => document.querySelector(s),
  content = $("#content");
let me,
  current,
  view,
  filter = "",
  rows = [],
  selectedVersionId = null,
  selectedEmailId = null;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(url, method = "GET", data) {
  const r = await fetch("/api" + url, {
    method,
    headers:
      data instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: data
      ? data instanceof FormData
        ? data
        : JSON.stringify(data)
      : undefined,
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error);
  return b;
}
function notice(e) {
  $("#notice").textContent = e?.message || e || "";
}
function on(selector, event, fn) {
  document.querySelectorAll(selector).forEach((el) =>
    el.addEventListener(event, async (e) => {
      try {
        await fn(e, el);
      } catch (err) {
        notice(err);
      }
    }),
  );
}
function table(headers, body) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}"><div class="empty">Nog geen gegevens. Voeg het eerste item toe.</div></td></tr>`}</tbody></table></div>`;
}
function field(name, label, type = "text", value = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${type === "password" ? 'minlength="12"' : ""}></label>`;
}
function select(name, label, options) {
  return `<label>${label}<select name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select></label>`;
}
function modal(title, html, save) {
  $("#modal button[type=submit]").textContent = "Opslaan";
  $("#modal-title").textContent = title;
  $("#modal-fields").innerHTML = html;
  $("#modal-error").textContent = "";
  $("#dialog").showModal();
  $("#modal").onsubmit = async (e) => {
    e.preventDefault();
    const button = $("#modal button[type=submit]");
    button.disabled = true;
    try {
      await save(Object.fromEntries(new FormData(e.target)), e.target);
      $("#dialog").close();
    } catch (e) {
      $("#modal-error").textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
}
$("#close").onclick = () => $("#dialog").close();
function heading(title, sub, action = "") {
  return `<div class="heading"><div><div class="eyebrow">DoMuS · werkruimte</div><h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>${action}</div>`;
}
async function start() {
  try {
    me = await api("/me");
    view = me.default_view;
    $("#account").innerHTML =
      `<span class="user-chip">${esc(me.username).slice(0, 1).toUpperCase()}</span><span>${esc(me.username)}</span><button id="logout" class="quiet">Uitloggen</button>`;
    $("#logout").onclick = async () => {
      await api("/logout", "POST");
      location.reload();
    };
    $("#nav").innerHTML =
      '<button data-page="cases"><span>▣</span>Dossiers</button><button data-page="clients"><span>◎</span>Relaties</button><button data-page="preferences"><span>⚙</span>Voorkeuren</button>' +
      (me.admin ? '<button data-page="admin"><span>◇</span>Beheer</button>' : "");
    on("[data-page]", "click", (_, el) => navigate(el.dataset.page));
    await navigate("cases");
  } catch (e) {
    if (!me) login();
    else notice(e);
  }
}
function login() {
  content.innerHTML = `<div class="card login"><div class="eyebrow">Welkom terug</div><h1>Je dossiers, op één plek.</h1><form id="login">${field("username", "Gebruikersnaam")}${field("password", "Wachtwoord", "password")}<button class="primary">Inloggen</button></form></div>`;
  on("#login", "submit", async (e) => {
    e.preventDefault();
    await api("/login", "POST", Object.fromEntries(new FormData(e.target)));
    notice("");
    await start();
  });
}
async function navigate(page) {
  notice("");
  if (page !== "cases") current = null;
  $("#crumb").textContent = page.toUpperCase();
  document
    .querySelectorAll("[data-page]")
    .forEach((e) => e.classList.toggle("active", e.dataset.page === page));
  if (page === "cases") await cases();
  if (page === "clients") await clients();
  if (page === "admin") await admin();
  if (page === "preferences") preferences();
}
async function cases(q = "") {
  const data = await api("/cases?q=" + encodeURIComponent(q));
  content.innerHTML =
    heading(
      "Dossiers",
      "Overzicht, structuur en ruimte voor ieder detail.",
      '<button class="primary" id="new-case">+ Nieuw dossier</button>',
    ) +
    `<div class="stats"><div class="stat"><small>ZICHTBARE DOSSIERS</small><strong>${data.length}</strong></div><div class="stat"><small>HOOFDDOSSIERS</small><strong>${data.filter((c) => !c.parent_id).length}</strong></div><div class="stat"><small>SUBDOSSIERS</small><strong>${data.filter((c) => c.parent_id).length}</strong></div></div><form id="search" class="toolbar"><input name="q" type="search" placeholder="Zoek op klant, dossiernummer of titel…" value="${esc(q)}"><button>Zoeken</button></form>` +
    table(
      ["DOSSIERNUMMER", "DOSSIER", "KLANT", "TYPE", ""],
      data
        .map(
          (c) =>
            `<tr data-case-row="${c.id}" tabindex="0"><td class="number">${esc(c.number)}</td><td><strong>${esc(c.title)}</strong></td><td>${esc(c.client)}</td><td><span class="tag">${c.parent_id ? "Subdossier" : "Hoofddossier"}</span></td><td><button data-case="${c.id}">Openen →</button></td></tr>`,
        )
        .join(""),
    );
  on("#search", "submit", (e) => {
    e.preventDefault();
    return cases(new FormData(e.target).get("q"));
  });
  on("[data-case]", "click", (_, el) => openCase(el.dataset.case));
  on("[data-case-row]", "dblclick", (_, el) =>
    openCase(el.dataset.caseRow),
  );
  on("[data-case-row]", "keydown", (event, el) => {
    if (event.key === "Enter") return openCase(el.dataset.caseRow);
  });
  on("#new-case", "click", () => newCase());
}
async function newCase(parent) {
  const customers = parent
    ? [{ id: parent.client_id, name: parent.client }]
    : await api("/clients");
  modal(
    parent ? "Nieuw subdossier" : "Nieuw dossier",
    field("title", "Titel") +
      select(
        "client_id",
        "Klant",
        customers.map((c) => [c.id, c.name]),
      ) +
      (parent
        ? ""
        : field("number", "Eigen dossiernummer (leeg = automatisch)")),
    async (b) => {
      const r = await api("/cases", "POST", {
        title: b.title,
        client_id: Number(b.client_id),
        parent_id: parent?.id || null,
        ...(b.number ? { number: b.number } : {}),
      });
      await openCase(r.id);
    },
  );
}
async function clients() {
  const data = await api("/clients");
  content.innerHTML =
    heading(
      "Relaties",
      "Alle klantgegevens binnen handbereik.",
      '<button id="new-client" class="primary">+ Nieuwe klant</button>',
    ) +
    table(
      ["NAAM", "E-MAIL", "TELEFOON", ""],
      data
        .map(
          (c) =>
            `<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td><button data-edit="${c.id}">Bewerken</button></td></tr>`,
        )
        .join(""),
    );
  function edit(c = {}) {
    modal(
      c.id ? "Klant bewerken" : "Nieuwe klant",
      ["name", "email", "phone", "address", "notes"]
        .map((n, i) =>
          field(
            n,
            ["Naam", "E-mail", "Telefoon", "Adres", "Notities"][i],
            n === "email" ? "email" : "text",
            c[n] || "",
          ),
        )
        .join(""),
      async (b) => {
        await api(
          "/clients" + (c.id ? "/" + c.id : ""),
          c.id ? "PUT" : "POST",
          b,
        );
        await clients();
      },
    );
  }
  on("#new-client", "click", () => edit());
  on("[data-edit]", "click", (_, el) =>
    edit(data.find((c) => c.id === Number(el.dataset.edit))),
  );
}
async function openCase(id) {
  current = await api("/cases/" + id);
  filter = "";
  selectedVersionId = null;
  selectedEmailId = null;
  await drawCase();
}
const has = (p) => current.permissions.includes(p);
async function drawCase() {
  const c = current;
  $("#crumb").textContent = `${c.number} / ${c.title}`.toUpperCase();
  content.innerHTML =
    `<div class="case-caption"><button id="back" class="back-button" title="Terug naar dossiers">‹</button><div><span class="number">${esc(c.number)}</span><h1>${esc(c.title)}</h1><p>${esc(c.client)}</p></div><div class="case-actions">${has("case.write") ? '<button id="renumber">Dossier wijzigen</button>' + (!c.parent_id ? '<button id="subcase">+ Subdossier</button>' : "") : ""}</div></div>` +
    `<div class="tabs subfunctions" role="tablist">${[
      ["manager", "Document Manager"],
      ["explorer", "Dossier Verkenner"],
      ["metadata", "Algemeen"],
      ["emails", "Correspondentie"],
    ]
      .map(
        ([v, l]) =>
          `<button role="tab" aria-selected="${view === v}" data-view="${v}" class="${view === v ? "selected" : ""}">${l}</button>`,
      )
      .join("")}</div><div id="case-body" class="case-body"></div>`;
  on("#back", "click", () => cases());
  on("#subcase", "click", () => newCase(c));
  on("#renumber", "click", () =>
    modal(
      "Dossiernummer wijzigen",
      field("number", "Nummer", "text", c.number),
      async (b) => {
        await api(`/cases/${c.id}/number`, "PUT", b);
        await openCase(c.id);
      },
    ),
  );
  on("[data-view]", "click", async (_, el) => {
    view = el.dataset.view;
    filter = "";
    await drawCase();
  });
  if (view === "metadata") metadata();
  else if (view === "emails") await emails();
  else await documents();
}
async function documents() {
  const target = $("#case-body");
  if (!has("document.read")) {
    target.innerHTML =
      '<div class="empty">Geen leesrechten voor documenten.</div>';
    return;
  }
  rows = await api(`/cases/${current.id}/documents`);
  const manager = view === "manager",
    tags = [...new Set(rows.flatMap((r) => r.tags))];
  const groups = manager
    ? tags.map((t) => [t, t])
    : current.folders.map((f) => [String(f.id), f.path]);
  let shown = manager
    ? rows.filter(
        (r, i) => rows.findIndex((x) => x.document_id === r.document_id) === i,
      )
    : rows;
  if (filter)
    shown = shown.filter((r) =>
      manager
        ? r.tags.includes(filter)
        : current.folders.find((f) => String(f.id) === filter)?.path === r.path,
    );
  if (!shown.some((row) => row.id === selectedVersionId))
    selectedVersionId = shown[0]?.id ?? null;
  const selected = shown.find((row) => row.id === selectedVersionId),
    history = selected
      ? rows.filter((row) => row.document_id === selected.document_id)
      : [];
  const tree = `<aside class="workspace-tree" aria-label="Dossierstructuur"><div class="tree-title"><span class="tree-case-icon">D</span><div><strong>${esc(current.number)}</strong><small>${esc(current.title)}</small></div></div><button data-tree-view="metadata">▾ Dossiergegevens</button><div class="tree-group"><button data-tree-view="${manager ? "manager" : "explorer"}" class="tree-parent selected">▾ Documenten</button><button data-filter="" class="tree-child ${!filter ? "selected" : ""}">Alle documenten <span>${shown.length}</span></button>${groups.map(([id, label]) => `<button data-filter="${esc(id)}" class="tree-child ${filter === id ? "selected" : ""}">▻ ${esc(label)}</button>`).join("")}</div><button data-tree-view="emails">▸ Correspondentie</button></aside>`;
  const list = shown.length
    ? `<div class="table-wrap document-table"><table><thead><tr><th>NAAM</th><th>${manager ? "CATEGORIE" : "MAP"}</th><th>GEWIJZIGD</th><th>VERSIE</th></tr></thead><tbody>${shown.map((row) => `<tr tabindex="0" data-document="${row.id}" class="${row.id === selectedVersionId ? "selected-row" : ""}"><td><span class="file-icon">${esc((row.filename.split(".").pop() || "DOC").slice(0, 4).toUpperCase())}</span><strong>${esc(manager ? row.title : row.filename)}</strong><small>${Math.ceil(row.size / 1024)} KB</small></td><td>${manager ? row.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("") || '<span class="muted">Niet geclassificeerd</span>' : esc(row.path)}</td><td>${new Date(row.created_at).toLocaleDateString("nl-NL")}</td><td>v${row.version}</td></tr>`).join("")}</tbody></table></div>`
    : '<div class="empty document-empty">Geen documenten in deze selectie.</div>';
  const inspector = selected
    ? `<aside class="inspector"><div class="inspector-head"><span class="file-preview-icon">${esc((selected.filename.split(".").pop() || "DOC").slice(0, 4).toUpperCase())}</span><div><strong>${esc(manager ? selected.title : selected.filename)}</strong><small>Versie ${selected.version}</small></div></div><dl><dt>Map</dt><dd>${esc(selected.path)}</dd><dt>Grootte</dt><dd>${Math.ceil(selected.size / 1024)} KB</dd><dt>Categorieën</dt><dd>${selected.tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join("") || "—"}</dd></dl><div class="inspector-actions"><a class="button primary" href="/api/versions/${selected.id}/download">Downloaden</a>${has("document.open") ? `<button data-open="${selected.id}">Open lokaal</button>` : ""}${has("document.write") ? `<button data-version="${selected.document_id}">Nieuwe versie</button>` : ""}</div>${manager && history.length > 1 ? `<div class="version-list"><h3>Versiehistorie</h3>${history.map((item) => `<button data-document="${item.id}" class="${item.id === selected.id ? "active" : ""}"><span>v${item.version}</span>${esc(item.filename)}</button>`).join("")}</div>` : ""}</aside>`
    : '<aside class="inspector empty-inspector"><strong>Geen document geselecteerd</strong><p>Selecteer een document om de eigenschappen en acties te zien.</p></aside>';
  target.innerHTML = `<div class="commandbar"><div>${has("document.write") ? '<button id="upload" class="primary">＋ Nieuw document</button><button id="folder">＋ Map</button>' : ""}</div><div class="commandbar-info"><span>F4</span>${manager ? "Documenten per categorie" : "Bestanden per map en versie"}</div></div><div class="dossier-workspace">${tree}<section class="data-pane document-dropzone"><div class="drop-overlay" aria-hidden="true"><span>⇩</span><strong>Drop to upload</strong><small>Laat los om de bestanden te classificeren</small></div><div class="pane-title"><div><strong>${filter ? esc(groups.find(([id]) => id === filter)?.[1] || filter) : "Alle documenten"}</strong><small>${shown.length} ${shown.length === 1 ? "resultaat" : "resultaten"}</small></div><span class="drop-message">Sleep bestanden hierheen</span></div>${list}</section>${inspector}</div>`;
  on("[data-filter]", "click", (_, el) => {
    filter = el.dataset.filter;
    return documents();
  });
  on("[data-tree-view]", "click", async (_, el) => {
    view = el.dataset.treeView;
    filter = "";
    await drawCase();
  });
  on("[data-document]", "click", (_, el) => {
    selectedVersionId = Number(el.dataset.document);
    return documents();
  });
  on("[data-document]", "keydown", (event, el) => {
    if (event.key === "Enter") {
      selectedVersionId = Number(el.dataset.document);
      return documents();
    }
  });
  on("#folder", "click", () =>
    modal(
      "Nieuwe map",
      field("path", "Mappad, bijvoorbeeld /Correspondentie"),
      async (b) => {
        await api(`/cases/${current.id}/folders`, "POST", b);
        current = await api("/cases/" + current.id);
        await documents();
      },
    ),
  );
  function upload(doc, droppedFiles = []) {
    let queuedFiles = [...droppedFiles];
    const droppedSummary = queuedFiles.length
      ? `<div class="drop-file-list"><strong>${queuedFiles.length} ${queuedFiles.length === 1 ? "bestand" : "bestanden"} geselecteerd</strong><ul>${queuedFiles
          .slice(0, 8)
          .map(
            (file) =>
              `<li><span>${esc(file.name)}</span><small>${Math.ceil(file.size / 1024)} KB</small></li>`,
          )
          .join("")}</ul>${queuedFiles.length > 8 ? `<small>En nog ${queuedFiles.length - 8} bestanden…</small>` : ""}</div>`
      : "";
    modal(
      doc
        ? "Nieuwe documentversie"
        : queuedFiles.length > 1
          ? `${queuedFiles.length} documenten uploaden`
          : "Document uploaden",
      (queuedFiles.length ? droppedSummary : field("file", "Bestand", "file")) +
        (doc
          ? ""
          : select(
              "folder_id",
              "Map",
              current.folders.map((f) => [f.id, f.path]),
            ) + field("tags", "Categorieën, gescheiden door komma’s")),
      async (b, form) => {
        const selectedFiles = queuedFiles.length
          ? [...queuedFiles]
          : [new FormData(form).get("file")];
        if (!selectedFiles[0]?.name) throw Error("Selecteer minimaal één bestand.");
        const tooLarge = selectedFiles.find(
          (file) => file.size > 25 * 1024 * 1024,
        );
        if (tooLarge)
          throw Error(`${tooLarge.name} is groter dan de uploadlimiet van 25 MiB.`);
        const tags = doc
          ? []
          : b.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean);
        let completed = 0;
        try {
          for (const file of selectedFiles) {
            notice(
              `${file.name} uploaden (${completed + 1} van ${selectedFiles.length})…`,
            );
            const data = new FormData();
            data.set("file", file, file.name);
            if (doc) data.set("document_id", doc);
            else {
              data.set("folder_id", b.folder_id);
              data.set("tags", JSON.stringify(tags));
            }
            await api(`/cases/${current.id}/documents`, "POST", data);
            completed++;
            if (queuedFiles.length) queuedFiles.shift();
          }
        } catch (error) {
          if (completed) {
            await documents();
            throw Error(
              `${completed} ${completed === 1 ? "bestand is" : "bestanden zijn"} toegevoegd. ${queuedFiles.length} resterend; probeer opnieuw. ${error.message}`,
            );
          }
          throw error;
        }
        await documents();
        notice(
          `${completed} ${completed === 1 ? "bestand" : "bestanden"} toegevoegd.`,
        );
      },
    );
  }
  on("#upload", "click", () => upload());
  on("[data-version]", "click", (_, el) => upload(el.dataset.version));
  on("[data-open]", "click", async (_, el) => {
    await api("/versions/" + el.dataset.open + "/open", "POST");
    notice("Openverzoek naar de desktopclient gestuurd.");
  });
  const dropzone = $(".document-dropzone");
  if (dropzone && has("document.write")) {
    let dragDepth = 0;
    dropzone.addEventListener("dragenter", (e) => {
      e.preventDefault();
      dragDepth++;
      dropzone.classList.add("dragging");
    });
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      if (--dragDepth <= 0) {
        dragDepth = 0;
        dropzone.classList.remove("dragging");
      }
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      dropzone.classList.remove("dragging");
      const files = [...e.dataTransfer.files];
      if (!files.length) return;
      if (files.length > 50) {
        notice("Sleep maximaal 50 bestanden tegelijk naar het dossier.");
        return;
      }
      upload(null, files);
    });
  }
}
function metadata() {
  const fields = current.fields;
  $("#case-body").innerHTML =
    `<div class="dossier-workspace metadata-workspace"><aside class="workspace-tree"><div class="tree-title"><span class="tree-case-icon">D</span><div><strong>${esc(current.number)}</strong><small>${esc(current.title)}</small></div></div><button class="selected">▾ Dossiergegevens</button><button data-tree-view="manager">▸ Documenten</button><button data-tree-view="emails">▸ Correspondentie</button></aside><div class="card metadata-card"><div class="pane-title"><div><strong>Algemene dossiergegevens</strong><small>Velden die bij dit dossier horen</small></div></div><form id="metadata">${
      fields.length
        ? fields
            .map((f) =>
              f.type === "boolean"
                ? select(
                    String(f.id),
                    esc(f.label) + (f.required ? " *" : ""),
                    [
                      ["", "Niet ingevuld"],
                      ["true", "Ja"],
                      ["false", "Nee"],
                    ],
                  )
                : field(
                    f.id,
                    esc(f.label) + (f.required ? " *" : ""),
                    f.type,
                    f.value || "",
                  ),
            )
            .join("")
        : '<p class="muted">Een beheerder kan hier velden toevoegen via Beheer.</p>'
    }${has("metadata.write") ? '<button class="primary">Metadata opslaan</button>' : ""}</form></div><aside class="inspector case-summary"><h3>Dossier</h3><dl><dt>Nummer</dt><dd class="number">${esc(current.number)}</dd><dt>Omschrijving</dt><dd>${esc(current.title)}</dd><dt>Relatie</dt><dd>${esc(current.client)}</dd><dt>Type</dt><dd>${current.parent_id ? "Subdossier" : "Hoofddossier"}</dd></dl></aside></div>`;
  on("[data-tree-view]", "click", async (_, el) => {
    view = el.dataset.treeView;
    await drawCase();
  });
  for (const f of fields.filter((f) => f.type === "boolean"))
    $(`[name="${f.id}"]`).value = f.value || "";
  on("#metadata", "submit", async (e) => {
    e.preventDefault();
    await api(
      `/cases/${current.id}/metadata`,
      "PUT",
      Object.fromEntries(new FormData(e.target)),
    );
    current = await api("/cases/" + current.id);
    notice("Metadata opgeslagen.");
  });
}
async function emails() {
  if (!has("email.read")) {
    $("#case-body").innerHTML =
      '<div class="empty">Geen leesrechten voor e-mails.</div>';
    return;
  }
  const messages = await api(`/cases/${current.id}/emails`);
  if (!messages.some((message) => message.id === selectedEmailId))
    selectedEmailId = messages[0]?.id ?? null;
  const selected = messages.find((message) => message.id === selectedEmailId);
  $("#case-body").innerHTML =
    `<div class="commandbar"><div>${has("email.send") ? '<button id="send" class="primary">＋ Nieuwe e-mail</button>' : ""}${has("email.import") ? '<button id="import">Importeer bestand</button><button id="imap">IMAP ophalen</button>' : ""}</div><div class="commandbar-info">Correspondentie op dossierniveau</div></div><div class="dossier-workspace mail-workspace"><aside class="workspace-tree"><div class="tree-title"><span class="tree-case-icon">D</span><div><strong>${esc(current.number)}</strong><small>${esc(current.title)}</small></div></div><button data-tree-view="metadata">▸ Dossiergegevens</button><button data-tree-view="manager">▸ Documenten</button><div class="tree-group"><button class="tree-parent selected">▾ Correspondentie</button><button class="tree-child selected">Alle berichten <span>${messages.length}</span></button></div></aside><section class="mail-list"><div class="pane-title"><div><strong>E-mailarchief</strong><small>${messages.length} ${messages.length === 1 ? "bericht" : "berichten"}</small></div></div>${messages.map((message) => `<button data-email="${message.id}" class="mail-row ${message.id === selectedEmailId ? "selected" : ""}"><span class="mail-direction">${message.direction === "in" ? "↓" : "↑"}</span><span><strong>${esc(message.subject || "(zonder onderwerp)")}</strong><small>${esc(message.direction === "in" ? message.sender : message.recipients)}</small></span><span><small>${new Date(message.created_at).toLocaleDateString("nl-NL")}</small><em>${esc(message.status)}</em></span></button>`).join("") || '<div class="empty">Nog geen e-mails in dit dossier.</div>'}</section><aside class="mail-preview">${selected ? `<div class="mail-preview-head"><span class="tag">${selected.direction === "in" ? "Ontvangen" : "Verzonden"}</span><h2>${esc(selected.subject || "(zonder onderwerp)")}</h2><dl><dt>Van</dt><dd>${esc(selected.sender)}</dd><dt>Aan</dt><dd>${esc(selected.recipients)}</dd></dl></div><pre class="email">${esc(selected.body)}</pre>${selected.direction === "in" ? `<a class="button" href="/api/emails/${selected.id}/original">Origineel downloaden</a>` : ""}` : '<div class="empty"><strong>Geen bericht geselecteerd</strong></div>'}</aside></div>`;
  on("[data-tree-view]", "click", async (_, el) => {
    view = el.dataset.treeView;
    await drawCase();
  });
  on("[data-email]", "click", (_, el) => {
    selectedEmailId = Number(el.dataset.email);
    return emails();
  });
  on("#import", "click", () =>
    modal(
      "E-mail importeren",
      field("file", "EML of MSG", "file"),
      async (_, form) => {
        await api(
          `/cases/${current.id}/emails/import`,
          "POST",
          new FormData(form),
        );
        await emails();
      },
    ),
  );
  on("#imap", "click", async (_, el) => {
    el.disabled = true;
    try {
      const r = await api(`/cases/${current.id}/emails/imap`, "POST");
      notice(`${r.imported} e-mails geïmporteerd (laatste 100 berichten).`);
      await emails();
    } finally {
      el.disabled = false;
    }
  });
  on("#send", "click", async () => {
    const t = await api("/templates");
    modal(
      "E-mail versturen",
      field("to", "Ontvanger", "email") +
        select(
          "template_id",
          "Template",
          t.map((x) => [x.id, x.name]),
        ),
      async (b) => {
        await api(`/cases/${current.id}/emails/send`, "POST", {
          to: b.to,
          template_id: Number(b.template_id),
        });
        await emails();
      },
    );
    $("#modal button[type=submit]").textContent = "Versturen";
  });
}
function preferences() {
  content.innerHTML =
    heading("Voorkeuren", "Stel je eigen startweergave in.") +
    `<div class="card"><form id="preferences">${select(
      "view",
      "Standaard dossierweergave",
      [
        ["manager", "Document Manager"],
        ["explorer", "Document Verkenner"],
        ["metadata", "Dossiermetadata"],
      ],
    )}<button class="primary">Opslaan</button></form></div><div class="card"><h2>Desktopclient koppelen</h2><p class="muted">Open de Electron-client en gebruik dezelfde server-URL en het onderstaande eenmalige ticket. Geldig gedurende één minuut.</p><button id="ticket">Ticket maken</button><p id="ticket-value"></p></div>`;
  $("[name=view]").value = me.default_view;
  on("#preferences", "submit", async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    await api("/me/view", "PUT", b);
    me.default_view = view = b.view;
    notice("Voorkeur opgeslagen.");
  });
  on("#ticket", "click", async () => {
    $("#ticket-value").textContent = (
      await api("/desktop/ticket", "POST")
    ).ticket;
  });
}
async function admin() {
  const data = await api("/admin");
  content.innerHTML =
    heading("Beheer", "Gebruikers, toegangsrechten en dossierinstellingen.") +
    `<div class="toolbar">${[
      ["user", "Gebruiker"],
      ["role", "Rol"],
      ["membership", "Rol toewijzen"],
      ["acl", "Recht"],
      ["field", "Metadataveld"],
      ["template", "E-mailtemplate"],
    ]
      .map(([v, l]) => `<button data-add="${v}">+ ${l}</button>`)
      .join(
        "",
      )}</div><div class="grid"><div class="card"><h2>Standaardinstellingen</h2><form id="settings">${select(
      "default_view",
      "Startweergave",
      [
        ["manager", "Document Manager"],
        ["explorer", "Document Verkenner"],
        ["metadata", "Dossiermetadata"],
      ],
    )}${select("number_width", "Aantal volgcijfers", [
      ["4", "4 — 2026110001.00"],
      ["5", "5 — 20261100001.00"],
    ])}<button class="primary">Opslaan</button></form></div><div class="card"><h2>Rechtenmodel</h2><p>Gebruikers krijgen rechten via rollen. Een recht kan globaal of per dossier gelden. Hoofddossierrechten gelden ook voor subdossiers.</p><p>Weigeren gaat vóór toestaan. Zonder toekenning is toegang geweigerd. Beheerders hebben volledige toegang.</p><p class="muted">Een gebruiker heeft naast documentrechten ook case.read nodig om een dossier te vinden.</p></div></div><h2>Gebruikers</h2>${table(["NAAM", "TYPE", "STATUS", ""], data.users.map((u) => `<tr><td>${esc(u.username)}</td><td>${u.admin ? "Beheerder" : "Gebruiker"}</td><td>${u.active ? "Actief" : "Uitgeschakeld"}</td><td><button data-user="${u.id}">Beheren</button></td></tr>`).join(""))}<h2>Roltoewijzingen</h2>${table(["GEBRUIKER", "ROL", ""], data.memberships.map((m) => `<tr><td>${esc(data.users.find((u) => u.id === m.user_id)?.username)}</td><td>${esc(data.roles.find((r) => r.id === m.role_id)?.name)}</td><td><button data-membership="${m.user_id}/${m.role_id}">Verwijderen</button></td></tr>`).join(""))}<h2>Toegangsregels</h2>${table(["ROL", "DOSSIER-ID", "ACTIE", "EFFECT", ""], data.acl.map((a) => `<tr><td>${esc(data.roles.find((r) => r.id === a.role_id)?.name)}</td><td>${a.case_id || "Alle dossiers"}</td><td>${esc(a.permission)}</td><td>${esc(a.effect)}</td><td><button data-rule="${a.id}">Verwijderen</button></td></tr>`).join(""))}<h2>Metadatavelden</h2>${table(["NAAM", "LABEL", "TYPE", "VERPLICHT"], data.fields.map((f) => `<tr><td>${esc(f.name)}</td><td>${esc(f.label)}</td><td>${esc(f.type)}</td><td>${f.required ? "Ja" : "Nee"}</td></tr>`).join(""))}<h2>E-mailtemplates</h2>${table(["NAAM", "ONDERWERP"], data.templates.map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.subject)}</td></tr>`).join(""))}<h2>Activiteitenlog (laatste 100)</h2>${table(["GEBRUIKER-ID", "ACTIE", "OBJECT", "DATUM"], data.audit.map((a) => `<tr><td>${a.user_id}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td><td>${esc(a.created_at)}</td></tr>`).join(""))}`;
  for (const s of data.settings) {
    const el = $(`[name="${s.name}"]`);
    if (el) el.value = s.value;
  }
  on("#settings", "submit", async (e) => {
    e.preventDefault();
    await api(
      "/admin/settings",
      "PUT",
      Object.fromEntries(new FormData(e.target)),
    );
    notice("Instellingen opgeslagen.");
  });
  on("[data-rule]", "click", async (_, el) => {
    await api("/admin/acl/" + el.dataset.rule, "DELETE");
    await admin();
  });
  on("[data-membership]", "click", async (_, el) => {
    await api("/admin/memberships/" + el.dataset.membership, "DELETE");
    await admin();
  });
  on("[data-user]", "click", (_, el) => {
    const u = data.users.find((u) => u.id === Number(el.dataset.user));
    modal(
      "Gebruiker beheren",
      select("active", "Status", [
        ["true", "Actief"],
        ["false", "Uitgeschakeld"],
      ]) + field("password", "Nieuw wachtwoord (leeg = behouden)", "password"),
      async (b) => {
        await api("/admin/users/" + u.id, "PUT", {
          active: b.active === "true",
          ...(b.password ? { password: b.password } : {}),
        });
        await admin();
      },
    );
    $("[name=active]").value = String(!!u.active);
  });
  on("[data-add]", "click", (_, el) => {
    const kind = el.dataset.add,
      roles = select(
        "role_id",
        "Rol",
        data.roles.map((r) => [r.id, r.name]),
      );
    const forms = {
      user:
        field("username", "Gebruikersnaam") +
        field("password", "Wachtwoord (minimaal 12 tekens)", "password") +
        select("admin", "Type", [
          ["false", "Gebruiker"],
          ["true", "Beheerder"],
        ]),
      role: field("name", "Rolnaam"),
      membership:
        select(
          "user_id",
          "Gebruiker",
          data.users.map((u) => [u.id, u.username]),
        ) + roles,
      acl:
        roles +
        field("case_id", "Dossier-ID (leeg = globaal)", "number") +
        select(
          "permission",
          "Actie",
          data.permissions.map((p) => [p, p]),
        ) +
        select("effect", "Effect", [
          ["allow", "Toestaan"],
          ["deny", "Weigeren"],
        ]),
      field:
        field("name", "Technische naam (bijv. referentie)") +
        field("label", "Label") +
        select(
          "type",
          "Type",
          ["text", "number", "date", "boolean"].map((t) => [t, t]),
        ) +
        select("required", "Verplicht", [
          ["false", "Nee"],
          ["true", "Ja"],
        ]),
      template:
        field("name", "Naam") +
        field("subject", "Onderwerp") +
        '<label>Berichttekst<textarea name="body"></textarea></label><p class="muted">Variabelen: {{client}}, {{number}}, {{title}}</p>',
    };
    const routes = {
      user: "users",
      role: "roles",
      membership: "memberships",
      acl: "acl",
      field: "fields",
      template: "templates",
    };
    modal("Toevoegen", forms[kind], async (b) => {
      for (const k of ["role_id", "user_id"]) if (k in b) b[k] = Number(b[k]);
      if ("case_id" in b) b.case_id = b.case_id ? Number(b.case_id) : null;
      for (const k of ["admin", "required"]) if (k in b) b[k] = b[k] === "true";
      await api("/admin/" + routes[kind], "POST", b);
      await admin();
    });
  });
}
document.addEventListener("keydown", async (event) => {
  if (!current || $("#dialog").open || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))
    return;
  if (event.key === "F4") {
    event.preventDefault();
    view = "manager";
    filter = "";
    await drawCase();
  }
});
start();
