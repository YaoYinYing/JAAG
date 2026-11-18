import { test, expect } from '@playwright/test';

async function openBuilder(page, target) {
    await page.goto('/integration/input-builder/harness.html');
    await page.locator('#target').selectOption(target);
    await page.locator('#mount').click();
    await expect(page.locator('#status')).toHaveText('Workbench ready.', { timeout: 20000 });
    const editor = page.frameLocator('#builder iframe');
    await editor.locator("button[onclick=\"addSequence('protein')\"]").click();
    await editor.getByLabel('Protein Sequence*').fill('MNNSTAA');
    await editor.locator('#jobName').fill('Synthetic_Test');
    return editor;
}

for (const target of ['alphafold3', 'opendde', 'bioemu2']) {
    test(`${target}: bind, clone, edit, and preserve an independent upload`, async ({ page }) => {
        const editor = await openBuilder(page, target);
        await page.locator('#generate').click();
        await expect(page.locator('#ownership')).toContainText('builder');
        const original = await page.locator('#output').textContent();
        expect(original).toContain('MNNSTAA');
        await page.locator('#clone').click();
        await expect(page.locator('#status')).toContainText('Clone restored');
        await expect(page.locator('#ownership')).toContainText('empty');
        await page.locator('#generate').click();
        await expect(page.locator('#ownership')).toContainText('builder');
        expect(await page.locator('#output').textContent()).toBe(original);
        await editor.getByLabel('Protein Sequence*').fill('MNNSTAAA');
        await expect(page.locator('#ownership')).toContainText('empty');
        await page.locator('#external').setInputFiles({ name: 'external.txt', mimeType: 'text/plain', buffer: Buffer.from('independent') });
        await editor.getByLabel('Protein Sequence*').fill('MNNSTAAAA');
        await expect(page.locator('#ownership')).toContainText('external');
        await page.locator('#generate').click();
        await expect(page.locator('#status')).toContainText('Clear the independent upload');
        await expect(page.locator('#ownership')).toContainText('external');
    });
}

test('file dependencies survive a clone without retaining private paths', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator('#seq_1_advancedToggle').click();
    await editor.locator('[data-bs-target="#seq_1_msaCollapse"]').click();
    await editor.locator('#seq_1_msaTypePath').check();
    await editor.locator('#seq_1_unpairedMsaPath').fill('/private/msa.a3m');
    await page.locator('#slots').click();
    await expect(page.locator('#attachments input')).toHaveCount(1);
    await page.locator('#attachments input').setInputFiles({ name: 'msa.a3m', mimeType: 'text/plain', buffer: Buffer.from('>query\nMNNSTAA\n') });
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const output = await page.locator('#output').textContent();
    expect(output).toContain('dependencies/dep-');
    expect(output).not.toContain('/private/');
    await page.locator('#clone').click();
    await expect(page.locator('#status')).toContainText('Clone restored');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toBe(output);
});

test('bad snapshots fail without replacing a live editor and destroy removes it', async ({ page }) => {
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const frame = holder.querySelector('iframe');
        const w = frame.contentWindow;
        w.addSequence('protein');
        const input = w.document.getElementById('seq_1_sequence'); input.value = 'MNNSTAA'; input.dispatchEvent(new Event('input', { bubbles: true }));
        const before = await builder.materialize();
        const bad = structuredClone(before.snapshot); bad.builderVersion = 999;
        let rejected = false;
        try { await builder.restore(bad); } catch { rejected = true; }
        const hostile = structuredClone(before.snapshot); hostile.document.job.entities[0].chainIds[0] = '\"><img src=x onerror=alert(1)>';
        let hostileRejected = false;
        try { await builder.restore(hostile); } catch { hostileRejected = true; }
        const unchanged = holder.querySelector('iframe') === frame && w.document.getElementById('seq_1_sequence').value === 'MNNSTAA';
        builder.destroy();
        let closed = false;
        try { await builder.validate(); } catch { closed = true; }
        return { rejected, hostileRejected, unchanged, closed, frames: holder.querySelectorAll('iframe').length };
    });
    expect(result).toEqual({ rejected: true, hostileRejected: true, unchanged: true, closed: true, frames: 0 });
});

