# Docker deployment

This deployment ships Open Design as a single Alpine-based runtime image. The
daemon serves both the API and the built Next.js static export, so there is no
separate nginx container.

## Local compose

```bash
cd deploy
OPEN_DESIGN_IMAGE=open-design:local docker compose build open-design
OPEN_DESIGN_IMAGE=open-design:local docker compose up -d
```

Defaults:

- Host app port: `127.0.0.1:7456` (`OPEN_DESIGN_PORT=8080` to publish on `127.0.0.1:8080`)
- Runtime data volume: `open_design_data` mounted at `/app/.od`
- Kilo CLI config/auth home: `/app/.od/home` (`HOME` is set there so config is writable and persistent)
- Node heap cap: `--max-old-space-size=192`
- Compose memory cap: `1g` (`OPEN_DESIGN_MEM_LIMIT=1536m` to raise for larger or concurrent Kilo runs)
- Kilo CLI: installed during the Docker build by default (`INSTALL_KILO_CLI=false` to skip)
- Root filesystem: writable by default (`OPEN_DESIGN_READ_ONLY=true` only after validating agent CLIs in your setup)

Do not publish the daemon directly on a public or shared LAN interface. The API is
unauthenticated for non-browser clients, so remote deployments should keep Compose
bound to localhost and put an authenticated reverse proxy, SSH tunnel, or VPN in
front of it.

When exposing the service through an authenticated public IP, domain, or reverse
proxy, set `OPEN_DESIGN_ALLOWED_ORIGINS` to the browser origins that should be
allowed to call `/api`:

```bash
OPEN_DESIGN_ALLOWED_ORIGINS=https://od.example.com,http://203.0.113.10:7456 docker compose up -d --no-build
```

If Caddy terminates HTTPS on a public port, keep Open Design published on the
host loopback HTTP port `7456` and proxy to that port. The daemon listens on
`0.0.0.0` inside the container so Docker port publishing can reach it, but
Compose publishes it only as `127.0.0.1:7456`.

Compose builds from the current checkout by default, so the container version
matches this repository and runs the production build. Avoid starting from the
mutable published `latest` image when you need the local checkout version.

Tag a local production image explicitly if you want a versioned local artifact:

```bash
OPEN_DESIGN_IMAGE=open-design:0.8.0 docker compose build open-design
OPEN_DESIGN_IMAGE=open-design:0.8.0 docker compose up -d
```

## Kilo CLI in container

`deploy/Dockerfile` installs `@kilocode/cli` in the production runtime image by
default and runs the service as the base image's `node` user (UID/GID `1000`) so
the container can write the persistent data volume on Linux hosts. Rebuild
the service whenever you update the checkout or want to pick up a newer Kilo CLI
release:

```bash
cd deploy
docker compose build open-design
docker compose up -d
```

Verify that the binary is available to the same container where the daemon runs:

```bash
docker compose exec open-design which kilo
docker compose exec open-design kilo --version
```

Kilo stores mutable auth data under the container user's home. Compose sets
`HOME=/app/.od/home`, and `/app/.od` is the existing persistent volume, so
`~/.config/kilo` auth data survives container restarts.

Authenticate Kilo from inside the container:

```bash
docker compose exec open-design kilo auth
```

This compose setup deliberately does not mount a custom `KILO_CONFIG` or force a
custom default Kilo agent. Keep Docker aligned with the known-good non-Docker
path: Kilo should use its normal `code` agent and its own config under
`~/.config/kilo`.

Kilo/OpenCode also expects a normal project root for tool execution, snapshots,
and root-relative sandbox decisions. The image initializes a minimal git
repository at `/app`, and Compose keeps Open Design data under `/app/.od`, so
Kilo resolves `/app` as the project root instead of walking the full container
filesystem.

Keep the Compose memory cap at 1 GiB or higher when running Kilo in-container.
Kilo's npm entrypoint wraps a native binary; if Docker OOM-kills that inner
binary, the wrapper can still exit `0`, leaving Open Design with a successful but
truncated ACP stream and no `session/prompt` result.

