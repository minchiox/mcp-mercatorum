# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/minchiox/mcp-mercatorum/security/advisories/new) instead.
Include steps to reproduce and the affected version; never include real session files or personal data.

You will get an answer within a week. Fixes are released as patch versions and credited in the changelog unless you
prefer otherwise.

## Scope

In scope, for example:
- any way to make the server **write to the platform** (attendance, progress, tests) despite the guard;
- leaks of the session file or of captured personal data;
- writing files outside `MERCATORUM_WORKSPACE`, or reaching hosts outside the allowlist;
- prompt-injection paths from downloaded content that lead to the above.

Out of scope: vulnerabilities of the Mercatorum platform itself (report them to the university), and issues that
require an attacker who already controls the user's machine.

## Design notes

The read-only guarantee is enforced in `src/core/guard.ts` and applied both to browser traffic (Playwright routing,
service workers blocked) and to direct HTTP calls. Sessions are stored with user-only permissions in the OS data
folder. See the "Sicurezza e privacy" section of the README.
