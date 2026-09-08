// Public entry point for the JAAG core: a dependency-free, DOM-free package
// that builds neutral jaag-superset documents and serializes them to AlphaFold
// 3, OpenDDE, Protenix, OpenFold 3, Chai-1, and Boltz input formats.

export {
    ADAPTERS,
    SCHEMA_NAME,
    SCHEMA_VERSION,
    TARGETS,
    fromAlphaFold3,
    serialize,
    validateSuperset
} from './jaag-schema.mjs';

export {
    MAX_COMPRESSED_BYTES,
    MAX_DECOMPRESSED_BYTES,
    decodeSharePayload,
    encodeSharePayload,
    fromBase64Url,
    inflateWithDecompressionStream,
    toBase64Url
} from './share-payload.mjs';

export {
    build,
    buildAlphaFold3Job,
    buildSuperset,
    parseSeeds
} from './builder.mjs';