If you already have host-side Kilo config that you want the container to reuse,
mount it explicitly:

```yaml
volumes:
  - open_design_data:/app/.od
  - ~/.config/kilo:/app/.od/home/.config/kilo
```

The root filesystem is writable by default because Kilo/OpenCode can write
session metadata, downloaded native helpers, or inferred-project-root state
outside Open Design's `.od` data directory depending on how it resolves the
workspace. After validating your exact Kilo setup, set `OPEN_DESIGN_READ_ONLY=true`
if you want to restore a read-only root filesystem. Keep `/tmp` mounted with
`:exec`; Kilo may load native bindings extracted there.

The image intentionally does not bundle Claude/Codex/Gemini CLI binaries. Build a
separate private runtime layer if a server deployment needs additional local
code-agent CLIs installed in the container.

## Publish to Docker Hub

```bash
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
IMAGE_NAMESPACE=your-dockerhub-user deploy/scripts/publish-images.sh --arch arm64
deploy/scripts/publish-images.sh --image docker.io/your-user/open-design:0.1.0
```

The script defaults to:

- `docker.io/vanjayak/open-design:<tag>`
- `linux/amd64,linux/arm64`
- `skopeo` push strategy with Docker credentials read from `~/.docker/config.json`
- preloading base images through `skopeo` to reduce Docker Hub pull flakiness

If `127.0.0.1:7890` is available and no proxy is already set, the script uses it
for registry access and passes `host.docker.internal:7890` into Docker builds. The
host-gateway alias is only added for builds that need this local proxy mapping.

### Colima swap helper for Apple Silicon

`deploy/scripts/prepare-colima-build-swap.sh` is for manual Docker image
publishing from an Apple Silicon macOS host that uses Colima as the Docker VM.
The helper is intentionally Apple Silicon-only because the failure mode it covers
is local arm64 Colima builds exhausting a small Linux VM while preparing
multi-arch images. It exits before touching Colima on non-macOS or
non-Apple-Silicon hosts.

Low-memory Colima VMs can run out of RAM during multi-arch image builds. The
helper checks the VM memory and swap status, then creates and enables a temporary
swap file only when the VM has no swap and less than 4 GiB of RAM. The 4 GiB
threshold is a conservative default for short-lived manual publishes on small
Colima profiles; raise `COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB` if larger builds
still OOM, or lower it if you only want swap for very small VMs.

Prefer increasing the Colima VM memory (`colima start --memory <GiB>` or the
profile config) when you want a persistent build machine. Use this helper when
you need a temporary, reversible boost for one manual publish without resizing
or recreating the VM.

Run it before a manual publish if Docker builds fail with out-of-memory errors,
or if `status` shows a small Colima VM with no swap. The swap remains active
until cleanup or VM restart, so use a shell trap for one-off sessions:

```bash
deploy/scripts/prepare-colima-build-swap.sh status
deploy/scripts/prepare-colima-build-swap.sh
trap 'deploy/scripts/prepare-colima-build-swap.sh cleanup' EXIT
deploy/scripts/publish-images.sh --image_tag latest
```

Useful overrides:

```bash
COLIMA_BUILD_SWAP_SIZE=6G deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BUILD_SWAP_MEMORY_THRESHOLD_KIB=6291456 deploy/scripts/prepare-colima-build-swap.sh
COLIMA_BIN=/opt/homebrew/bin/colima deploy/scripts/prepare-colima-build-swap.sh status
COLIMA_BUILD_SWAP_CLEANUP_FORCE=1 COLIMA_BUILD_SWAPFILE=/custom-swapfile deploy/scripts/prepare-colima-build-swap.sh cleanup
```

`cleanup` removes the default helper path and the old helper path. If you set a
custom `COLIMA_BUILD_SWAPFILE`, cleanup refuses to remove it unless
`COLIMA_BUILD_SWAP_CLEANUP_FORCE=1` is also set.
