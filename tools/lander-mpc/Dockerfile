# Toolchain for the lander's MPC: acados (code generation from Python, and its
# C libraries cross-compiled to WebAssembly) on top of Emscripten.
FROM emscripten/emsdk:7.0.1

ARG ACADOS_VERSION=v0.6.1
ARG TERA_VERSION=v0.2.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3-venv \
 && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${ACADOS_VERSION} --recurse-submodules --shallow-submodules \
      https://github.com/acados/acados.git /opt/acados

# acados_template (the Python interface) renders C from templates with the
# tera renderer; put it where acados_template looks for it.
RUN mkdir -p /opt/acados/bin \
 && curl -fsSL -o /opt/acados/bin/t_renderer \
      https://github.com/acados/tera_renderer/releases/download/${TERA_VERSION}/t_renderer-${TERA_VERSION}-linux-amd64 \
 && chmod +x /opt/acados/bin/t_renderer
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -e /opt/acados/interfaces/acados_template

# acados, HPIPM and BLASFEO as static wasm libraries. GENERIC targets: plain
# C kernels, no x86 intrinsics.
RUN mkdir /opt/acados/build-wasm && cd /opt/acados/build-wasm \
 && emcmake cmake .. \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/acados-wasm \
      -DBUILD_SHARED_LIBS=OFF \
      -DBLASFEO_TARGET=GENERIC \
      -DHPIPM_TARGET=GENERIC \
      -DBLASFEO_CROSSCOMPILING=ON \
      -DACADOS_WITH_OPENMP=OFF \
      -DACADOS_WITH_QPOASES=OFF \
      -DACADOS_WITH_DAQP=OFF \
      -DACADOS_WITH_QPDUNES=OFF \
      -DACADOS_WITH_OSQP=OFF \
      -DACADOS_WITH_HPMPC=OFF \
      -DACADOS_WITH_QORE=OFF \
      -DACADOS_EXAMPLES=OFF \
      -DACADOS_UNIT_TESTS=OFF \
 && emmake make -j"$(nproc)" install

ENV ACADOS_SOURCE_DIR=/opt/acados \
    ACADOS_WASM_DIR=/opt/acados-wasm \
    PATH=/opt/venv/bin:$PATH
