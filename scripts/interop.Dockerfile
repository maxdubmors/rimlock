# keepassxc-cli for pnpm test:interop (docs/spec/engineering.md § Tests). The base image is pinned
# by the digest of its multi-arch index and the package by its exact Debian version, so the run
# uses the same KeePassXC on x86_64 and arm64. A Debian update that drops this version fails the
# build: move both pins together, then add the new version's files to the corpus.
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

RUN apt-get update \
  && apt-get install --yes --no-install-recommends keepassxc-minimal=2.7.10+dfsg1-1 \
  && rm -rf /var/lib/apt/lists/*
