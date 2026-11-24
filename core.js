// Rules with no page access: dates, validation, sorting, and CSV.
// The browser reads this as the global LeadCore; the tests load it with require().
const LeadCore = (() => {
  "use strict";

  const STATUSES = ["New", "Contacted", "Proposal sent", "Won", "Lost"];
  const CLOSED_STATUSES = ["Won", "Lost"];

  // [field on a lead, column in the CSV]
  const COLUMNS = [
    ["id", "tracker_id"],
    ["name", "name"],
    ["company", "company"],
    ["email", "email"],
    ["phone", "phone"],
    ["status", "status"],
    ["nextFollowUp", "next_follow_up"],
    ["notes", "notes"],
  ];

  const MAX_LENGTH = { name: 120, company: 120, email: 254, phone: 40, notes: 5000 };

  // ---------- Dates (always YYYY-MM-DD, in the user's own time zone) ----------

  function toISO(date) {
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromISO(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function isRealDate(text) {
    // The round trip rejects dates such as 2026-02-30, which Date would roll into March.
    return /^(19|20|21)\d\d-\d\d-\d\d$/.test(text) && toISO(fromISO(text)) === text;
  }

  function addDays(iso, days) {
    const date = fromISO(iso);
    date.setDate(date.getDate() + days);
    return toISO(date);
  }

  function daysBetween(fromIso, toIso) {
    // Rounding absorbs the 23- and 25-hour days around clock changes.
    return Math.round((fromISO(toIso) - fromISO(fromIso)) / 86400000);
  }

  // ---------- Leads ----------

  function newId() {
    // crypto.randomUUID is missing on plain-http pages; getRandomValues is not.
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function isClosed(lead) {
    return CLOSED_STATUSES.includes(lead.status);
  }

  // Returns { lead, errors }. `errors` maps a field name to a message and is empty when valid.
  function validateLead(input) {
    const lead = {};
    for (const [field] of COLUMNS) {
      lead[field] = String(input[field] ?? "").replace(/\r\n?/g, "\n").trim();
    }
    const errors = {};

    if (!lead.name) errors.name = "Enter a name.";
    for (const [field, max] of Object.entries(MAX_LENGTH)) {
      if (lead[field].length > max) errors[field] = `Use ${max} characters or fewer.`;
    }
    if (lead.email && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(lead.email)) {
      errors.email = "Enter an email like name@example.com, or leave it blank.";
    }
    if (!lead.status) {
      lead.status = "New";
    } else {
      const match = STATUSES.find((s) => s.toLowerCase() === lead.status.toLowerCase());
      if (match) lead.status = match;
      else errors.status = `Status must be one of: ${STATUSES.join(", ")}.`;
    }
    if (lead.nextFollowUp && !isRealDate(lead.nextFollowUp)) {
      errors.nextFollowUp = "Use a real date written as YYYY-MM-DD.";
    }
    if (!/^[A-Za-z0-9-]{1,64}$/.test(lead.id)) {
      if (lead.id) errors.id = "tracker_id may only contain letters, digits, and dashes.";
      else lead.id = newId();
    }
    return { lead, errors };
  }

  // Which heading a lead belongs under.
  function groupOf(lead, today) {
    if (isClosed(lead)) return "Closed";
    if (!lead.nextFollowUp) return "No date set";
    const days = daysBetween(today, lead.nextFollowUp);
    if (days < 0) return "Overdue";
    if (days === 0) return "Today";
    return days <= 7 ? "Next 7 days" : "Later";
  }

  const GROUPS = ["Overdue", "Today", "Next 7 days", "Later", "No date set", "Closed"];

  function isDue(lead, today) {
    return ["Overdue", "Today"].includes(groupOf(lead, today));
  }

  function matchesView(lead, view, today) {
    if (view === "due") return isDue(lead, today);
    if (view === "open") return !isClosed(lead);
    if (view === "closed") return isClosed(lead);
    return true;
  }

  function matchesSearch(lead, query) {
    const needle = query.trim().toLowerCase();
    return [lead.name, lead.company, lead.email, lead.phone, lead.status, lead.notes]
      .some((value) => value.toLowerCase().includes(needle));
  }

  function compareLeads(a, b) {
    // "9999" sorts leads without a date after leads with one.
    return (a.nextFollowUp || "9999").localeCompare(b.nextFollowUp || "9999")
      || a.name.localeCompare(b.name);
  }

  // ---------- Stored data ----------

  function serialize(leads) {
    return JSON.stringify({ version: 1, leads });
  }

  // Throws on anything unexpected so the app can refuse to overwrite it.
  function parseStored(raw) {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.leads)) {
      throw new Error("Saved data is not in the expected format.");
    }
    return data.leads.map((item) => {
      const { lead, errors } = validateLead(item ?? {});
      if (Object.keys(errors).length) throw new Error("A saved lead is not valid.");
      return lead;
    });
  }

  // ---------- CSV ----------

  // Spreadsheets can run a cell that starts with = + - or @ as a formula.
  // Export puts an apostrophe in front; import takes one away again.
  function protectCell(value) {
    return /^'*[=+\-@]/.test(value) ? `'${value}` : value;
  }

  function unprotectCell(value) {
    return /^'+[=+\-@]/.test(value) ? value.slice(1) : value;
  }

  function leadsToCsv(leads) {
    const quote = (value) => (/[",;\t\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const rows = [COLUMNS.map(([, column]) => column)];
    for (const lead of leads) {
      rows.push(COLUMNS.map(([field]) => quote(protectCell(lead[field]))));
    }
    // The leading BOM tells Excel the file is UTF-8.
    return "﻿" + rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
  }

  // Splits CSV text into rows of cells. Accepts comma, semicolon, or tab,
  // because spreadsheets in many countries save "CSV" with semicolons.
  function parseCsv(text) {
    const body = text.replace(/^﻿/, "");
    const firstLine = body.split(/\r?\n|\r/, 1)[0];
    const delimiter = [",", ";", "\t"]
      .map((mark) => ({ mark, count: firstLine.split(mark).length }))
      .reduce((best, next) => (next.count > best.count ? next : best)).mark;

    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < body.length; i += 1) {
      const char = body[i];
      if (inQuotes) {
        if (char !== '"') cell += char;
        else if (body[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = false;
      } else if (char === '"' && cell === "") {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(cell);
        cell = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && body[i + 1] === "\n") i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += char;
      }
    }
    if (inQuotes) throw new Error("The file has an opening quote mark that is never closed.");
    if (cell !== "" || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  // Lets a CSV say "today", "today+3", or "today-2" so demo data never goes stale.
  function resolveDate(text, today) {
    const match = /^today(?:\s*([+-])\s*(\d{1,4}))?$/i.exec(text);
    if (!match) return text;
    const days = Number(match[2] || 0);
    return addDays(today, match[1] === "-" ? -days : days);
  }

  // Throws when the whole file is unusable. Otherwise returns
  // { leads, errors, ignoredColumns }, where each error names one skipped row.
  function readLeadsCsv(text, today) {
    const rows = parseCsv(text);
    if (!rows.some((row) => row.some((cell) => cell.trim()))) {
      throw new Error("The file is empty.");
    }
    const header = rows[0].map((cell) => cell.trim().toLowerCase().replace(/[\s-]+/g, "_"));
    const known = COLUMNS.map(([, column]) => column);
    if (!header.includes("name")) {
      throw new Error(`The first row needs a "name" column. Recognized columns: ${known.join(", ")}.`);
    }
    const repeated = known.find((column) => header.filter((h) => h === column).length > 1);
    if (repeated) throw new Error(`The column "${repeated}" appears more than once.`);

    const leads = [];
    const errors = [];
    const seenIds = new Set();

    rows.slice(1).forEach((row, index) => {
      if (!row.some((cell) => cell.trim())) return;
      const rowNumber = index + 2; // Matches the row number a spreadsheet shows.

      if (row.slice(header.length).some((cell) => cell.trim())) {
        errors.push({ row: rowNumber, message: "More cells than columns. A value containing a comma may need quotes." });
        return;
      }
      const input = {};
      for (const [field, column] of COLUMNS) {
        const position = header.indexOf(column);
        input[field] = position === -1 ? "" : unprotectCell((row[position] ?? "").trim());
      }
      input.nextFollowUp = resolveDate(input.nextFollowUp, today);

      const { lead, errors: problems } = validateLead(input);
      if (seenIds.has(lead.id)) problems.id = "This tracker_id is already used by an earlier row.";
      if (Object.keys(problems).length) {
        errors.push({ row: rowNumber, message: Object.values(problems).join(" ") });
        return;
      }
      seenIds.add(lead.id);
      leads.push(lead);
    });

    return { leads, errors, ignoredColumns: header.filter((h) => h && !known.includes(h)) };
  }

  // Drops incoming leads that are already in the list, so importing twice is safe.
  function splitNewLeads(existing, incoming) {
    const contactKey = (lead) => JSON.stringify(
      [lead.name, lead.company, lead.email, lead.phone].map((value) => value.toLowerCase()));
    const ids = new Set(existing.map((lead) => lead.id));
    const contacts = new Set(existing.map(contactKey));
    const fresh = incoming.filter((lead) => !ids.has(lead.id) && !contacts.has(contactKey(lead)));
    return { fresh, skipped: incoming.length - fresh.length };
  }

  return {
    STATUSES, GROUPS, toISO, fromISO, addDays, daysBetween, validateLead, groupOf,
    isClosed, isDue, matchesView, matchesSearch, compareLeads, serialize, parseStored,
    leadsToCsv, readLeadsCsv, splitNewLeads,
  };
})();

if (typeof module !== "undefined") module.exports = LeadCore;
