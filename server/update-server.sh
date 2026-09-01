#!/usr/bin/env bash
set -euo pipefail

TARGET_VERSION="${1:-${ABC_SERVER_VERSION:-}}"
REPOSITORY="${ABC_SERVER_REPOSITORY:-https://github.com/diegozhou114-cloud/ancient-beast-chess}"
SERVICE_NAME="${ABC_SERVER_SERVICE:-ancient-beast-chess-server.service}"
HEALTH_URL="${ABC_SERVER_HEALTH_URL:-http://127.0.0.1:8787}"
PACKAGE_NAME="ancient-beast-chess-server"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This updater supports Linux only." >&2
  exit 1
fi
if [[ ! "$TARGET_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: $0 <version>" >&2
  echo "Example: $0 1.0.0" >&2
  exit 1
fi

for command_name in curl sha256sum node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done
if (( EUID != 0 )) && ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required when not running as root." >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

run_privileged() {
  if (( EUID == 0 )); then
    "$@"
  else
    sudo "$@"
  fi
}

installed_version() {
  npm list --global "$PACKAGE_NAME" --depth=0 --json 2>/dev/null \
    | node -e 'let input=""; process.stdin.on("data", chunk => input += chunk); process.stdin.on("end", () => { try { process.stdout.write(JSON.parse(input).dependencies?.[process.argv[1]]?.version ?? ""); } catch {} });' "$PACKAGE_NAME"
}

download_and_verify() {
  local version="$1"
  local asset="${PACKAGE_NAME}-${version}.tgz"
  local base_url="${REPOSITORY}/releases/download/server-v${version}"
  curl --fail --silent --show-error --location "${base_url}/${asset}" --output "${TEMP_DIR}/${asset}"
  curl --fail --silent --show-error --location "${base_url}/${asset}.sha256" --output "${TEMP_DIR}/${asset}.sha256"
  local expected
  local actual
  expected="$(awk 'NF { print $1; exit }' "${TEMP_DIR}/${asset}.sha256")"
  actual="$(sha256sum "${TEMP_DIR}/${asset}" | awk '{ print $1 }')"
  if [[ ! "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || [[ "${actual,,}" != "${expected,,}" ]]; then
    echo "SHA-256 verification failed for ${asset}." >&2
    exit 1
  fi
  echo "SHA-256 verified: ${actual}"
}

verify_endpoint_version() {
  local endpoint="$1"
  local output_file="$2"
  curl --fail --silent --show-error "$endpoint" --output "$output_file" || return 1
  node -e 'const fs=require("node:fs"); const body=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); if (body.serverVersion !== process.argv[2]) process.exit(1);' "$output_file" "$TARGET_VERSION"
}

CURRENT_VERSION="$(installed_version)"
if [[ "$CURRENT_VERSION" == "$TARGET_VERSION" ]]; then
  echo "${PACKAGE_NAME} ${TARGET_VERSION} is already installed. Verifying the running service..."
else
  echo "Updating ${PACKAGE_NAME} from ${CURRENT_VERSION:-not-installed} to ${TARGET_VERSION}..."
  download_and_verify "$TARGET_VERSION"
  run_privileged npm install --global "${TEMP_DIR}/${PACKAGE_NAME}-${TARGET_VERSION}.tgz"
fi

INSTALLED_VERSION="$(installed_version)"
if [[ "$INSTALLED_VERSION" != "$TARGET_VERSION" ]]; then
  echo "Installed version mismatch: expected ${TARGET_VERSION}, found ${INSTALLED_VERSION:-none}." >&2
  exit 1
fi

if command -v systemctl >/dev/null 2>&1 && systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then
  run_privileged systemctl restart "$SERVICE_NAME"
  healthy=false
  for _attempt in {1..15}; do
    if verify_endpoint_version "${HEALTH_URL%/}/health" "${TEMP_DIR}/health.json" \
      && verify_endpoint_version "${HEALTH_URL%/}/info" "${TEMP_DIR}/info.json"; then
      healthy=true
      break
    fi
    sleep 1
  done
  if [[ "$healthy" != true ]]; then
    echo "The service did not report version ${TARGET_VERSION} from /health and /info." >&2
    if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$TARGET_VERSION" ]]; then
      echo "Rollback: $0 ${CURRENT_VERSION}" >&2
    fi
    exit 1
  fi
  echo "Service ${SERVICE_NAME} restarted and verified at ${HEALTH_URL%/}."
else
  echo "No systemd unit named ${SERVICE_NAME} was found; package updated without restarting a service."
fi

if [[ -n "$CURRENT_VERSION" && "$CURRENT_VERSION" != "$TARGET_VERSION" ]]; then
  echo "Rollback command: $0 ${CURRENT_VERSION}"
fi
echo "Installed ${PACKAGE_NAME}@${TARGET_VERSION}."
