import importlib.util
import json
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
RELEASE_DIR = REPO_ROOT / "tools" / "release"
if str(RELEASE_DIR) not in sys.path:
    sys.path.insert(0, str(RELEASE_DIR))


def load_release_module(name: str):
    spec = importlib.util.spec_from_file_location(name, RELEASE_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


sync_public_repo = load_release_module("sync_public_repo")
audit_public_tree = load_release_module("audit_public_tree")
update_webpage = load_release_module("update_webpage")


def run_git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), *args], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def init_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    run_git(path, "init")
    run_git(path, "config", "user.email", "release-test@example.invalid")
    run_git(path, "config", "user.name", "Release Test")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_sync_public_repo_copies_tracked_files_and_deletes_obsolete_tracked_files(tmp_path):
    source = tmp_path / "P1"
    public = tmp_path / "Inspyro-public"
    init_repo(source)
    init_repo(public)

    write(source / "backend" / "main.py", "print('public')\n")
    write(source / ".codex" / "secret.md", "internal\n")
    run_git(source, "add", ".")
    run_git(source, "commit", "-m", "source")

    write(public / "old.txt", "obsolete\n")
    write(public / "keep-untracked.txt", "not tracked\n")
    run_git(public, "add", "old.txt")
    run_git(public, "commit", "-m", "old")

    denylist = {
        "path_parts": [".codex"],
        "path_globs": [],
    }
    plan = sync_public_repo.build_sync_plan(source, public, denylist, delete_missing=True)
    assert "backend/main.py" in plan.copy_files
    assert ".codex/secret.md" in plan.skipped_files
    assert "old.txt" in plan.delete_files

    plan.dry_run = False
    sync_public_repo.apply_sync_plan(plan)

    assert (public / "backend" / "main.py").read_text(encoding="utf-8") == "print('public')\n"
    assert not (public / ".codex" / "secret.md").exists()
    assert not (public / "old.txt").exists()
    assert "old.txt" not in sync_public_repo.git_ls_files(public)
    assert (public / "keep-untracked.txt").exists()


def test_audit_public_tree_flags_denied_paths_private_paths_and_secret_like_values(tmp_path):
    root = tmp_path / "public"
    write(root / "frontend" / "build" / "app.js", "console.log('generated')\n")
    write(root / ".env", "HOSTINGER_FTP_PASSWORD=super-secret-value-12345\n")
    private_path = "C:" + "\\Users\\Example\\Documents\\Project"
    write(root / "docs" / "path.md", f"Local path {private_path} should not ship.\n")
    write(root / "safe.md", "hello\n")

    config = json.loads((RELEASE_DIR / "public_release.config.json").read_text(encoding="utf-8"))
    issues = audit_public_tree.audit_tree(root, config["denylist"])
    issue_kinds = {issue.kind for issue in issues}
    issue_paths = {issue.path for issue in issues}

    assert "denylist_path" in issue_kinds
    assert "secret_pattern" in issue_kinds
    assert "private_path" in issue_kinds
    assert "frontend/build" in issue_paths
    assert ".env" in issue_paths
    assert "docs/path.md" in issue_paths


def test_update_webpage_rewrites_release_links_and_builds_hostinger_zip(tmp_path):
    webpage = tmp_path / "Webpage" / "v3"
    html = """
<link rel="stylesheet" href="style.css?v=old">
<a href="https://github.com/jfigz/Inspyro/tree/main/SKILLS">SKILLS</a>
<a href="https://github.com/jfigz/Inspyro/releases/tag/v1.0.1">Release</a>
<a href="https://github.com/jfigz/Inspyro/releases/download/Inspyro/Inspyro-Setup-1.0.0-x64.zip">Descargar</a>
<span class="hero-version-badge">Beta 1.0.0</span>
<script src="main.js?v=old"></script>
"""
    write(webpage / "index.html", html)
    write(webpage / "youtube.html", html)
    write(webpage / "style.css", "body{}\n")
    write(webpage / "main.js", "console.log('ok')\n")
    write(webpage / "assets" / "brand" / "mark.png", "not really png\n")
    zip_path = tmp_path / "openpyro.zip"

    result = update_webpage.update_webpage(
        webpage,
        version="1.2.3",
        github_repo="jfigz/Inspyro",
        cache_buster="20260509-v123",
        zip_path=zip_path,
    )

    updated = (webpage / "index.html").read_text(encoding="utf-8")
    assert "style.css?v=20260509-v123" in updated
    assert "main.js?v=20260509-v123" in updated
    assert "https://github.com/jfigz/Inspyro/releases/tag/v1.2.3" in updated
    assert "https://github.com/jfigz/Inspyro/releases/download/v1.2.3/Inspyro-Setup-1.2.3-x64.exe" in updated
    assert "Beta 1.2.3" in updated
    assert "SKILLS" not in updated
    assert sorted(Path(path).name for path in result.files_updated) == ["index.html", "youtube.html"]
    assert zip_path.exists()
