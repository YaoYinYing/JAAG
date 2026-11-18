import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function appClass(document) {
    const context = { document, window: {}, setTimeout() {}, clearTimeout() {}, console };
    vm.runInNewContext(`${readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')}\nthis.Generator = AlphaFold3Generator;`, context);
    return context.Generator;
}

test('notification messages are rendered as text', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const text = {};
    const close = { addEventListener() {} };
    const toast = {
        style: {}, innerHTML: '',
        querySelector(selector) { return selector === '.flex-grow-1' ? text : close; }
    };
    const container = { appendChild(node) { assert.equal(node, toast); } };
    const document = {
        addEventListener() {},
        getElementById(id) { return id === 'toast-container' ? container : null; },
        createElement() { return toast; }
    };
    const Generator = appClass(document);
    const app = Object.create(Generator.prototype);
    app.showToast(payload, 'danger');
    assert.equal(text.textContent, payload);
    assert.ok(!toast.innerHTML.includes(payload));
});

test('debug entries keep message text out of markup', () => {
    const payload = '<svg onload=alert(1)>';
    const entries = [];
    const log = { children: [], appendChild(node) { entries.push(node); }, scrollHeight: 0 };
    const document = {
        addEventListener() {},
        getElementById(id) { return id === 'debugLog' ? log : null; },
        createElement() {
            return { style: {}, children: [], append(...nodes) { this.children.push(...nodes); } };
        }
    };
    const Generator = appClass(document);
    Object.create(Generator.prototype).addToDebugLog('ERROR', payload);
    assert.equal(entries[0].children[1].textContent, payload);
    assert.equal(entries[0].innerHTML, undefined);
});

test('lookup refuses a stale or non-AlphaFold preview before any request', async () => {
    let requests = 0;
    const messages = [];
    const document = { getElementById() { return null; } };
    const window = { app: { lastValidation: null, lastOutputTarget: 'alphafold3', showToast: message => messages.push(message) } };
    const context = { window, document, fetch() { requests++; }, console };
    vm.runInNewContext(readFileSync(new URL('../js/glycan-enrichment.js', import.meta.url), 'utf8'), context);
    await window.enrichGlycanData();
    window.app.lastValidation = { valid: true };
    window.app.lastOutputTarget = 'opendde';
    await window.enrichGlycanData();
    assert.equal(requests, 0);
    assert.equal(messages.length, 2);
    assert.match(messages[0], /valid, up-to-date AlphaFold 3 preview/);
});
