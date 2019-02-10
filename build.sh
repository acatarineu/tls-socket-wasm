#!/bin/bash

set -e
set -x

SCRIPTPATH="$( cd "$(dirname "$0")" ; pwd -P )"
LIBFOLDER="$SCRIPTPATH/lib"
DISTFOLDER="$SCRIPTPATH/dist"

if [ -z "$EMSCRIPTEN" ]
then
  EMSCRIPTEN_PATH=${EMSCRIPTEN_PATH:-~/emsdk}

  if [ ! -f "$EMSCRIPTEN_PATH/emsdk_env.sh" ]; then
      echo "emscripten installation not found" ;
      exit 1 ;
  fi

  . "$EMSCRIPTEN_PATH/emsdk_env.sh"
fi

make -C lib

if [ -z "$BUILD_TYPE" ]
then
 . ./config.release
fi

name_0="wasm"
flags_0="-s TOTAL_MEMORY=16MB -s TOTAL_STACK=5MB -s WASM=1 -s EXPORT_NAME='ModuleWasm'"
name_1="asmjs"
flags_1="-s WASM=0 -s EXPORT_NAME='ModuleAsmjs'"

rm -rf $DISTFOLDER;

for emidx in 0 1
do
EMNAME="name_$emidx"
EMNAME=${!EMNAME}
EMFLAGS="flags_$emidx"
EMFLAGS=${!EMFLAGS}

( mkdir -p $DISTFOLDER && \
  emcc ${EMFLAGS} \
    --pre-js $SCRIPTPATH/src/api_pre.js \
    --post-js $SCRIPTPATH/src/api_post.js \
    -I$LIBFOLDER/inc \
    -s SINGLE_FILE=1 \
    -s MODULARIZE=1 \
    -s NO_EXIT_RUNTIME=1 \
    -s ASSERTIONS=$EMCC_ASSERTIONS \
    $EMCC_FLAGS \
    -std=c11 -Wall -Wextra -Wno-strict-prototypes -Wunused-value -Wcast-align \
    -Wunused-variable -Wundef -Wformat-security -Wshadow \
    -o "$DISTFOLDER/tls-socket-$EMNAME.js" \
    $SCRIPTPATH/src/extra_api.c \
    $LIBFOLDER/tools/errors.c \
    $LIBFOLDER/build/libbearssl.a \
    -s EXPORTED_FUNCTIONS="[\
       '_get_br_ssl_client_context_size', \
       '_get_br_x509_minimal_context_size', \
       '_get_iobuf_size', \
       '_get_BR_SSL_CLOSED', \
       '_get_BR_ERR_OK', \
       '_get_BR_SSL_SENDREC', \
       '_get_BR_SSL_RECVREC', \
       '_get_BR_SSL_RECVAPP', \
       '_get_BR_SSL_SENDAPP', \
       '_get_br_ssl_engine_context', \
       '_init_client', \
       '_br_ssl_engine_current_state', \
       '_br_ssl_engine_last_error', \
       '_br_ssl_engine_recvapp_buf', \
       '_br_ssl_engine_recvapp_ack', \
       '_br_ssl_engine_sendrec_buf', \
       '_br_ssl_engine_sendrec_ack', \
       '_br_ssl_engine_recvrec_buf', \
       '_br_ssl_engine_recvrec_ack', \
       '_br_ssl_engine_sendapp_buf', \
       '_br_ssl_engine_sendapp_ack', \
       '_br_ssl_engine_init_rand', \
       '_br_ssl_engine_flush', \
       '_find_error_name']")
done
