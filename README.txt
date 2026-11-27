SHIPCUBE LEAD IMPORTER
======================
Reads a folder of Apollo "accounts export" CSVs, sorts every row into the right strategy
(by its Industry column), removes duplicates, and uploads one CSV per strategy on the
Outreach Hub "Import leads" page (country, strategy, tags, skip-filter filled in for you).

INSTALL
  1. chrome://extensions -> Developer mode ON -> Load unpacked -> choose this folder.
  2. Sign in at https://outreachhub.shipcubeai.com and open Leads > Import leads.
  3. Click the extension icon: the panel opens on the right.

USE
  Layout: "One strategy per file" (default) uploads each CSV as-is under one strategy (your table is
  pre-loaded; the auto-detected majority is shown next to it and you can change any file in the list).
  "Split rows" mode sorts every row into its own strategy and removes duplicates.
  The Theme button (top right) switches light / dark.
  1. Pick folder      - choose the folder with the CSVs. The plan table shows rows per strategy.
  2. Settings         - country, tags, max rows per upload (2500), checkboxes.
                        Untick a strategy in the plan table to leave it out.
  3. Check Import page - confirms the form fields and that your strategies exist on the page.
  4. Start            - uploads each batch. "Preview, then confirm" shows the page preview and waits
                        for you. "Fully automatic" clicks Import by itself.
  DRY RUN             - tick it and the bot does everything (fills file, country, strategy, tags,
                        checkboxes, presses Preview First) but NEVER presses Import. Nothing is
                        recorded as uploaded, so you can run it again for real afterwards.

NOTES
  - Duplicate websites are removed across ALL files (many exports overlap).
  - Finished uploads are remembered; if you Stop and Start again it continues where it left off.
    "Forget finished uploads" resets that.
  - Edit the Industry -> Strategy mapping in the panel (saved in the browser).
  - Strategy names must exist on the page as "<Name> — <Country>".
