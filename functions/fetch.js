import { serialize, validateSuperset } from '../shared/jaag-schema.mjs';
import { decodeSharePayload, inflateWithDecompressionStream } from '../shared/share-payload.mjs';

function errorResponse(status, message) {
    return Response.json({ error: message }, {
        status,
        headers: { 'Cache-Control': 'private, no-store' }
    });
}

function filenameFor(document) {
    const fallback = `${document.target || 'jaag'}_input`;
    const safe = (document.job?.name || fallback).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    return `${safe || fallback}.json`;
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

    return new Response(`${JSON.stringify(result.data, null, 2)}\n`, {
        status: 200,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filenameFor(document)}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff'
        }
    });
}

export function onRequestGet(context) {
    return handleFetch(context.request);
}
