import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('SugarDrawer messages require the exact frame, origin and bounded data', () => {
    const source = {};
    const context = { window: {}, location: { origin: 'https://jaag.example' },
        document: { getElementById: () => ({ contentWindow: source }) } };
    vm.runInNewContext(readFileSync(new URL('../js/sugardrawer-integration.js', import.meta.url), 'utf8'), context);
    const event = { origin: 'https://jaag.example', source, data: { type: 'SUGARDRAWER_ONE_CLICK_EXPORT', glycoct: 'RES\n1b:test', requestClose: true } };
    assert.equal(context.isTrustedSugarDrawerMessage(event, 'sugarDrawerPopupFrame'), true);
    assert.equal(context.isTrustedSugarDrawerMessage({ ...event, origin: 'https://jaag.example.attacker.test' }, 'sugarDrawerPopupFrame'), false);
    assert.equal(context.isTrustedSugarDrawerMessage({ ...event, origin: 'null' }, 'sugarDrawerPopupFrame'), false);
    assert.equal(context.isTrustedSugarDrawerMessage({ ...event, source: {} }, 'sugarDrawerPopupFrame'), false);
    assert.equal(context.isTrustedSugarDrawerMessage({ ...event, data: { ...event.data, glycoct: { malicious: true } } }, 'sugarDrawerPopupFrame'), false);
    assert.equal(context.isTrustedSugarDrawerMessage({ ...event, data: { ...event.data, glycoct: 'x'.repeat(2 * 1024 * 1024 + 1) } }, 'sugarDrawerPopupFrame'), false);
});
