export const MAX_COMPRESSED_BYTES = 12 * 1024;
export const MAX_DECOMPRESSED_BYTES = 512 * 1024;

function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    if (typeof btoa === 'function') return btoa(binary);
    return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error('Payload is not valid base64url');
    }
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
    const binary = typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('binary');
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function toBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function fromBase64Url(value) {
    const bytes = base64ToBytes(value);
    if (bytes.byteLength > MAX_COMPRESSED_BYTES) throw new RangeError('Compressed payload is too large');
    return bytes;
}

export function encodeSharePayload(document, deflate) {
    const source = new TextEncoder().encode(JSON.stringify(document));
    if (source.byteLength > MAX_DECOMPRESSED_BYTES) throw new RangeError('Input document is too large to share');
    const compressed = Uint8Array.from(deflate(source));
    if (compressed.byteLength > MAX_COMPRESSED_BYTES) throw new RangeError('Compressed payload is too large for a URL');
    return toBase64Url(compressed);
}

export async function decodeSharePayload(value, inflate) {
    const compressed = fromBase64Url(value);
    const inflated = Uint8Array.from(await inflate(compressed));
    if (inflated.byteLength > MAX_DECOMPRESSED_BYTES) throw new RangeError('Decompressed payload is too large');
    let parsed;
    try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
    } catch {
        throw new Error('Payload does not contain valid UTF-8 JSON');
    }
    return parsed;
}

export async function inflateWithDecompressionStream(compressed) {
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_DECOMPRESSED_BYTES) {
            await reader.cancel('Decompressed payload is too large');
            throw new RangeError('Decompressed payload is too large');
        }
        chunks.push(value);
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return output;
}
