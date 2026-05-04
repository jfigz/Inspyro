# Contributing to Inspyro

Thanks for contributing to Inspyro.

## What We Optimize For

- clear engineering workflows
- reproducible local execution
- notebook-first and agent-first usability
- report artifacts that are easy to trust
- documentation that stays in sync with the code

## Before You Start

Read these files first:

1. [README.md](README.md)
2. [AGENTS.md](AGENTS.md)
3. [docs/llm-index.yaml](docs/llm-index.yaml)
4. [docs/agents/quickstart.md](docs/agents/quickstart.md)

## Setup

Windows:

```powershell
python -m venv venv_inspyro
.\venv_inspyro\Scripts\activate
pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
```

Linux / WSL:

```bash
python3 -m venv venv_inspyro
source venv_inspyro/bin/activate
pip install -r backend/requirements.txt
cd frontend && npm install && cd ..
```

## Recommended Dev Flow

1. Create a focused branch.
2. Run the lightweight gates before larger changes:

```powershell
.\agent_debug.ps1 bootstrap-agent
.\agent_debug.ps1 verify-fast
```

3. Make the code change and the matching documentation change in the same session.
4. If you touch MCP behavior, run:

```powershell
.\agent_debug.ps1 mcp-smoke
```

5. Before merge, run:

```powershell
.\agent_debug.ps1 verify
```

## Documentation Rules

- If you change public behavior, update the relevant docs in the same PR.
- If you change WS or REST contracts, update:
  - `docs/architecture/contracts-catalog.md`
  - `docs/llm-index.yaml`
  - impacted module docs in `docs/modules/`
- If you change an end-to-end flow, update:
  - `docs/architecture/feature-threads.md`
  - `docs/architecture/synergy-matrix.md`
  - `docs/llm-index.yaml`

## Tests and Checks

Useful commands:

```powershell
.\agent_debug.ps1 docs-check
.\agent_debug.ps1 contracts-check
.\agent_debug.ps1 verify-fast
.\agent_debug.ps1 verify
.\agent_debug.ps1 mcp-smoke
.\agent_debug.ps1 playwright-e2e
```

## Pull Requests

Good PRs for this repo usually include:

- a short problem statement
- a clear user-facing outcome
- notes on docs updated
- validation performed
- screenshots or short recordings for visible UI changes

## Scope

Examples of high-value contributions:

- better notebook/report authoring workflows
- clearer agent onboarding and MCP discoverability
- more reliable report generation and artifact delivery
- example workspaces and demo improvements
- sharper first-run UX for new users

If you are unsure where to start, open a feature request or improve the canonical demo workspace in [examples/structural-report-demo](examples/structural-report-demo/README.md).
