# TLS test fixtures

These certificates and encrypted PKCS#8 DER private keys are disposable test-only material.
The public passphrase is `surf-test-fixture`; none of these keys protects real systems. Tests
decode the DER with `crypto.createPrivateKey`, then export a transient in-memory buffer for
Node's TLS server. The decrypted buffer is never written, logged, or persisted.

The CA and leaves are valid from September 2026 through October 2108. `localhost-cert.pem`
has SANs `DNS:localhost`, `IP:127.0.0.1`, and `IP:::1`. `dnsonly-cert.pem` has only
`DNS:surf-tls.test`.

Maintainer-only regeneration (tests never invoke OpenSSL):

```sh
PASS=surf-test-fixture
TMP=$(mktemp -d)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -aes-256-cbc -pass pass:$PASS -out "$TMP/ca-key.pem"
openssl pkcs8 -topk8 -in "$TMP/ca-key.pem" -passin pass:$PASS -passout pass:$PASS \
  -outform DER -out ca-key.enc.der
openssl req -x509 -new -key ca-key.enc.der -keyform DER -passin pass:$PASS \
  -sha256 -days 30000 \
  -subj '/CN=Surf TLS Test CA' -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign' -out ca-cert.pem
# Generate each encrypted leaf key as PKCS#8 DER and its CSR, then sign it with the CA for
# 30000 days, applying the SANs documented above and serverAuth extended key usage.
rm -rf "$TMP"
```
