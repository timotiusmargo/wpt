// Tests for wrapKey and unwrapKey round tripping

function run_test() {
    var subtle = self.crypto.subtle;

    var wrappers = [];  // Things we wrap (and upwrap) keys with
    var keys = [];      // Things to wrap and unwrap

    // Generate all the keys needed, then iterate over all combinations
    // to test wrapping and unwrapping.
    Promise.all([generateWrappingKeys(), generateKeysToWrap()])
    .then(function(results) {
        wrappers.forEach(function(wrapper) {
            keys.forEach(function(key) {
                testWrapping(wrapper, key);
            })
        });
    }, function(err) {
        promise_test(function(test) {
            assert_unreached("A key failed to generate: " + err.name + ": " + err.message)
        }, "Could not run all tests")
    })
    .then(function() {
        done();
    }, function(error) {
        promise_test(function(test) {
            assert_unreached("A test failed to run: " + err.name + ": " + err.message)
        }, "Could not run all tests")
    });


    function generateWrappingKeys() {
        // There are five algorithms that can be used for wrapKey/unwrapKey.
        // Generate one key with typical parameters for each kind.
        //
        // Note: we don't need cryptographically strong parameters for things
        // like IV - just any legal value will do.
        var parameters = [
            {
                name: "RSA-OAEP",
                generateParameters: {name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256"},
                wrapParameters: {name: "RSA-OAEP", label: new Uint8Array(8)}
            },
            {
                name: "AES-CTR",
                generateParameters: {name: "AES-CTR", length: 128},
                wrapParameters: {name: "AES-CTR", counter: new Uint8Array(16), length: 64}
            },
            {
                name: "AES-CBC",
                generateParameters: {name: "AES-CBC", length: 128},
                wrapParameters: {name: "AES-CBC", iv: new Uint8Array(16)}
            },
            {
                name: "AES-GCM",
                generateParameters: {name: "AES-GCM", length: 128},
                wrapParameters: {name: "AES-GCM", iv: new Uint8Array(16), additionalData: new Uint8Array(16), tagLength: 64}
            },
            {
                name: "AES-KW",
                generateParameters: {name: "AES-KW", length: 128},
                wrapParameters: {name: "AES-KW"}
            }
        ];

        return Promise.all(parameters.map(function(params) {
            return subtle.generateKey(params.generateParameters, true, ["wrapKey", "unwrapKey"])
            .then(function(key) {
                var wrapper;
                if (params.name === "RSA-OAEP") { // we have a key pair, not just a key
                    wrapper = {wrappingKey: key.publicKey, unwrappingKey: key.privateKey, parameters: params};
                } else {
                    wrapper = {wrappingKey: key, unwrappingKey: key, parameters: params};
                }
                wrappers.push(wrapper);
                return true;
            })
        }));
    }


    function generateKeysToWrap() {
        var parameters = [
            {algorithm: {name: "RSASSA-PKCS1-v1_5", modulusLength: 1024, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256"}, privateUsages: ["sign"], publicUsages: ["verify"]},
            {algorithm: {name: "RSA-PSS", modulusLength: 1024, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256"}, privateUsages: ["sign"], publicUsages: ["verify"]},
            {algorithm: {name: "RSA-OAEP", modulusLength: 1024, publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256"}, privateUsages: ["decrypt"], publicUsages: ["encrypt"]},
            {algorithm: {name: "ECDSA", namedCurve: "P-256"}, privateUsages: ["sign"], publicUsages: ["verify"]},
            {algorithm: {name: "ECDH", namedCurve: "P-256"}, privateUsages: ["deriveBits"], publicUsages: []},
            {algorithm: {name: "AES-CTR", length: 128}, usages: ["encrypt", "decrypt"]},
            {algorithm: {name: "AES-CBC", length: 128}, usages: ["encrypt", "decrypt"]},
            {algorithm: {name: "AES-GCM", length: 128}, usages: ["encrypt", "decrypt"]},
            {algorithm: {name: "AES-KW", length: 128}, usages: ["wrapKey", "unwrapKey"]},
            {algorithm: {name: "HMAC", length: 128, hash: "SHA-256"}, usages: ["sign", "verify"]}
        ];

        return Promise.all(parameters.map(function(params) {
            var usages;
            if ("usages" in params) {
                usages = params.usages;
            } else {
                usages = params.publicUsages.concat(params.privateUsages);
            }

            return subtle.generateKey(params.algorithm, true, usages)
            .then(function(result) {
                if (result.constructor === CryptoKey) {
                    keys.push({name: params.algorithm.name, algorithm: params.algorithm, usages: params.usages, key: result});
                } else {
                    keys.push({name: params.algorithm.name + " public key", algorithm: params.algorithm, usages: params.publicUsages, key: result.publicKey});
                    keys.push({name: params.algorithm.name + " private key", algorithm: params.algorithm, usages: params.privateUsages, key: result.privateKey});
                }
                return true;
            });
        }));
    }


    // Can we successfully "round-trip" (wrap, then unwrap, a key)?
    function testWrapping(wrapper, toWrap) {
        var formats;

        if (toWrap.name.includes("private")) {
            formats = ["pkcs8", "jwk"];
        } else if (toWrap.name.includes("public")) {
            formats = ["spki", "jwk"]
        } else {
            formats = ["raw", "jwk"]
        }

        formats.forEach(function(fmt) {
            var originalExport;

            promise_test(function(test) {
                return subtle.exportKey(fmt, toWrap.key)
                .then(function(exportedKey) {
                    originalExport = exportedKey;
                    return exportedKey;
                }).then(function(exportedKey) {
                    return subtle.wrapKey(fmt, toWrap.key, wrapper.wrappingKey, wrapper.parameters.wrapParameters);
                }).then(function(wrappedResult) {
                    return subtle.unwrapKey(fmt, wrappedResult, wrapper.unwrappingKey, wrapper.parameters.wrapParameters, toWrap.algorithm, true, toWrap.usages)
                }).then(function(unwrappedResult) {
                    return subtle.exportKey(fmt, unwrappedResult)
                }).then(function(roundTripExport) {
                    assert_true(true, "Got to the end, anyway");
                }).catch(function(err) {
                    if (wrappingIsPossible(originalExport, wrapper.parameters.name)) {
                        assert_unreached("Round trip threw an error - " + err.name + ': "' + err.message + '"');
                    } else {
                        assert_true(true, "Skipped test due to key length restrictions");
                    }
                })
            }, "Can wrap and unwrap " + toWrap.name + " keys using " + fmt + " and " + wrapper.parameters.name);

        });

    }


    // RSA-OAEP can only wrap relatively small payloads. AES-KW can only
    // wrap payloads a multiple of 8 bytes long.
    //
    // Note that JWK payloads will be converted to ArrayBuffer for wrapping,
    // and should automatically be padded if needed for AES-KW.
    function wrappingIsPossible(exportedKey, algorithmName) {
        if ("byteLength" in exportedKey && algorithmName === "AES-KW") {
            return exportedKey.byteLength % 8 === 0;
        }

        if ("byteLength" in exportedKey && algorithmName === "RSA-OAEP") {
            return exportedKey.byteLength <= 478;
        }

        if ("kty" in exportedKey && algorithmName === "RSA-OAEP") {
            return JSON.stringify(exportedKey).length <= 478;
        }

        return true;
    }
}