test('restore rejects mismatched files and an edit made while it waits; destroy cancels pending work', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const frame = holder.querySelector('iframe'); const w = frame.contentWindow;
        w.addSequence('protein');
        for (const [id, value] of [['seq_1_sequence', 'MNNSTAA'], ['seq_1_unpairedMsaPath', '/private/input.a3m']]) {
            const field = w.document.getElementById(id); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const radio = w.document.getElementById('seq_1_msaTypePath'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
        const first = await builder.materialize(() => ({ name: 'msa.a3m', bytes: new TextEncoder().encode('original') }));
        let mismatch = false;
        try { await builder.restore(first.snapshot, () => new TextEncoder().encode('wrong')); } catch { mismatch = true; }
        const intactAfterMismatch = holder.querySelector('iframe') === frame;
        let entered, release;
        const started = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const pending = builder.restore(first.snapshot, async () => { entered(); await gate; return first.dependencies[0].bytes; }).then(() => false, () => true);
        await started;
        const sequence = w.document.getElementById('seq_1_sequence'); sequence.value = 'MNNSTAAA'; sequence.dispatchEvent(new Event('input', { bubbles: true }));
        release();
        const rejectedEdit = await pending;
        const editPreserved = holder.querySelector('iframe') === frame && sequence.value === 'MNNSTAAA';
        let startedAgain, observedSignal;
        const waiting = new Promise(resolve => { startedAgain = resolve; });
        const cancelled = builder.restore(first.snapshot, (_slot, { signal }) => { observedSignal = signal; startedAgain(); return new Promise(() => {}); }).then(() => false, () => true);
        await waiting;
        builder.destroy();
        const cancelledPromptly = await Promise.race([cancelled, new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
        return { mismatch, intactAfterMismatch, rejectedEdit, editPreserved, cancelledPromptly, signalAborted: observedSignal.aborted, frames: holder.querySelectorAll('iframe').length };
    });
    expect(result).toEqual({ mismatch: true, intactAfterMismatch: true, rejectedEdit: true, editPreserved: true, cancelledPromptly: true, signalAborted: true, frames: 0 });
});

test('a synthetic glycosylation site round trips with identical output', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    const frame = page.frameLocator('#builder iframe');
    await frame.locator("button[onclick=\"addGlycosylationSite('seq_1')\"]").click();
    const site = frame.locator('#seq_1_glycosylationSites .card').first();
    await site.locator('input[id$="_position"]').fill('2');
    await expect.poll(() => page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager?.templates?.length || 0)).toBeGreaterThan(0);
    const glyco = await page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager.templates[0].glycoct);
    await site.locator('textarea[id$="_glycan"]').fill(glyco);
    await editor.locator('button[onclick="addBondedAtomPair()"]').click();
    for (const [id, value] of Object.entries({ '#bond_1_chain1': 'A', '#bond_1_res1': '1', '#bond_1_atom1': 'CA', '#bond_1_chain2': 'GLYCANA', '#bond_1_res2': '1', '#bond_1_atom2': 'C2' })) {
        await editor.locator(id).fill(value);
    }
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const before = await page.locator('#output').textContent();
    expect(before).toContain('bondedAtomPairs');
    await page.locator('#clone').click();
    await expect(page.locator('#status')).toContainText('Clone restored');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toBe(before);
    await expect(editor.locator('#seq_1_glycosylationSites .card textarea[id$="_glycan"]')).toHaveValue(glyco);
    await expect(editor.locator('#bond_1_chain2')).toHaveValue('GLYCANA');
});

for (const kind of ['inline', 'path']) {
    test(`custom CCD ${kind} authoring survives clone`, async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/integration/input-builder/harness.html');
        const result = await page.evaluate(async kind => {
            const { mount } = await import('/integration/input-builder/index.mjs');
            const holder = document.createElement('div'); document.body.append(holder);
            const builder = await mount(holder, { target: 'alphafold3' });
            const w = holder.querySelector('iframe').contentWindow;
            const set = (id, value) => { const input = w.document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
            w.addSequence('ligand'); set('seq_1_ligandType', 'ccd'); w.toggleLigandInputs('seq_1'); set('seq_1_ccdCodes', 'ABC-2');
            set('userCCDId', 'ABC-2');
            if (kind === 'inline') { w.document.getElementById('inlineUserCCD').checked = true; set('userCCDInput', 'data_ABC-2\n_chem_comp.id ABC-2'); }
            else set('userCCDPath', '/private/ccd.cif');
            w.addUserCCDToJSON();
            const supplied = () => ({ name: 'ccd.cif', mime: 'text/plain', bytes: new TextEncoder().encode('data_ABC-2') });
            const first = await builder.materialize(supplied);
            const files = new Map(first.dependencies.map(file => [file.id, file]));
            await builder.restore(first.snapshot, item => files.get(item.id)?.bytes);
            const restored = await builder.materialize(item => files.get(item.id));
            const child = holder.querySelector('iframe').contentWindow;
            const visible = child.document.getElementById('activeUserCCDsList').textContent.includes('ABC-2');
            const result = { same: first.output.sha256 === restored.output.sha256, visible,
                dependencies: restored.dependencies.length, leaked: JSON.stringify(restored.snapshot).includes('/private/') };
            builder.destroy(); return result;
        }, kind);
        expect(result).toEqual({ same: true, visible: true, dependencies: kind === 'path' ? 1 : 0, leaked: false });
    });
}

