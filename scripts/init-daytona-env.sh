#!/bin/sh
set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_directory/.." && pwd)
destination="$repository_root/.env.daytona"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate Daytona development secrets" >&2
  exit 1
fi

if [ -e "$destination" ]; then
  updated=false
  if ! grep -q '^DAYTONA_INTERNAL_SSH_GATEWAY_KEY=' "$destination"; then
    umask 077
    printf 'DAYTONA_INTERNAL_SSH_GATEWAY_KEY=%s\n' "$(openssl rand -hex 32)" >> "$destination"
    updated=true
  fi
  if ! grep -q '^DAYTONA_DEFAULT_SNAPSHOT=' "$destination"; then
    printf 'DAYTONA_DEFAULT_SNAPSHOT=daytonaio/sandbox:0.5.0-slim\n' >> "$destination"
    updated=true
  fi
  if [ "$updated" = true ]; then
    echo "Updated .env.daytona with missing Daytona defaults"
  else
    echo ".env.daytona already exists; leaving it unchanged"
  fi
  exit 0
fi

umask 077
temporary_file=$(mktemp "$repository_root/.env.daytona.tmp.XXXXXX")
cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT HUP INT TERM

{
  echo "DAYTONA_OSS_IMAGE_TAG=latest"
  echo "DAYTONA_DEFAULT_SNAPSHOT=daytonaio/sandbox:0.5.0-slim"
  echo "DAYTONA_INTERNAL_ENCRYPTION_KEY=$(openssl rand -hex 32)"
  echo "DAYTONA_INTERNAL_ENCRYPTION_SALT=$(openssl rand -hex 16)"
  echo "DAYTONA_INTERNAL_POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  echo "DAYTONA_INTERNAL_RUNNER_TOKEN=$(openssl rand -hex 32)"
  echo "DAYTONA_INTERNAL_PROXY_KEY=$(openssl rand -hex 32)"
  echo "DAYTONA_INTERNAL_SSH_GATEWAY_KEY=$(openssl rand -hex 32)"
  echo "DAYTONA_INTERNAL_HEALTH_KEY=$(openssl rand -hex 32)"
  echo "DAYTONA_INTERNAL_REGISTRY_PASSWORD=$(openssl rand -hex 24)"
  echo "DAYTONA_INTERNAL_MINIO_USER=daytona"
  echo "DAYTONA_INTERNAL_MINIO_PASSWORD=$(openssl rand -hex 32)"
} > "$temporary_file"

mv "$temporary_file" "$destination"
trap - EXIT HUP INT TERM
echo "Created .env.daytona with local Daytona infrastructure secrets"
