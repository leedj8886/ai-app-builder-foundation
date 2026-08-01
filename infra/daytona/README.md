# Project-managed Daytona Build infrastructure

This directory contains the project default for a local or integration
Daytona OSS control plane. It is derived from Daytona's official
[Open Source Deployment](https://www.daytona.io/docs/en/oss-deployment/)
topology and intentionally includes only the services required by the current
Build-only `DaytonaProvider`.

It is not a production deployment. The Runner is privileged and the bundled
Dex account is a local development account. Production should deploy Daytona
separately with TLS, managed secrets, backups, restricted network access, and
dedicated runners, then configure the Worker with its API URL and API key.

## Services

- `daytona-api`: dashboard and control-plane API, exposed on
  `http://localhost:3010`
- `daytona-runner`: privileged Build Sandbox runner
- `daytona-proxy`: internal Toolbox route used by the Worker SDK
- `daytona-db`: PostgreSQL persistence
- `daytona-redis`: Daytona cache and coordination
- `daytona-dex`: local OIDC provider, exposed on `http://localhost:5556`
- `daytona-registry`: transient/internal image registry
- `daytona-minio`: S3-compatible snapshot storage
- `daytona-mail`: local mail sink

The Daytona Proxy is included because SDK file-system and process operations
use its Toolbox route. Browser-facing preview routing, SSH Gateway, PgAdmin,
Registry UI, MinIO Console, Jaeger, and the OpenTelemetry collector are
deliberately omitted. Add them only when the corresponding product capability
is implemented.

## Bootstrap

From the repository root:

```bash
cp .env.example .env
npm run daytona:init

docker compose \
  --env-file .env \
  --env-file .env.daytona \
  -f docker-compose.yml \
  -f docker-compose.daytona.yml \
  up -d daytona-api
```

Open `http://localhost:3010` and sign in with the local-only account:

```text
dev@daytona.io
password
```

The API creates `DAYTONA_DEFAULT_SNAPSHOT` during its first startup. It
defaults to `daytonaio/sandbox:0.5.0-slim`. On a restricted network, preload
that image into the internal `registry:6000` registry and set the variable to
the internal image reference before starting the API.

Confirm the default snapshot is active. Then create a non-expiring API key for
the Worker with these permissions:

```text
write:sandboxes
delete:sandboxes
write:snapshots
delete:snapshots
```

Store the returned key as `DAYTONA_API_KEY` in `.env`. Never put it in
`.env.daytona`, source control, or a Compose file.

Start or recreate the Worker:

```bash
docker compose \
  --env-file .env \
  --env-file .env.daytona \
  -f docker-compose.yml \
  -f docker-compose.daytona.yml \
  up -d --build worker
```

The Overlay sets:

```text
AGENT_VALIDATION_EXECUTOR=sandbox
SANDBOX_PROVIDER=daytona
DAYTONA_API_URL=http://daytona-api:3000/api
DAYTONA_TARGET=us
```

## Operations

Inspect the control plane and Worker:

```bash
docker compose \
  --env-file .env \
  --env-file .env.daytona \
  -f docker-compose.yml \
  -f docker-compose.daytona.yml \
  ps

docker compose \
  --env-file .env \
  --env-file .env.daytona \
  -f docker-compose.yml \
  -f docker-compose.daytona.yml \
  logs --tail=200 daytona-api daytona-runner worker
```

Stop only the bundled Daytona services without affecting the application:

```bash
docker compose \
  --env-file .env \
  --env-file .env.daytona \
  -f docker-compose.yml \
  -f docker-compose.daytona.yml \
  stop daytona-api daytona-proxy daytona-runner daytona-db daytona-redis \
    daytona-dex daytona-registry daytona-minio daytona-mail
```

The named Daytona volumes are retained. Do not delete them unless the local
Daytona database, registry, snapshots, and login state are no longer needed.

## Version policy

The official OSS development Compose currently publishes the Daytona
application images without a version tag, so this local default uses
`DAYTONA_OSS_IMAGE_TAG=latest`. For stable shared integration environments,
set a tested image tag in `.env.daytona` and upgrade it together with the
pinned `@daytona/sdk` version.
