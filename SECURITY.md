# Security Policy

## Supported Branches

Security fixes should target the branch that is currently used for active development and release preparation.

## Reporting a Vulnerability

Please do **not** publish exploitable details in a public issue.

Preferred path:

1. Use GitHub's private vulnerability reporting for this repository if it is enabled.
2. If private reporting is not available, open a minimal public issue titled `Security contact requested` with no sensitive details, and a maintainer will move the conversation to a private channel.

When you report a vulnerability, include:

- affected area or component
- impact level
- reproduction steps
- proof of concept, only through a private channel
- suggested mitigation, if available

## Responsible Disclosure

- We will acknowledge reports as soon as practical.
- We will work to reproduce and triage the issue.
- We may ask for clarification or a reduced proof of concept.
- We aim to ship a fix before public disclosure when the issue is valid and exploitable.

## Scope

Examples of security-sensitive areas in this repository:

- file system access and workspace boundaries
- desktop shell preload and IPC bridges
- local backend APIs
- MCP server exposure and session scoping
- artifact download endpoints
- template or notebook execution paths

Thank you for helping keep Inspyro safe.
