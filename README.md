# Simple Follow-up Tracker

A small browser page that shows which leads and clients you need to get back to, sorted by how late you are. It is for freelancers, independent builders, and small businesses that have outgrown sticky notes but don't need a full CRM.

There is nothing to install and no account to create. The project is free and open-source under the MIT license.

## Example

You design websites. Maya from a bakery asks for a quote on Monday. You add Maya with a follow-up date of Thursday, then get on with your week. On Thursday, Maya is under **Today**. You call, change the status to **Proposal sent**, and click **+1 week**. Maya moves to **Next 7 days**. When Maya signs, set the status to **Won** and the lead leaves your follow-up list.

## What it does

- Add, edit, and delete leads: name, company, email, phone, status, next follow-up date, and notes.
- Group open leads as Overdue, Today, Next 7 days, Later, and No date set.
- Show only what is due, only open leads, only closed leads (Won or Lost), or everything.
- Search names, companies, contact details, statuses, and notes.
- Move a follow-up to 3 days or 1 week from today with one click.
- Undo the last delete, status change, one-click date change, or import.
- Import a CSV, with a preview that lists any row it cannot use.
- Export everything to CSV as a backup.

## Run it

You need a current desktop browser. You do not need an internet connection after downloading.

1. On the GitHub page, click **Code**, then **Download ZIP**.
2. Unzip the file and put the folder somewhere permanent, such as Documents.
3. Double-click `index.html`.

If you use Git:

```bash
git clone https://github.com/haitamyoyo830-cpu/simple-followup-tracker.git
```

Then open `index.html` in the new folder.

## Try the demo data

1. Click **Import CSV**.
2. Choose `sample-data/demo-leads.csv`.
3. Click **Add 9 leads**.

Every demo lead has a name starting with "Demo:". The businesses are fictional, and the emails use `example.com`. Click **Undo** straight after importing to remove them all, or delete them one at a time later.

## Import your own CSV

Only the `name` column is required. The first row must contain column names:

| Column | What to put in it |
| --- | --- |
| `name` | Required |
| `company`, `email`, `phone`, `notes` | Optional text |
| `status` | New, Contacted, Proposal sent, Won, or Lost. Blank means New. |
| `next_follow_up` | A date such as `2026-03-31`, or `today`, `today+3`, `today-2`. Blank means no date. |
| `tracker_id` | Added by exports so a lead can be recognized later. Leave it out of your own files. |

Comma, semicolon, and tab separators all work. Save the file as UTF-8, under 2 MB. **Add** skips leads already in your list: those with the same `tracker_id`, or the same name, company, email, and phone.

## Where your data lives

Leads are saved in your browser's local storage, on your device, in plain text. The page makes no network requests. Clicking an email address or phone number opens your own mail or phone app.

- **Clearing browser data deletes your leads.** So can private windows, browser cleanup tools, and resetting your browser.
- A different browser, browser profile, or device starts with an empty list.
- Moving or renaming the folder may start an empty list in some browsers. Export first.

**To back up:** click **Export CSV** and keep the file somewhere safe. Do this regularly.

**To restore:** click **Import CSV** and choose the backup. Use **Add** to bring back missing leads, or **Replace all leads** to return to exactly what the backup contains.

## Limitations

- One person, one browser. There is no sync or sharing.
- No reminders or notifications. You have to open the page.
- Data is not encrypted. Anyone who can use your browser profile can read it.
- Some browsers share local storage between all HTML files opened from disk, so another local HTML file could read your leads. Don't open HTML files you don't trust in the same browser profile.
- Spreadsheets may reformat dates when you save. The import asks for `YYYY-MM-DD` and reports rows that use anything else.
- Undo covers only the last action. Edits saved in the form can't be undone.

## Change it

It is plain HTML, CSS, and JavaScript with no build step. Edit a file and reload the page.

- `core.js`: statuses, validation, dates, sorting, and CSV rules
- `app.js`: saving, buttons, and dialogs
- `styles.css`: colors and layout

The optional tests need [Node.js](https://nodejs.org) 20 or newer. From the project folder:

```bash
node --test
```

## License

Free and open-source under the [MIT License](LICENSE).