test('multiple instances are isolated and cross-origin editor URLs are rejected', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const left = document.createElement('div'); const right = document.createElement('div'); document.body.append(left, right);
        let crossOriginRejected = false;
        try { await mount(left, { target: 'alphafold3', editorURL: 'https://example.com/index.html' }); } catch { crossOriginRejected = true; }
        const first = await mount(left, { target: 'alphafold3' });
        const second = await mount(right, { target: 'bioemu2' });
        left.querySelector('iframe').contentWindow.addSequence('protein');
        const isolated = right.querySelector('iframe').contentWindow.app.sequences.length === 0;
        first.destroy();
        const stillReady = right.querySelectorAll('iframe').length === 1;
        second.destroy();
        return { crossOriginRejected, isolated, stillReady };
    });
    expect(result).toEqual({ crossOriginRejected: true, isolated: true, stillReady: true });
});

test('standalone YAML import uses local assets without third-party requests', async ({ page }) => {
    const external = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    await page.goto('/index.html');
    await page.locator('#restoreInputTarget').selectOption('boltz');
    await page.locator('#restoreInputFile').setInputFiles({ name: 'synthetic.yaml', mimeType: 'text/yaml', buffer: Buffer.from('version: 1\nsequences:\n  - protein:\n      id: A\n      sequence: MNNSTAA\n') });
    await expect(page.locator('#seq_1_sequence')).toHaveValue('MNNSTAA');
    await expect(page.locator('#outputTarget')).toHaveValue('boltz');
    expect(external).toEqual([]);
});

test('SugarDrawer popup accepts its own frame and rejects a forged sender', async ({ page }) => {
    test.setTimeout(60000);
    const external = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.getByRole('button', { name: 'Open SugarDrawer to draw glycan structure' }).click();
    await expect(editor.locator('#sugarDrawerPopupFrame')).toBeVisible();
    await expect.poll(() => page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager?.templates?.length || 0)).toBeGreaterThan(0);
    const glyco = await page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager.templates[0].glycoct);
    await editor.locator('body').evaluate((_, text) => window.postMessage({ type: 'SUGARDRAWER_ONE_CLICK_EXPORT', glycoct: text }, location.origin), glyco);
    await page.waitForTimeout(200);
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue('');
    const drawer = editor.frameLocator('#sugarDrawerPopupFrame');
    await drawer.locator('body').evaluate((_, text) => window.parent.postMessage({ type: 'SUGARDRAWER_ONE_CLICK_EXPORT', glycoct: text, requestClose: true }, location.origin), glyco);
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue(glyco);
    expect(external).toEqual([]);
});

test('glycan and automatic CCD cleanup preserve unrelated authored inputs', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    const result = await editor.locator('body').evaluate(() => {
        const w = window;
        w.app.sequences.push({ id: 'other-ligand', type: 'ligand' }, { id: 'tracked-glycan', type: 'ligand' });
        w.activeGlycans = [{ sequenceId: 'tracked-glycan', chainId: 'GLYCANA', ccdCodes: [] }];
        w.app.userCCDs = {
            MANUAL: { userCCD: 'manual' },
            AUTO: { userCCD: 'automatic', source: 'automatic-ligand' }
        };
        w.app.glycanUserCCDs = {};
        w.activeUserCCDs = [{ componentId: 'MANUAL', method: 'inline' }];
        w.confirm = () => true;
        w.clearAllGlycans();
        return {
            remaining: w.app.sequences.map(sequence => sequence.id),
            ccds: Object.keys(w.app.userCCDs)
        };
    });
    expect(result.remaining).toContain('other-ligand');
    expect(result.remaining).not.toContain('tracked-glycan');
    expect(result.ccds).toContain('MANUAL');
    expect(result.ccds).not.toContain('AUTO');
});
