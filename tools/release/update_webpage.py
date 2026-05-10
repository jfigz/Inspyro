from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

from release_common import load_config, repo_root_from_config, resolve_path


@dataclass
class WebUpdateResult:
    files_updated: list[str]
    cache_buster: str
    release_url: str
    installer_url: str
    zip_path: str | None
    dry_run: bool


def cache_buster_for(version: str, date: datetime | None = None) -> str:
    stamp = (date or datetime.now()).strftime("%Y%m%d")
    compact_version = version.replace(".", "")
    return f"{stamp}-v{compact_version}"


def update_html_content(content: str, *, version: str, release_url: str, installer_url: str, cache_buster: str) -> str:
    content = re.sub(r"style\.css\?v=[A-Za-z0-9_.-]+", f"style.css?v={cache_buster}", content)
    content = re.sub(r"main\.js\?v=[A-Za-z0-9_.-]+", f"main.js?v={cache_buster}", content)
    content = re.sub(r"https://github\.com/jfigz/Inspyro/tree/main/SKILLS", release_url, content)
    content = re.sub(r"https://github\.com/jfigz/Inspyro/releases/tag/v[0-9]+\.[0-9]+\.[0-9]+", release_url, content)
    content = re.sub(
        r"https://github\.com/jfigz/Inspyro/releases/download/[^\"']+/Inspyro-Setup-[0-9]+\.[0-9]+\.[0-9]+-x64\.(?:exe|zip)",
        installer_url,
        content,
    )
    content = re.sub(r"Beta [0-9]+\.[0-9]+\.[0-9]+", f"Beta {version}", content)
    content = content.replace(">SKILLS<", ">Release<")
    return content


def update_webpage(
    webpage_dir: Path,
    *,
    version: str,
    github_repo: str,
    cache_buster: str | None = None,
    zip_path: Path | None = None,
    dry_run: bool = False,
) -> WebUpdateResult:
    cache_buster = cache_buster or cache_buster_for(version)
    release_url = f"https://github.com/{github_repo}/releases/tag/v{version}"
    installer_url = f"https://github.com/{github_repo}/releases/download/v{version}/Inspyro-Setup-{version}-x64.exe"
    files_updated: list[str] = []

    for name in ("index.html", "youtube.html"):
        path = webpage_dir / name
        original = path.read_text(encoding="utf-8")
        updated = update_html_content(
            original,
            version=version,
            release_url=release_url,
            installer_url=installer_url,
            cache_buster=cache_buster,
        )
        if updated != original:
            files_updated.append(str(path))
            if not dry_run:
                path.write_text(updated, encoding="utf-8", newline="")

    if zip_path and not dry_run:
        create_hostinger_zip(webpage_dir, zip_path)

    return WebUpdateResult(
        files_updated=files_updated,
        cache_buster=cache_buster,
        release_url=release_url,
        installer_url=installer_url,
        zip_path=str(zip_path) if zip_path else None,
        dry_run=dry_run,
    )


def create_hostinger_zip(webpage_dir: Path, zip_path: Path) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    include_names = ["index.html", "youtube.html", "style.css", "main.js", "assets"]
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in include_names:
            path = webpage_dir / name
            if path.is_dir():
                for child in path.rglob("*"):
                    if child.is_file():
                        archive.write(child, child.relative_to(webpage_dir).as_posix())
            elif path.exists():
                archive.write(path, path.relative_to(webpage_dir).as_posix())


def main() -> int:
    parser = argparse.ArgumentParser(description="Update OpenPyro webpage links for a public Inspyro release.")
    parser.add_argument("--config", default=None)
    parser.add_argument("--webpage-dir", default=None)
    parser.add_argument("--version", required=True)
    parser.add_argument("--github-repo", default=None)
    parser.add_argument("--cache-buster", default=None)
    parser.add_argument("--zip", dest="zip_path", default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)
    source_repo = repo_root_from_config(config)
    webpage_dir = resolve_path(args.webpage_dir or config["webpage_dir"], base=source_repo)
    zip_path = resolve_path(args.zip_path or config["web"]["hostinger_zip"], base=source_repo) if args.zip_path is not None else None
    result = update_webpage(
        webpage_dir,
        version=args.version,
        github_repo=args.github_repo or config["github_repo"],
        cache_buster=args.cache_buster,
        zip_path=zip_path,
        dry_run=args.dry_run,
    )
    print(json.dumps(asdict(result), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
