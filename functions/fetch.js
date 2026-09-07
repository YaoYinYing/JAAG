import { serialize, TARGETS, validateSuperset } from '../shared/jaag-schema.mjs';
import { decodeSharePayload, inflateWithDecompressionStream } from '../shared/share-payload.mjs';

function errorResponse(status, message) {
    return Response.json({ error: message }, {
        status,
        headers: { 'Cache-Control': 'private, no-store' }
    });
}

const MIME_TYPES = {
    json: 'application/json; charset=utf-8',
    fasta: 'text/plain; charset=utf-8',
    yaml: 'text/yaml; charset=utf-8'
};

function filenameFor(document) {
    const fallback = `${document.target || 'jaag'}_input`;
    const safe = (document.job?.name || fallback).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    const extension = TARGETS[document.target]?.outputFormat || 'json';
    return `${safe || fallback}.${extension}`;
}

export async function handleFetch(request, inflate = inflateWithDecompressionStream) {
    if (request.method !== 'GET') return errorResponse(405, 'Method not allowed');
    const payload = new URL(request.url).searchParams.get('p');
    if (!payload) return errorResponse(400, 'Missing p query parameter');

    let document;
    try {
        document = await decodeSharePayload(payload, inflate);
    } catch (error) {
        const status = error instanceof RangeError ? 413 : 400;
        return errorResponse(status, error.message);
    }

    const validation = validateSuperset(document);
    if (!validation.valid) return errorResponse(422, validation.errors.join('; '));
    const result = serialize(document, document.target);
    if (result.errors.length > 0) return errorResponse(422, result.errors.join('; '));

    const format = TARGETS[document.target]?.outputFormat || 'json';
    const body = format === 'json'
        ? `${JSON.stringify(result.data, null, 2)}\n`
        : String(result.data);
    const mime = MIME_TYPES[format] || MIME_TYPES.json;

    return new Response(body, {
        status: 200,
        headers: {
            'Content-Type': mime,
            'Content-Disposition': `attachment; filename="${filenameFor(document)}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

export function onRequestGet(context) {
    return handleFetch(context.request);
}
