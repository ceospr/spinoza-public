"""Local-only research publishing manager. Standard library; no paid services."""
from __future__ import annotations
import argparse
import base64
from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import threading
from urllib.parse import parse_qs, unquote, urlsplit
import webbrowser

CATEGORIES = {"investment-ideas", "market-trends", "methods"}
MAX_PDF = 32 * 1024 * 1024
MAX_REQUEST = 45 * 1024 * 1024
SCHEMA = "spinoza.research.v1"
SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
PDF_PATH = re.compile(r"papers/[a-z0-9][a-z0-9/-]*\.pdf\Z")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def sha(value):
    return hashlib.sha256(value).hexdigest()


def publication_digest(relative, content):
    # Git for Windows may change JSON line endings during checkout. Compare the
    # complete catalog value, while preserving PDF checksums byte-for-byte.
    if relative == "data/research.json":
        content = json.dumps(json.loads(content), sort_keys=True, separators=(",", ":"),
            ensure_ascii=False, allow_nan=False).encode("utf-8")
    return sha(content)


def default_private(site):
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local/share")
    return base / "SpinozaResearch" / sha(str(Path(site).resolve()).encode())[:16]


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
    try:
        with temporary.open("xb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def valid_slug(value):
    if not isinstance(value, str) or len(value) > 90 or not SLUG.fullmatch(value):
        raise ValueError("Paper ID must contain lowercase letters, numbers, and single hyphens.")
    return value


def text(value, name, maximum, required=False):
    if not isinstance(value, str):
        raise ValueError(f"{name} must be text.")
    value = value.strip()
    if len(value) > maximum or (required and not value):
        raise ValueError(f"{name} is required and must be at most {maximum} characters." if required else f"{name} is too long.")
    return value


def metadata(value):
    if not isinstance(value, dict):
        raise ValueError("Paper metadata is missing.")
    item = {"id": valid_slug(value.get("id")), "title": text(value.get("title", ""), "Title", 250, True),
        "subtitle": text(value.get("subtitle", ""), "Subtitle", 500),
        "author": text(value.get("author", ""), "Author", 250, True),
        "abstract": text(value.get("abstract", ""), "Summary", 6000, True),
        "abstract_note": text(value.get("abstract_note", ""), "Summary note", 700),
        "version": text(value.get("version", ""), "Version", 50),
        "evidence_basis": text(value.get("evidence_basis", ""), "Evidence label", 150, True)}
    if value.get("category") not in CATEGORIES:
        raise ValueError("Choose Investment Ideas, Market Trends, or Methods.")
    item["category"] = value["category"]
    try:
        item["date"] = date.fromisoformat(value.get("date", "")).isoformat()
    except (TypeError, ValueError):
        raise ValueError("Use a valid publication date (YYYY-MM-DD).") from None
    tags = value.get("tags", [])
    if not isinstance(tags, list) or len(tags) > 20:
        raise ValueError("Use at most twenty topic tags.")
    item["tags"] = [text(tag, "Tag", 60, True) for tag in tags]
    pages = value.get("pages")
    if pages not in (None, ""):
        if isinstance(pages, bool) or not isinstance(pages, int) or not 1 <= pages <= 10000:
            raise ValueError("Page count must be a positive whole number.")
        item["pages"] = pages
    return item


def validate_pdf(filename, content):
    if not isinstance(filename, str) or Path(filename).suffix.lower() != ".pdf":
        raise ValueError("Choose a .pdf file.")
    if not isinstance(content, bytes) or not 10 <= len(content) <= MAX_PDF:
        raise ValueError("PDF files must be between ten bytes and 32 MB.")
    if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
        raise ValueError("The selected file does not have a valid PDF header and end marker.")
    return content


class Library:
    def __init__(self, site, private=None):
        self.site = Path(site).resolve()
        self.private = Path(private or default_private(self.site)).resolve()
        if self.private == self.site or self.private.is_relative_to(self.site):
            raise ValueError("Backups must remain outside the public website checkout.")
        self.private.mkdir(parents=True, exist_ok=True)
        self.catalog = self.site / "data/research.json"
        self.state_path = self.private / "library.json"
        self.lock = threading.RLock()
        if self.state_path.exists():
            self.state = json.loads(self.state_path.read_text(encoding="utf-8"))
        else:
            self.state = {"version": 1, "papers": {}, "catalog_sha256": None}
            self.import_catalog(initial=True)

    def public_path(self, relative):
        if not isinstance(relative, str) or not PDF_PATH.fullmatch(relative) or ".." in relative:
            raise ValueError("PDF path must remain inside the papers directory.")
        target = (self.site / relative).resolve()
        if not target.is_relative_to(self.site) or not target.is_relative_to((self.site / "papers").resolve()):
            raise ValueError("PDF path escapes the research library.")
        if target.is_symlink():
            raise ValueError("Symbolic PDF paths are unsupported.")
        return target

    def asset(self, digest):
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Invalid archived PDF identifier.")
        return self.private / "assets" / (digest + ".pdf")

    def keep_pdf(self, content):
        digest = sha(content)
        target = self.asset(digest)
        if target.exists():
            if sha(target.read_bytes()) != digest:
                raise ValueError("A private PDF backup is corrupt; publication stopped.")
        else:
            atomic_write(target, content)
        return digest

    def import_catalog(self, initial=False):
        with self.lock:
            content = self.catalog.read_bytes() if self.catalog.exists() else encoded({"schema_version": SCHEMA, "papers": []})
            catalog = json.loads(content)
            if catalog.get("schema_version") != SCHEMA or not isinstance(catalog.get("papers"), list):
                raise ValueError("The website research catalog has an unsupported format.")
            updated = deepcopy(self.state)
            for existing in updated["papers"].values():
                existing["status"] = "unpublished"
            seen = set()
            for raw in catalog["papers"]:
                if raw.get("status") != "published":
                    raise ValueError("The public catalog must contain published papers only.")
                item = metadata(raw)
                if item["id"] in seen:
                    raise ValueError("The public catalog contains duplicate paper IDs.")
                seen.add(item["id"])
                path = self.public_path(raw.get("pdf"))
                pdf = validate_pdf(path.name, path.read_bytes())
                digest = self.keep_pdf(pdf)
                if raw.get("sha256") and raw["sha256"] != digest:
                    raise ValueError("Published PDF checksum does not match its catalog entry.")
                previous = updated["papers"].get(item["id"], {})
                item.update(status="published", pdf=raw["pdf"], sha256=digest, bytes=len(pdf),
                    revisions=deepcopy(previous.get("revisions", [])))
                updated["papers"][item["id"]] = item
            updated["catalog_sha256"] = sha(content) if self.catalog.exists() else None
            if initial or "deployment_baseline" not in updated:
                updated["deployment_baseline"] = {"data/research.json": publication_digest("data/research.json", content) if self.catalog.exists() else None,
                    **{item["pdf"]: item["sha256"] for item in updated["papers"].values() if item["status"] == "published"}}
            if not initial:
                self.backup_state()
            atomic_write(self.state_path, encoded(updated))
            self.state = updated

    def backup_state(self):
        destination = self.private / "history" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4))
        destination.mkdir(parents=True)
        if self.state_path.exists():
            atomic_write(destination / "library.json", self.state_path.read_bytes())
        if self.catalog.exists():
            atomic_write(destination / "research.json", self.catalog.read_bytes())

    def check_external_changes(self):
        current = sha(self.catalog.read_bytes()) if self.catalog.exists() else None
        if current != self.state["catalog_sha256"]:
            raise ValueError("The website catalog changed outside this manager. Use Reload website catalog before editing.")
        for item in self.state["papers"].values():
            if item["status"] == "published":
                path = self.public_path(item["pdf"])
                if not path.exists() or sha(path.read_bytes()) != item["sha256"]:
                    raise ValueError(f"The published PDF for {item['title']} changed outside this manager. Reload the website catalog first.")

    def public_catalog(self, papers):
        return {"schema_version": SCHEMA, "updated_at": now(), "papers": [
            {key: value for key, value in item.items() if key != "revisions"}
            for item in sorted(papers.values(), key=lambda p: (p["date"], p["id"]), reverse=True)
            if item["status"] == "published"]}

    def commit(self, papers, writes, removals):
        self.check_external_changes()
        self.backup_state()
        public = self.public_catalog(papers)
        existing_content = self.catalog.read_bytes() if self.catalog.exists() else None
        content = (existing_content if existing_content and json.loads(existing_content).get("papers") == public["papers"] else encoded(public))
        state = {**deepcopy(self.state), "version": 1, "papers": papers, "catalog_sha256": sha(content)}
        paths = [self.catalog, self.state_path, *writes, *removals]
        originals = {path: path.read_bytes() if path.exists() else None for path in paths}
        try:
            for path, value in writes.items():
                atomic_write(path, value)
            atomic_write(self.catalog, content)
            atomic_write(self.state_path, encoded(state))
            for path in removals:
                if path.exists():
                    path.unlink()  # Explicit withdrawal/replacement; private hash backup retained.
            self.state = state
        except Exception:
            for path, original in originals.items():
                if original is not None:
                    atomic_write(path, original)
                elif path.exists():
                    path.unlink()
            raise

    def save(self, values, pdf=None, filename=None, publish=None):
        with self.lock:
            if publish is not None and not isinstance(publish, bool):
                raise ValueError("Publication state must be true or false.")
            item = metadata(values)
            previous = self.state["papers"].get(item["id"])
            if values.get("new") and previous:
                raise ValueError("That paper ID already exists. Choose another ID or edit the existing paper.")
            if pdf is None and not previous:
                raise ValueError("Choose a PDF for the new paper.")
            if pdf is not None:
                pdf = validate_pdf(filename, pdf)
                digest = self.keep_pdf(pdf)
            else:
                digest = previous["sha256"]
                pdf = self.asset(digest).read_bytes()
                if sha(pdf) != digest:
                    raise ValueError("The private PDF backup failed its checksum.")
            status = ("published" if publish else "unpublished") if publish is not None else (previous or {}).get("status", "unpublished")
            item.update(status=status, pdf=f"papers/{item['id']}.pdf", sha256=digest, bytes=len(pdf),
                revisions=deepcopy((previous or {}).get("revisions", [])))
            if previous:
                item["revisions"].append({"saved_at": now(), "sha256": previous["sha256"],
                    "version": previous.get("version", ""), "title": previous["title"], "date": previous["date"], "pdf": previous["pdf"]})
            papers = deepcopy(self.state["papers"])
            papers[item["id"]] = item
            writes = {self.public_path(item["pdf"]): pdf} if status == "published" else {}
            removals = []
            if previous and previous["status"] == "published" and (status != "published" or previous["pdf"] != item["pdf"]):
                removals.append(self.public_path(previous["pdf"]))
            self.commit(papers, writes, removals)
            return deepcopy(item)

    def visibility(self, paper_id, published):
        with self.lock:
            paper_id = valid_slug(paper_id)
            previous = self.state["papers"].get(paper_id)
            if previous is None:
                raise ValueError("Paper not found.")
            return self.save(previous, publish=published)

    def list(self):
        with self.lock:
            return {"papers": sorted(deepcopy(list(self.state["papers"].values())), key=lambda p:p["title"]),
                "backup_directory": str(self.private), "site_directory": str(self.site)}

    def private_pdf(self, paper_id, digest=None):
        item = self.state["papers"].get(valid_slug(paper_id))
        if item is None:
            raise ValueError("Paper not found.")
        digest = digest or item["sha256"]
        if digest not in {item["sha256"], *(r["sha256"] for r in item.get("revisions", []))}:
            raise ValueError("This version does not belong to the selected paper.")
        content = self.asset(digest).read_bytes()
        if sha(content) != digest:
            raise ValueError("The private PDF backup failed its checksum.")
        return content


