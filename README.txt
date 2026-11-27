SHIPCUBE LEAD IMPORTER  v1.2
============================
Reads a folder of Apollo "accounts export" CSVs and uploads them on the Outreach Hub
"Import leads" page with the right country + strategy selected.

INSTALL
  1. chrome://extensions -> Developer mode ON -> Load unpacked -> choose this folder
     (or press the refresh icon if it is already loaded).
  2. Sign in at https://outreachhub.shipcubeai.com and open Leads > Import leads.
  3. Click the extension icon: the panel opens on the right. Theme button = light / dark.

USE
  1. Pick folder. Default layout = "One strategy per file": each CSV is uploaded as-is.
     The list shows rows, the auto-detected strategy and an "Upload as" dropdown you can change.
     "Split rows by industry" is the other layout (sorts every row, removes duplicate websites).
  2. Check Import page - confirms fields exist and your strategies are on the page.
  3. Start. "Preview, then confirm" waits for you; "Fully automatic" presses Import itself.
     Dry run = fills everything and presses Preview First but NEVER Import (nothing is recorded).
  4. Pause / Resume - pauses before the next file (the current file finishes). Stop ends the run.
     If a file fails, the panel stops and asks: Retry / Skip / Stop (and "Mark as uploaded" when the
     Import button was clicked but the page gave no confirmation - check Import History first).

NO DOUBLE UPLOADS
  Every finished upload is remembered by the SHA-256 of the file's content (not its name), so
  - re-running the same folder skips files already uploaded,
  - identical files with different names (e.g. (11) and (13)) are only uploaded once,
  - the list shows "uploaded <date> as <strategy>" with a per-file "forget" link.
  "Forget ALL finished uploads" clears the memory.

NEW BATCHES: the preloaded file -> strategy table matches by file NAME. Untick
"Use my file -> strategy table" for a new batch so strategies are auto-detected from industries.
