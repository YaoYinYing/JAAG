import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const generatorSource = readFileSync(new URL('../js/json-generator.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('loads JSON action prototypes before creating the browser app', () => {
    const context = vm.createContext({
        clearTimeout,
        console,
        document: { addEventListener() {} },
        setTimeout
    });
    context.window = context;

    vm.runInContext(appSource, context, { filename: 'js/app.js' });
    vm.runInContext(generatorSource, context, { filename: 'js/json-generator.js' });

    assert.equal(vm.runInContext('typeof AlphaFold3Generator.prototype.copyJSON', context), 'function');
    assert.equal(vm.runInContext('typeof AlphaFold3Generator.prototype.downloadJSON', context), 'function');
    assert.ok(indexSource.indexOf('js/app.js') < indexSource.indexOf('js/json-generator.js'));
});
