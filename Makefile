SHELL := /bin/bash

.PHONY:
all:
	docker build . -t tls-socket-wasm
	./docker-helpers/extract-files-from-image.sh dist tls-socket-wasm /tls-socket-wasm/dist/tls-socket-wasm.js /tls-socket-wasm/dist/tls-socket-asmjs.js

.PHONY:
clean:
	make clean -C lib
