// Copy pinned, licensed browser assets for static deployments.
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = [
    ['bootstrap/dist/css/bootstrap.min.css', 'bootstrap/bootstrap.min.css'],
    ['bootstrap/dist/js/bootstrap.bundle.min.js', 'bootstrap/bootstrap.bundle.min.js'],
    ['bootstrap/LICENSE', 'bootstrap/LICENSE'],
    ['pako/dist/pako.min.js', 'pako/pako.min.js'],
    ['pako/LICENSE', 'pako/LICENSE'],
    ['js-yaml/dist/browser/js-yaml.esm.min.mjs', 'js-yaml/js-yaml.esm.min.mjs'],
    ['js-yaml/LICENSE', 'js-yaml/LICENSE'],
    ['d3/d3.min.js', 'd3/d3.min.js'],
    ['d3/LICENSE', 'd3/LICENSE'],
    ['semantic-ui-css/LICENSE', 'semantic/LICENSE'],
    ['@fortawesome/fontawesome-free/css/all.min.css', 'fontawesome/css/all.min.css'],
    ['@fortawesome/fontawesome-free/LICENSE.txt', 'fontawesome/LICENSE.txt'],
    ...['fa-brands-400', 'fa-regular-400', 'fa-solid-900', 'fa-v4compatibility'].flatMap(name =>
        ['woff2', 'ttf'].map(ext => [`@fortawesome/fontawesome-free/webfonts/${name}.${ext}`, `fontawesome/webfonts/${name}.${ext}`]))
];
for (const [source, destination] of assets) {
    const target = resolve(root, 'vendor', destination);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(root, 'node_modules', source), target);
}
const semanticSource = await readFile(resolve(root, 'node_modules/semantic-ui-css/semantic.min.css'), 'utf8');
const remoteFont = '@import url(https://fonts.googleapis.com/css?family=Lato:400,700,400italic,700italic&subset=latin);';
if (!semanticSource.includes(remoteFont)) throw new Error('Unexpected Semantic UI stylesheet; review its external resources');
await writeFile(resolve(root, 'vendor/semantic/semantic.min.css'), semanticSource.replace(remoteFont, '/* BioNuTA: removed external Lato font import; local fallback fonts are used. */'));
await cp(resolve(root, 'node_modules/semantic-ui-css/themes/default/assets'), resolve(root, 'vendor/semantic/themes/default/assets'), { recursive: true });
console.log(`Copied ${assets.length} pinned frontend assets and Semantic UI assets to vendor/`);
