#!/usr/bin/env bash
set -euo pipefail

VERSION="${ABC_SERVER_VERSION:-1.0.0}"
REPOSITORY="${ABC_SERVER_REPOSITORY:-https://github.com/diegozhou114-cloud/ancient-beast-chess}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "This installer supports Linux only." >&2
  exit 1
fi

case "$(uname -m)" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m). Supported: x64, arm64." >&2
    exit 1
    ;;
esac

for command_name in curl sha256sum node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node.js 20 or newer is required; found $(node --version)." >&2
  exit 1
fi

ASSET="ancient-beast-chess-server-${VERSION}.tgz"
BASE_URL="${REPOSITORY}/releases/download/server-v${VERSION}"
TEMP_DIR="$(mktemp -d)"

cleanup() {
  if [[ -n "${TEMP_DIR:-}" && -d "$TEMP_DIR" ]]; then
    rm -rf -- "$TEMP_DIR"
  fi
}
trap cleanup EXIT

echo "Detected linux-${ARCH}; downloading architecture-neutral server package ${VERSION}..."
curl --fail --silent --show-error --location "${BASE_URL}/${ASSET}" --output "${TEMP_DIR}/${ASSET}"
curl --fail --silent --show-error --location "${BASE_URL}/${ASSET}.sha256" --output "${TEMP_DIR}/${ASSET}.sha256"

EXPECTED_SHA256="$(awk 'NF { print $1; exit }' "${TEMP_DIR}/${ASSET}.sha256")"
ACTUAL_SHA256="$(sha256sum "${TEMP_DIR}/${ASSET}" | awk '{ print $1 }')"
if [[ ! "$EXPECTED_SHA256" =~ ^[0-9a-fA-F]{64}$ ]] || [[ "${ACTUAL_SHA256,,}" != "${EXPECTED_SHA256,,}" ]]; then
  echo "SHA-256 verification failed for ${ASSET}." >&2
  exit 1
fi
echo "SHA-256 verified: ${ACTUAL_SHA256}"

if (( EUID == 0 )); then
  npm install --global "${TEMP_DIR}/${ASSET}"
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required for a global install when not running as root." >&2
    exit 1
  fi
  sudo npm install --global "${TEMP_DIR}/${ASSET}"
fi

echo "Installed: $(command -v ancient-beast-chess-server)"
echo "No operating-system or cloud firewall rules were changed."
echo "Start with: ABC_HOST=0.0.0.0 ABC_PORT=8787 ancient-beast-chess-server"
