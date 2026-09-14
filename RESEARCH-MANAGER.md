# Manage your research library

Open your website folder and double-click **Launch Research Manager.cmd**. Your browser opens a private manager on this computer. Keep the launcher window open while you work.

The launcher uses the Python already installed with AtlasAI, then falls back to `py` or `python`. The manager needs Python 3.10 or newer and uses only its standard library. Publishing needs Git and permission to push to **https://github.com/ceospr/website**. If Git requests authentication, sign in with your authorized GitHub account. Your Git name and email can be set once in GitHub Desktop. No paid services are required.

## Add and publish a paper

1. Click **Add paper**. Enter its title, author, document date, category, overview, and evidence label. Choose the original PDF. The short paper ID becomes its permanent link.
2. Click **Save draft** to keep it private, or **Add to local site** to include it in your local library.
3. Use **Preview local library** to check the listing and PDF.
4. Click **Review & publish**. Review the listed catalog/PDF changes, select the confirmation checkbox, then click **Publish these changes to GitHub**.
5. Wait for the website deployment to complete, then check the public research library. A successful push is not an immediate guarantee that GitHub Pages has finished deploying.

**Local changes are not live until you explicitly publish them.** The browser clearly distinguishes the local workspace from the public site. Draft PDFs and metadata are kept outside the public website directory.

## Common changes

| Task | In the manager |
| --- | --- |
| Edit title, author, date, category, or summary | Select the paper, edit the form, and **Save changes locally**. Then review and publish. |
| Replace a PDF | Select the paper, choose its replacement PDF, update the version/date if appropriate, and save. The earlier PDF remains in private version history. Then review and publish. |
| Withdraw a paper | Select it and click **Withdraw from local site**. Confirm, then review and publish. The current public PDF and catalog entry are removed. |
| Republish a withdrawn paper | Select it and click **Republish on local site**, then review and publish. Its latest stored PDF is restored. |
| Download the stored PDF | Select the paper and click **Download stored PDF**. |
| Recover an earlier PDF | Open **Earlier PDF versions**, download that version, then select it as the replacement PDF if you want to restore it. |
| Import catalog changes made elsewhere | Use **Reload website catalog** after those published files have been copied into your editing folder. Drafts and previous PDFs are retained. |

Use **Investment Ideas** for investment theses, **Market Trends** for market observations, and **Methods** for methodology papers. Identify simulated or illustrative work in the evidence label and summary. The manager does not invent authors, dates, conclusions, or performance results.

## What publishing changes

The publisher creates a separate, clean temporary clone of the fixed `ceospr/website` repository. It overlays only `data/research.json` and the managed PDF files being changed, then commits and pushes those reviewed paths without force. Other website files and your editing folder’s Git index are untouched—even if that folder has unresolved merges or unrelated staged changes.

The manager compares the published research against its saved baseline. If another editor changed the research catalog or a relevant PDF, publishing stops so those changes cannot be overwritten. If the remote branch changes after your review, review again. Your local edits and backups remain available. If a push fails, you can review again and retry; do not recreate the paper.

Withdrawal removes a document from the current published site after deployment; earlier Git revisions, browser caches, and downloaded copies can still retain it.

## Backups and access

On Windows, private drafts, immutable PDF copies, metadata history, and publishing workspaces are stored under `%LOCALAPPDATA%\SpinozaResearch\<website-id>`. The exact folder appears under **Workspace & backups**. Keep that folder if you move computers or want to retain withdrawn papers and earlier versions. It is separate from the public website repository.

The manager listens only on `127.0.0.1`, uses a random session token, checks the local request origin, and provides no public administration endpoint. Close the launcher window to stop it. Do not run multiple managers against the same library simultaneously. PDF uploads are limited to 32 MB; the file is copied without changing its contents.

## The supplied Token Utilization P/E paper

The published file is the original four-page **The Token Utilization P/E**, credited to **Atlas Research**, dated **July 16, 2026**, version **0.1**. It describes an illustrative simulated universe, not a historical backtest or a live investment record. The website overview summarizes its executive summary, methodology, and limitations; the document does not provide a separate abstract.

The supplied PDF visibly contains a block of document-formatting/YAML text on its cover. It has been preserved exactly. If you correct the source document and export a cleaner PDF, use the replacement workflow above; the original remains in your private history.

Public readers use `research.html` for search and category filtering, and `paper.html?id=<paper-id>` for the paper overview, inline PDF, open, and download links. Existing `investment-ideas.html` and `market-trends.html` links open the corresponding filtered catalog.
