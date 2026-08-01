import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

import { handleFetch } from '../functions/fetch.js';
import { encodeSharePayload, decodeSharePayload, MAX_COMPRESSED_BYTES } from '../shared/share-payload.mjs';
import { fromAlphaFold3 } from '../shared/jaag-schema.mjs';

function documentFixture(target = 'opendde') {
    return fromAlphaFold3({
        name: 'curl example', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [{ protein: { id: 'A', sequence: 'ACDE' } }]
    }, { target });
}

const inflate = bytes => inflateSync(bytes);

test('pako-compatible deflate payload round-trips as base64url', async () => {
    const source = documentFixture('protenix');
    const payload = encodeSharePayload(source, deflateSync);
    assert.match(payload, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodeSharePayload(payload, inflate), source);
});

test('/fetch returns a downloadable target JSON document', async () => {
    const payload = encodeSharePayload(documentFixture(), deflateSync);
    const response = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.match(response.headers.get('content-disposition'), /attachment; filename="curl_example.json"/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const data = await response.json();
    assert.equal(data[0].sequences[0].proteinChain.sequence, 'ACDE');
});

test('/fetch rejects malformed and semantically invalid payloads without attachment headers', async () => {
    const malformed = await handleFetch(new Request('https://jaag.test/fetch?p=not-json'), inflate);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get('content-disposition'), null);

    const invalidDocument = documentFixture();
    invalidDocument.job.entities = [];
    const payload = encodeSharePayload(invalidDocument, deflateSync);
    const invalid = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);
    assert.equal(invalid.status, 422);
    assert.equal(invalid.headers.get('content-disposition'), null);
});

test('/fetch returns 422 instead of throwing for malformed collection shapes', async () => {
    const invalidDocument = documentFixture();
    invalidDocument.job.entities = { protein: 'not-an-array' };
    invalidDocument.job.bonds = 'not-an-array';
    invalidDocument.job.customComponents = [];
    const payload = encodeSharePayload(invalidDocument, deflateSync);

    const response = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);

    assert.equal(response.status, 422);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.match((await response.json()).error, /Entities must be an array; Bonds must be an array; Custom components must be an object/);

    const invalidNested = documentFixture();
    invalidNested.job.entities[0].modifications = [null];
    invalidNested.job.entities[0].templates = ['not-an-object'];
    const nestedPayload = encodeSharePayload(invalidNested, deflateSync);
    const nestedResponse = await handleFetch(new Request(`https://jaag.test/fetch?p=${nestedPayload}`), inflate);
    assert.equal(nestedResponse.status, 422);
    assert.match((await nestedResponse.json()).error, /modification 1 requires.*template 1 must be an object/);
});

test('/fetch rejects invalid templates and mixed MSA source modes', async () => {
    const invalidDocument = documentFixture('alphafold3');
    invalidDocument.job.entities[0].templates = [{}];
    invalidDocument.job.entities[0].msa = {
        unpaired: { source: 'path', value: '/data/unpaired.a3m' },
        paired: { source: 'inline', value: '>query\nACDE' }
    };
    const payload = encodeSharePayload(invalidDocument, deflateSync);

    const response = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);

    assert.equal(response.status, 422);
    assert.equal(response.headers.get('content-disposition'), null);
    const error = (await response.json()).error;
    assert.match(error, /template 1 requires mmcifPath or mmcif/);
    assert.match(error, /paired and unpaired MSA must use the same source type/);
});

test('/fetch rejects inherited target names and malformed CCD values', async () => {
    const inheritedTarget = documentFixture();
    inheritedTarget.target = 'constructor';
    const targetPayload = encodeSharePayload(inheritedTarget, deflateSync);
    const targetResponse = await handleFetch(new Request(`https://jaag.test/fetch?p=${targetPayload}`), inflate);
    assert.equal(targetResponse.status, 422);
    assert.match((await targetResponse.json()).error, /Unsupported target: constructor/);

    const invalidCCD = documentFixture('alphafold3');
    invalidCCD.job.entities.push({
        key: 'ligand', type: 'ligand', chainIds: ['L'], ligand: { source: 'ccd', ccdCodes: [null] }
    });
    const ccdPayload = encodeSharePayload(invalidCCD, deflateSync);
    const ccdResponse = await handleFetch(new Request(`https://jaag.test/fetch?p=${ccdPayload}`), inflate);
    assert.equal(ccdResponse.status, 422);
    assert.equal(ccdResponse.headers.get('content-disposition'), null);
    assert.match((await ccdResponse.json()).error, /CCD codes must be non-empty strings/);
});

test('/fetch rejects non-string ligand and modification values', async () => {
    for (const ligand of [
        { source: 'smiles', smiles: [] },
        { source: 'file', path: {} }
    ]) {
        const invalidDocument = documentFixture('opendde');
        invalidDocument.job.entities.push({ key: 'ligand', type: 'ligand', chainIds: ['L'], ligand });
        const payload = encodeSharePayload(invalidDocument, deflateSync);
        const response = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);
        assert.equal(response.status, 422);
        assert.equal(response.headers.get('content-disposition'), null);
    }

    const invalidModification = documentFixture('alphafold3');
    invalidModification.job.entities[0].modifications = [{ ccdCode: {}, position: 1 }];
    const payload = encodeSharePayload(invalidModification, deflateSync);
    const response = await handleFetch(new Request(`https://jaag.test/fetch?p=${payload}`), inflate);
    assert.equal(response.status, 422);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.match((await response.json()).error, /requires a CCD code and positive position/);
});

test('/fetch rejects missing and oversized payloads', async () => {
    assert.equal((await handleFetch(new Request('https://jaag.test/fetch'), inflate)).status, 400);
    const oversized = 'A'.repeat(Math.ceil(MAX_COMPRESSED_BYTES * 4 / 3) + 8);
    assert.equal((await handleFetch(new Request(`https://jaag.test/fetch?p=${oversized}`), inflate)).status, 413);
});
