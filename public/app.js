const $ = (s) => document.querySelector(s),
  content = $("#content");
let me,
  current,
  view,
  filter = "",
  rows = [];
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
  return `<div class="heading"><div><div class="eyebrow">DoMuS / werkruimte</div><h1>${esc(title)}</h1><p class="muted">${esc(sub)}</p></div>${action}</div>`;
}
async function start() {
  try {
    me = await api("/me");
    view = me.default_view;
    $("#account").innerHTML =
      `${esc(me.username)} &nbsp; <button id="logout">Uitloggen</button>`;
    $("#logout").onclick = async () => {
      await api("/logout", "POST");
      location.reload();
    };
    $("#nav").innerHTML =
      '<button data-page="cases">Dossiers</button><button data-page="clients">CRM</button><button data-page="preferences">Voorkeuren</button>' +
      (me.admin ? '<button data-page="admin">Beheer</button>' : "");
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
            `<tr><td class="number">${esc(c.number)}</td><td><strong>${esc(c.title)}</strong></td><td>${esc(c.client)}</td><td><span class="tag">${c.parent_id ? "Subdossier" : "Hoofddossier"}</span></td><td><button data-case="${c.id}">Openen →</button></td></tr>`,
        )
        .join(""),
    );
  on("#search", "submit", (e) => {
    e.preventDefault();
    return cases(new FormData(e.target).get("q"));
  });
  on("[data-case]", "click", (_, el) => openCase(el.dataset.case));
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
  await drawCase();
}
const has = (p) => current.permissions.includes(p);
async function drawCase() {
  const c = current;
  content.innerHTML =
    heading(
      c.title,
      `${c.number} · ${c.client}`,
      `<div class="toolbar"><button id="back">← Dossiers</button>${has("case.write") ? '<button id="renumber">Nummer wijzigen</button>' + (!c.parent_id ? '<button id="subcase">+ Subdossier</button>' : "") : ""}</div>`,
    ) +
    `<div class="tabs">${[
      ["manager", "Document Manager"],
      ["explorer", "Document Verkenner"],
      ["metadata", "Dossiermetadata"],
      ["emails", "E-mails"],
    ]
      .map(
        ([v, l]) =>
          `<button data-view="${v}" class="${view === v ? "selected" : ""}">${l}</button>`,
      )
      .join("")}</div><div id="case-body"></div>`;
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
  target.innerHTML = `<div class="toolbar">${has("document.write") ? '<button id="upload" class="primary">+ Document uploaden</button><button id="folder">+ Map</button>' : ""}<span class="muted">${manager ? "Eén document, alle versies bij elkaar." : "Elke versie als afzonderlijk bestand."}</span></div><div class="split"><div class="filter"><div class="eyebrow">${manager ? "Categorieën" : "Mappen"}</div><button data-filter="" class="${!filter ? "selected" : ""}">Alles</button>${groups.map(([id, l]) => `<button data-filter="${esc(id)}" class="${filter === id ? "selected" : ""}">${esc(l)}</button>`).join("")}</div><div>${table(["BESTAND", "MAP / CATEGORIE", "VERSIE", ""], shown.map((r) => `<tr><td><strong>${esc(manager ? r.title : r.filename)}</strong><div class="muted small">${Math.ceil(r.size / 1024)} KB</div></td><td>${esc(r.path)}<br>${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</td><td>v${r.version}</td><td><a class="button" href="/api/versions/${r.id}/download">Download</a> ${has("document.open") ? `<button data-open="${r.id}">Open lokaal</button>` : ""} ${has("document.write") ? `<button data-version="${r.document_id}">+ Versie</button>` : ""}</td></tr>`).join(""))}</div></div>`;
  on("[data-filter]", "click", (_, el) => {
    filter = el.dataset.filter;
    return documents();
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
  function upload(doc) {
    modal(
      doc ? "Nieuwe documentversie" : "Document uploaden",
      field("file", "Bestand", "file") +
        (doc
          ? ""
          : select(
              "folder_id",
              "Map",
              current.folders.map((f) => [f.id, f.path]),
            ) + field("tags", "Categorieën, gescheiden door komma’s")),
      async (b, form) => {
        const data = new FormData(form);
        if (doc) data.set("document_id", doc);
        else
          data.set(
            "tags",
            JSON.stringify(
              b.tags
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean),
            ),
          );
        await api(`/cases/${current.id}/documents`, "POST", data);
        await documents();
      },
    );
  }
  on("#upload", "click", () => upload());
  on("[data-version]", "click", (_, el) => upload(el.dataset.version));
  on("[data-open]", "click", async (_, el) => {
    await api("/versions/" + el.dataset.open + "/open", "POST");
    notice("Openverzoek naar de desktopclient gestuurd.");
  });
}
function metadata() {
  const fields = current.fields;
  $("#case-body").innerHTML =
    `<div class="card"><h2>Dossiermetadata</h2><form id="metadata">${
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
    }${has("metadata.write") ? '<button class="primary">Metadata opslaan</button>' : ""}</form></div>`;
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
  $("#case-body").innerHTML =
    `<div class="toolbar">${has("email.import") ? '<button id="import">Importeer .eml / .msg</button><button id="imap">Importeer via IMAP</button>' : ""}${has("email.send") ? '<button id="send" class="primary">Verstuur vanuit template</button>' : ""}</div>${messages.map((m) => `<details class="card"><summary><strong>${esc(m.subject || "(zonder onderwerp)")}</strong> <span class="tag">${esc(m.status)}</span><p class="muted">${esc(m.sender)} → ${esc(m.recipients)}</p></summary><pre class="email">${esc(m.body)}</pre>${m.direction === "in" ? `<a href="/api/emails/${m.id}/original">Origineel met bijlagen downloaden</a>` : ""}</details>`).join("") || '<div class="empty">Nog geen e-mails in dit dossier.</div>'}`;
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
start();
