// Page behavior: storage, rendering, and dialogs. The rules live in core.js.
(() => {
  "use strict";

  const STORAGE_KEY = "simple-followup-tracker.v1";
  const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
  const IMPORT_ERRORS_SHOWN = 8;

  const $ = (id) => document.getElementById(id);

  let leads = [];
  let view = "open";
  let editingId = null;
  let pendingImport = null;
  let undoAction = null;
  let storageBlocked = false; // True while saved data exists that we could not read.

  const today = () => LeadCore.toISO(new Date());
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  // ---------- Storage ----------

  function readStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? [] : LeadCore.parseStored(raw);
  }

  function load() {
    try {
      leads = readStorage();
      storageBlocked = false;
    } catch (error) {
      leads = [];
      storageBlocked = true;
      let hasRaw = false;
      try { hasRaw = localStorage.getItem(STORAGE_KEY) !== null; } catch { /* storage is off */ }
      $("storage-alert-text").textContent = hasRaw
        ? "Your saved leads could not be read. Nothing has been changed. Download the data first, then start fresh and import your latest CSV backup."
        : "This browser is not letting the page save data, so leads cannot be kept. Check whether site data is blocked, or use another browser.";
      $("save-raw-button").hidden = !hasRaw;
      $("start-fresh-button").hidden = !hasRaw;
    }
    $("storage-alert").hidden = !storageBlocked;
    for (const id of ["add-button", "import-button", "export-button"]) $(id).disabled = storageBlocked;
  }

  // Every change goes through here. It starts from what is stored right now, not
  // from this tab's copy, so two open tabs do not overwrite each other. The page
  // only changes if the save worked. Returns an error message, or "" on success.
  function change(updater) {
    if (storageBlocked) return "Saving is off until the problem above is fixed.";
    try {
      const next = updater(readStorage());
      localStorage.setItem(STORAGE_KEY, LeadCore.serialize(next));
      leads = next;
    } catch (error) {
      return error.name === "QuotaExceededError"
        ? "Not saved: this browser's storage for the page is full. Export a CSV, then remove leads you no longer need."
        : "Not saved: the browser could not update its storage.";
    }
    return "";
  }

  function changeAndReport(updater, text, undo = null) {
    const error = change(updater);
    render();
    if (error) showMessage(error);
    else showMessage(text, undo);
    return !error;
  }

  // ---------- Messages ----------

  function showMessage(text, undo = null) {
    undoAction = undo;
    $("message-text").textContent = text;
    $("undo-button").hidden = !undo;
    $("message").hidden = !text;
  }

  // ---------- Rendering ----------

  // Builds elements with textContent only, so lead data can never become HTML.
  function element(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    const { dataset, ...rest } = props;
    Object.assign(node, rest);
    Object.assign(node.dataset, dataset);
    node.append(...children.filter((child) => child !== null));
    return node;
  }

  function formatDate(iso) {
    return LeadCore.fromISO(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  }

  function relativeDate(iso, now) {
    const days = LeadCore.daysBetween(now, iso);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    return days < 0 ? `${plural(-days, "day")} late` : `In ${days} days`;
  }

  function renderWhen(lead, group, now) {
    const when = element("div", { className: "when" });
    if (group === "Overdue") when.classList.add("late");
    if (group === "Today") when.classList.add("now");
    if (!lead.nextFollowUp) {
      when.append(element("span", { className: "muted", textContent: "No follow-up" }));
    } else if (group === "Closed") {
      when.append(element("span", { className: "muted", textContent: formatDate(lead.nextFollowUp) }));
    } else {
      when.append(
        element("strong", { textContent: relativeDate(lead.nextFollowUp, now) }),
        element("span", { className: "muted", textContent: formatDate(lead.nextFollowUp) }));
    }
    return when;
  }

  function renderContact(lead) {
    const contact = element("p", { className: "contact" });
    if (lead.email) contact.append(element("a", { href: `mailto:${encodeURIComponent(lead.email).replace("%40", "@")}`, textContent: lead.email }));
    if (lead.phone) contact.append(element("a", { href: `tel:${lead.phone.replace(/[^\d+]/g, "")}`, textContent: lead.phone }));
    return contact.childNodes.length ? contact : null;
  }

  function renderLead(lead, group, now) {
    const button = (action, text, label) => element("button", {
      type: "button", textContent: text, ariaLabel: `${label} (${lead.name})`,
      dataset: { action, id: lead.id, focusKey: `${lead.id}:${action}` },
    });
    const status = element("select", {
      ariaLabel: `Status (${lead.name})`,
      dataset: { action: "status", id: lead.id, focusKey: `${lead.id}:status` },
    }, ...LeadCore.STATUSES.map((name) => element("option", { value: name, textContent: name })));
    status.value = lead.status;

    const open = !LeadCore.isClosed(lead);
    return element("li", { className: "lead" },
      renderWhen(lead, group, now),
      element("div", { className: "who" },
        element("h3", { textContent: lead.name }),
        lead.company ? element("p", { className: "company", textContent: lead.company }) : null,
        renderContact(lead),
        lead.notes ? element("p", { className: "notes", textContent: lead.notes }) : null),
      element("div", { className: "actions" },
        status,
        element("div", { className: "button-row" },
          open ? button("plus3", "+3 days", "Follow up 3 days from today") : null,
          open ? button("plus7", "+1 week", "Follow up 1 week from today") : null,
          button("edit", "Edit", "Edit"),
          button("delete", "Delete", "Delete"))));
  }

  function emptyText(query, now) {
    if (storageBlocked) return "";
    if (!leads.length) return "No leads yet. Add your first one, or import a CSV. The sample-data folder has a demo file to try.";
    if (query.trim()) return `Nothing here matches “${query.trim()}”. Try another search or another tab.`;
    if (view === "due") {
      const next = leads.filter((lead) => !LeadCore.isClosed(lead) && lead.nextFollowUp).sort(LeadCore.compareLeads)[0];
      return next
        ? `Nothing is due. Next up: ${next.name}, ${relativeDate(next.nextFollowUp, now).toLowerCase()} (${formatDate(next.nextFollowUp)}).`
        : "Nothing is due, and no open lead has a follow-up date.";
    }
    return view === "closed" ? "No leads are marked Won or Lost." : "No open leads.";
  }

  function render() {
    const now = today();
    const query = $("search").value;
    const list = $("list");
    const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;

    const dueCount = leads.filter((lead) => LeadCore.isDue(lead, now)).length;
    $("summary").textContent = dueCount
      ? `${plural(dueCount, "follow-up")} due`
      : "No follow-ups due";

    for (const tab of document.querySelectorAll("[data-view]")) {
      tab.setAttribute("aria-pressed", String(tab.dataset.view === view));
      tab.querySelector(".count").textContent = leads.filter((lead) => LeadCore.matchesView(lead, tab.dataset.view, now)).length;
    }

    const visible = leads
      .filter((lead) => LeadCore.matchesView(lead, view, now) && LeadCore.matchesSearch(lead, query))
      .sort(LeadCore.compareLeads);

    list.replaceChildren();
    if (!visible.length) list.append(element("p", { className: "empty", textContent: emptyText(query, now) }));
    for (const group of LeadCore.GROUPS) {
      const members = visible.filter((lead) => LeadCore.groupOf(lead, now) === group);
      if (!members.length) continue;
      list.append(element("section", {},
        element("h2", { textContent: group }),
        element("ul", {}, ...members.map((lead) => renderLead(lead, group, now)))));
    }

    // Rebuilding the list drops keyboard focus, so put it back where it was.
    if (focusKey) (list.querySelector(`[data-focus-key="${focusKey}"]`) || list).focus();
  }

  // ---------- Add and edit ----------

  const form = $("lead-form");

  function openLeadForm(lead) {
    editingId = lead ? lead.id : null;
    form.reset();
    showFormErrors({});
    $("lead-dialog-title").textContent = lead ? "Edit lead" : "Add lead";
    const values = lead || { status: "New", nextFollowUp: LeadCore.addDays(today(), 3) };
    for (const [field, value] of Object.entries(values)) {
      if (form.elements[field]) form.elements[field].value = value;
    }
    $("lead-dialog").showModal();
    form.elements.name.focus();
  }

  function showFormErrors(errors, general = "") {
    for (const slot of form.querySelectorAll("[data-error-for]")) {
      const field = slot.dataset.errorFor;
      slot.textContent = errors[field] || "";
      form.elements[field].setAttribute("aria-invalid", String(Boolean(errors[field])));
    }
    $("form-error").textContent = general;
    const firstBad = Object.keys(errors).find((field) => form.elements[field]);
    if (firstBad) form.elements[firstBad].focus();
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const dateInput = form.elements.nextFollowUp;
    // A half-typed date reads as "", so without this check it would be dropped silently.
    if (dateInput.validity.badInput) {
      showFormErrors({ nextFollowUp: "Finish the date or clear it." });
      return;
    }
    const { lead, errors } = LeadCore.validateLead({ ...Object.fromEntries(new FormData(form)), id: editingId });
    if (Object.keys(errors).length) {
      showFormErrors(errors);
      return;
    }
    const isEdit = editingId !== null;
    const error = change((current) => [...current.filter((item) => item.id !== lead.id), lead]);
    if (error) {
      showFormErrors({}, error);
      return;
    }
    $("lead-dialog").close();
    render();
    const hidden = !LeadCore.matchesView(lead, view, today()) || !LeadCore.matchesSearch(lead, $("search").value);
    showMessage(`${isEdit ? "Saved" : "Added"} ${lead.name}.${hidden ? " It is not shown in the current tab or search." : ""}`);
  });

  // ---------- Actions on a lead ----------

  function patchLead(lead, patch, text) {
    const apply = (values) => (current) => current.map((item) => (item.id === lead.id ? { ...item, ...values } : item));
    // Undo restores only the fields this change touched.
    const before = Object.fromEntries(Object.keys(patch).map((field) => [field, lead[field]]));
    changeAndReport(apply(patch), text, () => changeAndReport(apply(before), `${lead.name}: change undone.`));
  }

  $("list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const lead = leads.find((item) => item.id === button.dataset.id);
    if (!lead) return;
    const { action } = button.dataset;

    if (action === "edit") openLeadForm(lead);
    if (action === "plus3" || action === "plus7") {
      const date = LeadCore.addDays(today(), action === "plus3" ? 3 : 7);
      patchLead(lead, { nextFollowUp: date }, `${lead.name}: next follow-up ${formatDate(date)}.`);
    }
    if (action === "delete") {
      changeAndReport(
        (current) => current.filter((item) => item.id !== lead.id),
        `Deleted ${lead.name}.`,
        () => changeAndReport((current) => [...current.filter((item) => item.id !== lead.id), lead], `Restored ${lead.name}.`));
    }
  });

  $("list").addEventListener("change", (event) => {
    const { action, id } = event.target.dataset;
    if (action !== "status") return;
    const lead = leads.find((item) => item.id === id);
    if (lead) patchLead(lead, { status: event.target.value }, `${lead.name}: status is now ${event.target.value}.`);
  });

  // ---------- Import and export ----------

  function download(text, filename, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = element("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function readImportFile(file) {
    if (file.size > MAX_IMPORT_BYTES) throw new Error("The file is larger than 2 MB.");
    const bytes = await file.arrayBuffer();
    let text;
    try {
      // "fatal" rejects Excel workbooks and other non-UTF-8 files instead of importing garbage.
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("The file is not UTF-8 text. In your spreadsheet, save it as “CSV UTF-8”.");
    }
    return LeadCore.readLeadsCsv(text, today());
  }

  function openImportPreview(fileName, { leads: incoming, errors, ignoredColumns }) {
    const { fresh, skipped } = LeadCore.splitNewLeads(leads, incoming);
    pendingImport = incoming;

    $("import-summary").textContent = `${fileName}: ${plural(incoming.length, "valid lead")}, `
      + `${plural(fresh.length, "new lead")} to add, ${skipped} already in your list.`;

    const details = errors.slice(0, IMPORT_ERRORS_SHOWN).map((error) => `Row ${error.row} skipped: ${error.message}`);
    if (errors.length > IMPORT_ERRORS_SHOWN) details.push(`${errors.length - IMPORT_ERRORS_SHOWN} more rows skipped.`);
    if (ignoredColumns.length) details.push(`Columns not used: ${ignoredColumns.join(", ")}.`);
    $("import-details").replaceChildren(...details.map((text) => element("li", { textContent: text })));

    $("import-add").disabled = fresh.length === 0;
    $("import-add").textContent = `Add ${plural(fresh.length, "lead")}`;
    // Replacing from a file with bad rows would quietly lose those leads.
    const canReplace = leads.length > 0 && incoming.length > 0 && errors.length === 0;
    $("import-replace").hidden = !canReplace;
    $("import-replace-note").textContent = canReplace
      ? `Replace all leads removes your current ${plural(leads.length, "lead")} and uses only this file.`
      : "";
    $("import-dialog").showModal();
  }

  $("file-input").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      openImportPreview(file.name, await readImportFile(file));
    } catch (error) {
      showMessage(`Could not import ${file.name}. ${error.message}`);
    } finally {
      event.target.value = ""; // Lets the same file be chosen again.
    }
  });

  $("import-add").addEventListener("click", () => {
    let added = [];
    const incoming = pendingImport;
    $("import-dialog").close();
    const error = change((current) => {
      added = LeadCore.splitNewLeads(current, incoming).fresh;
      return [...current, ...added];
    });
    render();
    const ids = new Set(added.map((lead) => lead.id));
    showMessage(error || `Added ${plural(added.length, "lead")}.`, error ? null : () => changeAndReport(
      (current) => current.filter((lead) => !ids.has(lead.id)), "Import undone."));
  });

  $("import-replace").addEventListener("click", () => {
    let previous = [];
    const incoming = pendingImport;
    $("import-dialog").close();
    changeAndReport(
      (current) => { previous = current; return incoming; },
      `Replaced your list with ${plural(incoming.length, "lead")} from the file.`,
      () => changeAndReport(() => previous, "Your previous list is back."));
  });

  $("export-button").addEventListener("click", () => {
    if (!leads.length) {
      showMessage("There are no leads to export yet.");
      return;
    }
    const filename = `followup-backup-${today()}.csv`;
    download(LeadCore.leadsToCsv(leads), filename, "text/csv;charset=utf-8");
    showMessage(`Download started: ${filename}, with ${plural(leads.length, "lead")}.`);
  });

  // ---------- Other controls ----------

  $("add-button").addEventListener("click", () => openLeadForm(null));
  $("import-button").addEventListener("click", () => $("file-input").click());
  $("search").addEventListener("input", render);
  $("undo-button").addEventListener("click", () => undoAction && undoAction());

  for (const tab of document.querySelectorAll("[data-view]")) {
    tab.addEventListener("click", () => { view = tab.dataset.view; render(); });
  }
  for (const button of document.querySelectorAll("[data-close]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }

  $("save-raw-button").addEventListener("click", () => {
    download(localStorage.getItem(STORAGE_KEY) ?? "", "unreadable-leads.json", "application/json");
  });
  $("start-fresh-button").addEventListener("click", () => {
    if (!confirm("Delete the unreadable data from this browser? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    load();
    render();
  });

  // Another tab saved something: show it, and drop an undo that may no longer fit.
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    load();
    showMessage("");
    render();
  });

  // Keeps "today" correct when the page is left open overnight.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

  form.elements.status.append(...LeadCore.STATUSES.map((name) => element("option", { value: name, textContent: name })));
  load();
  render();
})();
