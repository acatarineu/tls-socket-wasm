# sdk-tag-1.38.8-64bit
FROM trzeci/emscripten@sha256:e709ba53b68dac8c52761cb34c53543643387459d3166e465ed6b8fa2dc281f2

RUN mkdir /tls-socket-wasm
COPY . /tls-socket-wasm
WORKDIR /tls-socket-wasm
RUN ./build.sh
