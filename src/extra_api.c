#include "bearssl.h"
#include "tas.h"

int get_br_ssl_client_context_size() {
    return sizeof(br_ssl_client_context);
}

int get_br_x509_minimal_context_size() {
    return sizeof(br_x509_minimal_context);
}

int get_iobuf_size() {
    return BR_SSL_BUFSIZE_BIDI;
}

int get_BR_SSL_CLOSED() {
    return BR_SSL_CLOSED;
}

int get_BR_ERR_OK() {
    return BR_ERR_OK;
}

int get_BR_SSL_SENDREC() {
    return BR_SSL_SENDREC;
}

int get_BR_SSL_RECVREC() {
    return BR_SSL_RECVREC;
}

int get_BR_SSL_SENDAPP() {
    return BR_SSL_SENDAPP;
}

int get_BR_SSL_RECVAPP() {
    return BR_SSL_RECVAPP;
}

void* get_br_ssl_engine_context(br_ssl_client_context* sc) {
    return &sc->eng;
}

int init_client(br_ssl_client_context* sc, br_x509_minimal_context* xc, unsigned char* iobuf, const char *host) {
    /*
	 * Initialise the client context:
	 * -- Use the "full" profile (all supported algorithms).
	 * -- The provided X.509 validation engine is initialised, with
	 *    the hardcoded trust anchor.
	 */
	br_ssl_client_init_full(sc, xc, TAs, TAs_NUM);

    /*
	 * Set the I/O buffer to the provided array. We allocated a
	 * buffer large enough for full-duplex behaviour with all
	 * allowed sizes of SSL records, hence we set the last argument
	 * to 1 (which means "split the buffer into separate input and
	 * output areas").
	 */
	br_ssl_engine_set_buffer(&sc->eng, iobuf, BR_SSL_BUFSIZE_BIDI, 1);

    /*
	 * Reset the client context, for a new handshake. We provide the
	 * target host name: it will be used for the SNI extension. The
	 * last parameter is 0: we are not trying to resume a session.
	 */
	return br_ssl_client_reset(sc, host, 0);
}
