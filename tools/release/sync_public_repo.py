from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

from release_common import git_ls_files, is_denied_path, load_config, repo_root_from_config, resolve_path


@dataclass
class SyncPlan:
    source_repo: str
    public_repo: str
    copy_files: list[str]
    delete_files: list[str]
    skipped_files: list[str]
    dry_run: bool


def build_sync_plan(
    source_repo: Path,
    public_repo: Path,
    denylist: dict,
    *,
    delete_missing: bool = False,
) -> SyncPlan:
    tracked_source = git_ls_files(source_repo)
    copy_files: list[str] = []
    skipped_files: list[str] = []

    for relpath in tracked_source:
        if is_denied_path(relpath, denylist):
            skipped_files.append(relpath)
        else:
            copy_files.append(relpath)

    delete_files: list[str] = []
    if delete_missing:
        desired = set(copy_files)
        for relpath in git_ls_files(public_repo):
            if relpath not in desired:
                delete_files.append(relpath)

    return SyncPlan(
        source_repo=str(source_repo),
        public_repo=str(public_repo),
        copy_files=sorted(copy_files),
        delete_files=sorted(delete_files),
        skipped_files=sorted(skipped_files),
        dry_run=True,
    )


def apply_sync_plan(plan: SyncPlan) -> None:
    source_repo = Path(plan.source_repo)
    public_repo = Path(plan.public_repo)

    for relpath in plan.copy_files:
        src = source_repo / relpath
        dst = public_repo / relpath
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    for relpath in plan.delete_files:
        target = public_repo / relpath
        if target.exists():
            subprocess.run(
                ["git", "-C", str(public_repo), "rm", "-f", "--", relpath],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        else:
            subprocess.run(
                ["git", "-C", str(public_repo), "rm", "--cached", "--ignore-unmatch", "--", relpath],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        prune_empty_dirs(target.parent, public_repo)


def prune_empty_dirs(path: Path, stop: Path) -> None:
    path = path.resolve()
    stop = stop.resolve()
    while path != stop and stop in path.parents:
        try:
            path.rmdir()
        except OSError:
            break
        path = path.parent


def write_manifest(plan: SyncPlan, manifest_path: Path) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(asdict(plan), indent=2, ensure_ascii=False), encoding="utf-8")


def print_plan_summary(plan: SyncPlan) -> None:
    print(f"Source: {plan.source_repo}")
    print(f"Public: {plan.public_repo}")
    print(f"Copy files: {len(plan.copy_files)}")
    print(f"Delete files: {len(plan.delete_files)}")
    print(f"Skipped files: {len(plan.skipped_files)}")
    for label, values in (("delete", plan.delete_files), ("skip", plan.skipped_files)):
        if values:
            preview = values[:20]
            print(f"{label} preview:")
            for relpath in preview:
                print(f"  - {relpath}")
            if len(values) > len(preview):
                print(f"  ... {len(values) - len(preview)} more")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync sanitized tracked files from P1 to Inspyro-public.")
    parser.add_argument("--config", default=None)
    parser.add_argument("--source-repo", default=None)
    parser.add_argument("--public-repo", default=None)
    parser.add_argument("--delete-missing", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--manifest", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    config = load_config(args.config)
    default_source_repo = repo_root_from_config(config)
    source_repo = resolve_path(args.source_repo, base=default_source_repo) if args.source_repo else default_source_repo
    public_repo = resolve_path(args.public_repo or config["public_repo"], base=source_repo)
    plan = build_sync_plan(source_repo, public_repo, config["denylist"], delete_missing=args.delete_missing)
    plan.dry_run = bool(args.dry_run)

    if args.manifest:
        write_manifest(plan, Path(args.manifest))

    if args.json:
        print(json.dumps(asdict(plan), indent=2, ensure_ascii=False))
    else:
        print_plan_summary(plan)

    if not args.dry_run:
        apply_sync_plan(plan)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
