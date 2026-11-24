// Optional developer tests. Run from the project folder with: node --test
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const core = require("../core.js");

const TODAY = "2026-03-10";
const makeLead = (fields) => core.validateLead({ name: "Test", ...fields }).lead;

test("validation accepts a name alone and fills in defaults", () => {
  const { lead, errors } = core.validateLead({ name: "  Ana  " });
  assert.deepEqual(errors, {});
  assert.equal(lead.name, "Ana");
  assert.equal(lead.status, "New");
  assert.ok(lead.id);
});

test("validation rejects missing names, bad emails, statuses, and impossible dates", () => {
  const { errors } = core.validateLead({ email: "nope", status: "Maybe", nextFollowUp: "2026-02-30" });
  assert.deepEqual(Object.keys(errors).sort(), ["email", "name", "nextFollowUp", "status"]);
});

test("dates cross month ends and leap days", () => {
  assert.equal(core.addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(core.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(core.daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("leads land in the right group, and closed leads are never due", () => {
  const group = (nextFollowUp, status = "New") => core.groupOf(makeLead({ nextFollowUp, status }), TODAY);
  assert.equal(group("2026-03-09"), "Overdue");
  assert.equal(group("2026-03-10"), "Today");
  assert.equal(group("2026-03-17"), "Next 7 days");
  assert.equal(group("2026-03-18"), "Later");
  assert.equal(group(""), "No date set");
  assert.equal(group("2026-03-09", "Won"), "Closed");
  assert.equal(core.isDue(makeLead({ nextFollowUp: "2026-03-09", status: "Lost" }), TODAY), false);
});

test("export then import returns identical leads, including awkward text", () => {
  const leads = [
    makeLead({ name: 'Quote " and, comma', notes: "line one\nline two; more", phone: "+1 555 0100" }),
    makeLead({ name: "=1+1", company: "'=already quoted", nextFollowUp: "2026-04-01" }),
    makeLead({ name: "Zoë Ñandú", email: "zoe@example.com", status: "Proposal sent" }),
  ];
  const result = core.readLeadsCsv(core.leadsToCsv(leads), TODAY);
  assert.deepEqual(result.leads, leads);
  assert.deepEqual(result.errors, []);
});

test("exported cells cannot start a spreadsheet formula", () => {
  assert.match(core.leadsToCsv([makeLead({ name: "=SUM(A1)" })]), /,'=SUM\(A1\),/);
});

test("import accepts semicolons and reports each bad row by number", () => {
  const csv = "Name;Status;Next Follow Up;Source\nAna;contacted;today+3;Web\n;New;;\n\nBo;Maybe;;\n";
  const result = core.readLeadsCsv(csv, TODAY);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].status, "Contacted");
  assert.equal(result.leads[0].nextFollowUp, "2026-03-13");
  assert.deepEqual(result.errors.map((error) => error.row), [3, 5]);
  assert.deepEqual(result.ignoredColumns, ["source"]);
});

test("import refuses files it cannot understand", () => {
  assert.throws(() => core.readLeadsCsv("", TODAY), /empty/);
  assert.throws(() => core.readLeadsCsv("title,phone\nA,1\n", TODAY), /"name" column/);
  assert.throws(() => core.readLeadsCsv('name\n"Ana\n', TODAY), /never closed/);
  assert.throws(() => core.readLeadsCsv("name,name\nA,B\n", TODAY), /more than once/);
});

test("importing the same leads twice adds nothing", () => {
  const read = () => core.readLeadsCsv("name,email\nAna,ana@example.com\n", TODAY).leads;
  assert.equal(core.splitNewLeads([], read()).fresh.length, 1);
  assert.deepEqual(core.splitNewLeads(read(), read()), { fresh: [], skipped: 1 });
});

test("stored data round-trips, and damaged data throws", () => {
  const leads = [makeLead({ name: "Ana" })];
  assert.deepEqual(core.parseStored(core.serialize(leads)), leads);
  for (const raw of ["not json", "null", '{"version":2,"leads":[]}', '{"version":1,"leads":[{}]}']) {
    assert.throws(() => core.parseStored(raw));
  }
});

test("the demo file imports cleanly and contains due leads", () => {
  const csv = fs.readFileSync(path.join(__dirname, "../sample-data/demo-leads.csv"), "utf8");
  const { leads, errors } = core.readLeadsCsv(csv, TODAY);
  assert.deepEqual(errors, []);
  assert.equal(leads.length, 9);
  assert.equal(leads.filter((lead) => core.isDue(lead, TODAY)).length, 3);
  assert.ok(leads.every((lead) => lead.email.endsWith("@example.com")));
});
