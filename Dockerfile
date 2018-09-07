# sdk-tag-1.38.11-64bit
FROM trzeci/emscripten@sha256:5e572015aff4b2aa4947bb28e8943c5f3122a17b4fe3fb485a8bda5c74ab6305

RUN mkdir /tls-socket-wasm
COPY . /tls-socket-wasm
WORKDIR /tls-socket-wasm
RUN ./build.sh