class GitPublisher:
    """Publish through a private clean clone; never change the editing repo index."""
    PRODUCTION_REMOTE = "https://github.com/ceospr/website.git"

    def __init__(self, library, runner=subprocess.run, *, remote=None, branch="main"):
        # Overrides are for local integration tests, never HTTP/GUI parameters.
        self.library, self.runner = library, runner
        self.remote, self.branch = remote or self.PRODUCTION_REMOTE, branch
        self.reviewed = None

    def git(self, *args, cwd=None):
        result = self.runner(["git", *args], cwd=cwd or self.library.site, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=180, creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
        if result.returncode:
            raise ValueError((result.stderr or result.stdout or "Git operation failed.").strip())
        return result.stdout.rstrip("\r\n")

    @staticmethod
    def owned(path):
        return path == "data/research.json" or (bool(PDF_PATH.fullmatch(path)) and ".." not in path)

    def snapshot(self):
        self.library.check_external_changes()
        baseline = self.library.state.get("deployment_baseline")
        if not isinstance(baseline, dict):
            raise ValueError("A published research baseline is required before using this manager.")
        paths = set(baseline) | {"data/research.json"}
        paths.update(item["pdf"] for item in self.library.state["papers"].values() if item["status"] == "published")
        if any(not self.owned(path) for path in paths):
            raise ValueError("The research baseline contains an unsupported path.")
        values = {}
        for name in paths:
            path = self.library.catalog if name == "data/research.json" else self.library.public_path(name)
            values[name] = publication_digest(name, path.read_bytes()) if path.is_file() else None
        return values

    def checkout_path(self, checkout, relative):
        if not self.owned(relative):
            raise ValueError("Only the research catalog and PDFs can be published.")
        path = (checkout / relative).resolve()
        if not path.is_relative_to(checkout.resolve()):
            raise ValueError("A remote research path escapes the isolated checkout.")
        return path

    def remote_snapshot(self, checkout, paths):
        return {name: publication_digest(name, path.read_bytes()) if path.is_file() else None
            for name in paths for path in [self.checkout_path(checkout, name)]}

    def deployed(self, snapshot, commit):
        state = deepcopy(self.library.state)
        state["deployment_baseline"] = snapshot
        state["last_push"] = {"commit": commit, "at": now(), "remote": self.remote, "branch": self.branch}
        atomic_write(self.library.state_path, encoded(state))
        self.library.state = state

    def cleanup(self, checkout):
        deployments = (self.library.private / "deployments").resolve()
        checkout = Path(checkout).resolve()
        if not checkout.is_relative_to(deployments) or checkout == deployments:
            raise ValueError("Refusing to remove an unexpected temporary checkout.")
        shutil.rmtree(checkout, ignore_errors=True)

    def review(self):
        with self.library.lock:
            snapshot = self.snapshot()
            baseline = self.library.state["deployment_baseline"]
            files = sorted(name for name, value in snapshot.items() if value != baseline.get(name))
            if self.reviewed:
                self.cleanup(self.reviewed["checkout"])
                self.reviewed = None
            if not files:
                return {"review_id": "", "files": [], "sha256": snapshot, "remote": self.remote,
                    "branch": self.branch, "message": "No local research changes need publishing."}
            deployments = self.library.private / "deployments"
            deployments.mkdir(exist_ok=True)
            checkout = Path(tempfile.mkdtemp(prefix="review-", dir=deployments))
            try:
                self.git("clone", "--quiet", "--depth", "1", "--single-branch", "--branch", self.branch,
                    "--", self.remote, str(checkout), cwd=self.library.private)
                remote_head = self.git("rev-parse", "HEAD", cwd=checkout)
                remote_values = self.remote_snapshot(checkout, snapshot)
                if remote_values == snapshot:
                    # Recover safely if a previous push succeeded before the
                    # local receipt could be written (for example, a shutdown).
                    self.deployed(snapshot, remote_head)
                    self.cleanup(checkout)
                    return {"review_id": "", "files": [], "sha256": snapshot, "remote": self.remote,
                        "branch": self.branch, "message": "These research files already match the published branch."}
                conflicts = [name for name, value in remote_values.items() if value != baseline.get(name)]
                if conflicts:
                    raise ValueError("Published research changed since your saved baseline: " + ", ".join(conflicts)
                        + ". Publication stopped. Reconcile the latest published research before retrying; local edits and backups are retained.")
                for name in files:
                    destination = self.checkout_path(checkout, name)
                    if snapshot[name] is None:
                        if destination.exists():
                            destination.unlink()
                    else:
                        content = (self.library.site / name).read_bytes()
                        if publication_digest(name, content) != snapshot[name]:
                            raise ValueError("A research file changed while preparing the review.")
                        atomic_write(destination, content)
                self.git("add", "--", *files, cwd=checkout)
                staged = set(filter(None,self.git("diff", "--cached", "--name-only", "-z", cwd=checkout).split("\0")))
                if staged != set(files):
                    raise ValueError("The isolated review contains unexpected staged paths.")
                public = {"remote": self.remote, "branch": self.branch, "head": remote_head,
                    "files": files, "sha256": snapshot, "review_id": secrets.token_urlsafe(24)}
                self.reviewed = {"public": deepcopy(public), "checkout": checkout}
                return public
            except Exception:
                self.cleanup(checkout)
                raise

    def publish(self, review_id, confirmed):
        with self.library.lock:
            if confirmed is not True or not self.reviewed or review_id != self.reviewed["public"]["review_id"]:
                raise ValueError("Review the changes and explicitly confirm publishing first.")
            review, checkout = self.reviewed["public"], self.reviewed["checkout"]
            if self.snapshot() != review["sha256"]:
                raise ValueError("Local research changed after review. Review the changes again.")
            self.git("fetch", "--quiet", "origin", self.branch, cwd=checkout)
            if self.git("rev-parse", "FETCH_HEAD", cwd=checkout) != review["head"]:
                raise ValueError("The published branch changed after review. Review again to preserve the newer website changes.")
            if self.remote_snapshot(checkout, review["sha256"]) != review["sha256"]:
                raise ValueError("The isolated research files changed after review.")
            staged = set(filter(None,self.git("diff", "--cached", "--name-only", "-z", cwd=checkout).split("\0")))
            if staged != set(review["files"]):
                raise ValueError("Unexpected staged files in the isolated publication checkout.")
            try:
                author = self.git("config", "--get", "user.name")
                email = self.git("config", "--get", "user.email")
            except ValueError:
                raise ValueError("Set your Git name and email in GitHub Desktop once, then retry publishing.") from None
            if not author or not email:
                raise ValueError("A Git name and email are required for the publication commit.")
            self.git("-c", f"user.name={author}", "-c", f"user.email={email}", "commit", "-m", "Update research library",
                "--only", "--", *review["files"], cwd=checkout)
            commit = self.git("rev-parse", "HEAD", cwd=checkout)
            try:
                self.git("push", "origin", f"HEAD:refs/heads/{self.branch}", cwd=checkout)
            except ValueError as exc:
                raise ValueError("Push failed. Your editing checkout and its Git index were not changed. Review again to retry safely. " + str(exc)) from exc
            self.deployed(review["sha256"], commit)
            self.reviewed = None
            self.cleanup(checkout)
            return {"status": "PUSHED", "commit": commit,
                "message": "Research changes were pushed to GitHub. The live site updates after its deployment completes. Your editing checkout’s Git index was not changed."}

def handler(library, publisher, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = "SpinozaLocalResearch/1.0"
        def log_message(self, *args):
            pass

        def trusted(self, mutation=False):
            origin = f"http://127.0.0.1:{self.server.server_port}"
            if self.headers.get("Host") != origin.removeprefix("http://"):
                return False
            supplied = self.headers.get("Origin")
            if supplied and supplied != origin:
                return False
            if mutation and supplied != origin:
                return False
            return True

        def authenticated(self):
            return secrets.compare_digest(self.headers.get("X-Research-Token", ""), token)

        def respond(self, code, content, content_type="application/json; charset=utf-8", filename=None):
            if not isinstance(content, bytes):
                content = encoded(content)
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(content)

        def do_GET(self):
            if not self.trusted():
                self.respond(403, {"error": "Local origin required."}); return
            parsed = urlsplit(self.path)
            route = unquote(parsed.path)
            try:
                if route.startswith("/api/"):
                    if not self.authenticated():
                        self.respond(403, {"error": "Relaunch the manager to open an authenticated session."}); return
                    if route == "/api/library":
                        self.respond(200, library.list()); return
                    if route == "/api/pdf":
                        query = parse_qs(parsed.query)
                        paper_id = query.get("id", [""])[0]
                        content = library.private_pdf(paper_id, query.get("sha256", [None])[0])
                        self.respond(200, content, "application/pdf", paper_id + ".pdf"); return
                    self.respond(404, {"error": "Unknown operation."}); return
                if route in ("/", "/admin.js", "/admin.css"):
                    target = Path(__file__).parent / ("admin.html" if route == "/" else route[1:])
                elif route.startswith("/site/"):
                    relative = route[len("/site/"):] or "index.html"
                    if any(part.startswith(".") for part in Path(relative).parts) or "\\" in relative:
                        raise ValueError("Hidden or invalid paths are not served.")
                    target = (library.site / relative).resolve()
                    if not target.is_relative_to(library.site) or target.suffix.lower() not in {".html",".css",".js",".json",".pdf",".svg",".png",".ico",".woff",".woff2"}:
                        raise ValueError("Preview path is not allowed.")
                else:
                    self.respond(404, {"error": "Page not found."}); return
                self.respond(200, target.read_bytes(), mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            except (ValueError, KeyError, OSError) as exc:
                self.respond(400, {"error": str(exc)})

        def do_POST(self):
            if not self.trusted(mutation=True) or not self.authenticated():
                self.respond(403, {"error": "An authenticated local session is required."}); return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_REQUEST or self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ValueError("A JSON request of at most 45 MB is required.")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Request must be an object.")
                route = urlsplit(self.path).path
                if route == "/api/save":
                    upload = body.get("pdf")
                    pdf = base64.b64decode(upload["base64"], validate=True) if upload else None
                    result = library.save(body["paper"], pdf=pdf, filename=upload.get("name") if upload else None, publish=body.get("publish"))
                elif route == "/api/visibility":
                    if not isinstance(body.get("published"), bool):
                        raise ValueError("Choose publish or withdraw.")
                    result = library.visibility(body["id"], body["published"])
                elif route == "/api/import":
                    if body.get("confirmed") is not True:
                        raise ValueError("Confirm reloading the published catalog first.")
                    library.import_catalog(); result = library.list()
                elif route == "/api/review":
                    result = publisher.review()
                elif route == "/api/publish":
                    result = publisher.publish(body.get("review_id"), body.get("confirmed"))
                else:
                    self.respond(404, {"error": "Unknown operation."}); return
                self.respond(200, result)
            except (ValueError, KeyError, OSError, TypeError, subprocess.SubprocessError) as exc:
                self.respond(400, {"error": str(exc)})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--private", type=Path)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    private = Path(args.private or default_private(args.site)).resolve()
    private.mkdir(parents=True, exist_ok=True)
    lock = (private / "manager.lock").open("a+b")
    lock.seek(0)
    if not lock.read(1):
        lock.write(b"0"); lock.flush()
    lock.seek(0)
    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise SystemExit("This research library manager is already running. Use its existing browser window.")
    library = Library(args.site, private)
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler(library, GitPublisher(library), token))
    server.daemon_threads = True
    print("Spinoza Research Manager is running locally. Keep this window open; press Ctrl+C to close.")
    if not args.no_browser:
        webbrowser.open(f"http://127.0.0.1:{server.server_port}/#token={token}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close(); lock.close()


if __name__ == "__main__":
    main()
