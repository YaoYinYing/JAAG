import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('refreshing glycan templates preserves the editor and renders names as text', () => {
    const select = {
        value: 'existing',
        options: [],
        replaceChildren(...options) { this.options = options; }
    };
    const container = { id: 'seq_1_templateSelector', glycoct: 'RES\n1b:test' };
    const document = {
        addEventListener() {},
        querySelectorAll(selector) {
            assert.equal(selector, '[id$="_templateSelector"]');
            return [container];
        },
        getElementById(id) {
            assert.equal(id, 'seq_1_templateSelector_select');
            return select;
        },
        createElement(tag) {
            assert.equal(tag, 'option');
            return { value: '', textContent: '' };
        }
    };
    const window = {};
    vm.runInNewContext(readFileSync(new URL('../js/glycan-templates.js', import.meta.url), 'utf8'), { window, document });
    window.loadGlycanTemplateData([
        { name: 'existing', glycoct: 'RES' },
        { name: '<img src=x onerror=alert(1)>', glycoct: 'RES' }
    ]);
    assert.equal(select.value, 'existing');
    assert.equal(select.options[2].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(container.glycoct, 'RES\n1b:test');
});
