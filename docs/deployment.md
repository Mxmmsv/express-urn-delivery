# VPS deployment

The bot runs as `paige-express` on Ubuntu 24.04 under
`paige-express.service`. CI uses Node.js 24.18.0, matching the initial VPS runtime.
Only one bot process may use the JSON stores at a time.

## Server layout

```text
/opt/paige-express/
  current -> releases/<release-id>
  releases/
    initial/
    <commit>-<run-id>-<run-attempt>/
  shared/
    .env
    data/
      guild-settings.json
      news-state.json
```

Every release has `.env` and `data` symlinks to `shared`. The upload contains only
`dist`, `assets`, `package.json`, and `package-lock.json`. Deployment and rollback
do not replace server settings or delivery history. Stop the local bot before
copying its JSON stores to the VPS for the first deployment.

## Deployment permissions

Install `ops/paige-express.sudoers` as
`/etc/sudoers.d/paige-express`, owned by `root:root` with mode `0440`.
Validate it with `visudo -cf /etc/sudoers.d/paige-express`, then validate the full
configuration with `visudo -c`.

The rule allows passwordless restart of this service and reading its latest 100
journal entries. The deployment user does not need general sudo access.

## GitHub configuration

Create these repository secrets in Settings → Secrets and variables → Actions:

| Secret            | Value                                            |
| ----------------- | ------------------------------------------------ |
| `SSH_HOST`        | VPS IPv4 address or hostname                     |
| `SSH_USER`        | `paige-express`                                  |
| `SSH_PORT`        | SSH port, initially `22`                         |
| `SSH_PRIVATE_KEY` | Dedicated OpenSSH private key without passphrase |
| `SSH_KNOWN_HOSTS` | Verified `known_hosts` entry for the server      |

The Discord token stays in `/opt/paige-express/shared/.env`. It is not included
in the GitHub artifact. The workflow verifies the server key and does not use
`ssh-keyscan` to trust a new key during deployment.

## Workflow behavior

Pull requests targeting `main` run dependency installation, type checking,
linting, formatting checks, deployment script syntax checks, and the build. Pushes to `main` additionally deploy
the successful build. A manual workflow run also deploys when `main` is selected.
Manual runs from other branches do not deploy.

Workflow runs on the same ref are serialized without cancelling the active run.
GitHub retains at most one pending run in each group, replacing it with a newer
pending run. A server-side lock also prevents simultaneous activation.

The script installs production dependencies into a new release before
atomically switching `current` and restarting the service. It checks the new
systemd invocation's journal for both the Discord connection and the news
delivery startup logs for up to 60 seconds. These logs confirm startup, not a
successful Steam request or delivery of a particular news item.

If restart or startup verification fails after activation, the script restores
the previous release and checks its startup. A failed rollback is reported for
manual recovery. Release directories remain available for rollback; successful
deployments remove their uploaded archive and script. Release retention needs
periodic maintenance on the VPS.

## Operations

Run these commands as root:

```bash
systemctl status paige-express.service --no-pager
journalctl -u paige-express.service -n 30 --no-pager
systemctl restart paige-express.service
```

To roll back manually, substitute an existing release directory:

```bash
ln -s /opt/paige-express/releases/initial /opt/paige-express/current.rollback
mv -Tf /opt/paige-express/current.rollback /opt/paige-express/current
systemctl restart paige-express.service
journalctl -u paige-express.service -n 30 --no-pager
```

Do not roll back while a deployment is running. A code rollback keeps the current
JSON data; future changes to the storage format must preserve compatibility or
include a separate data migration and recovery plan.
