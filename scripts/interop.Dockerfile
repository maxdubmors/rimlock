# keepassxc-cli for pnpm test:interop (docs/spec/engineering.md § Tests). The base image is pinned
# by the digest of its multi-arch index, and apt reads the Debian snapshot that image was built
# from, so every build installs the same packages, on x86_64 and arm64, however Debian moves on.
# A new KeePassXC: move the digest, the snapshot and the version together, then add the new
# version's files to the corpus beside the old version's (crates/AGENTS.md § Interop corpus).
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

# The snapshot's Release files expired long ago by design.
RUN printf '%s\n' \
    'Types: deb' \
    'URIs: http://snapshot.debian.org/archive/debian/20261005T000000Z' \
    'Suites: trixie' \
    'Components: main' \
    'Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp' \
    > /etc/apt/sources.list.d/debian.sources \
  && apt-get --option Acquire::Check-Valid-Until=false update \
  && apt-get install --yes --no-install-recommends keepassxc-minimal=2.7.10+dfsg1-1 \
  && rm -rf /var/lib/apt/lists/*
