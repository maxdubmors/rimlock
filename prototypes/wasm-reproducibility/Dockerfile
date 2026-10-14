# Multi-arch index digest of rust:1.99.0-slim-trixie: the same digest resolves to the
# linux/amd64 or linux/arm64 image, so one pin covers both architectures.
FROM docker.io/library/rust:1.99.0-slim-trixie@sha256:2752b332db73fdbb7dc576f06c82ed1f312005784ef913d7e04a28f5f55dc581

ARG WASM_BINDGEN_VERSION=0.2.129
RUN rustup target add wasm32-unknown-unknown \
 && cargo install --locked --root /opt/wasm-bindgen wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" \
 && rm -rf "$CARGO_HOME/registry" "$CARGO_HOME/git"
ENV PATH=/opt/wasm-bindgen/bin:$PATH
WORKDIR /src
