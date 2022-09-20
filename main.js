import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
const MANIFEST_FILE = 'MANIFEST.txt';
export async function sign(signatureType, rootUrls) {
    const distContentDir = path.resolve('dist');
    try {
        console.log('Building manifest...');
        const manifest = await buildManifest(distContentDir);
        console.log('Signing manifest...');
        if (signatureType) {
            manifest.signatureType = signatureType;
        }
        if (rootUrls) {
            manifest.rootUrls = rootUrls;
        }
        manifest.toolkit = {
            version: "eccentric"
        };
        const signedManifest = await signManifest(manifest);
        console.log('Saving signed manifest...');
        await saveManifest(distContentDir, signedManifest);
        console.log('Signed successfully');
    } catch (err) {
        console.warn(err);
    }
}
async function* walk(dir, baseDir) {
    for await (const d of (await fs.promises.opendir(dir))){
        const entry = path.posix.join(dir, d.name);
        if (d.isDirectory()) {
            yield* walk(entry, baseDir);
        } else if (d.isFile()) {
            yield path.posix.relative(baseDir, entry);
        } else if (d.isSymbolicLink()) {
            const realPath = await fs.promises.realpath(entry);
            if (!realPath.startsWith(baseDir)) {
                throw new Error(`symbolic link ${path.posix.relative(baseDir, entry)} targets a file outside of the base directory: ${baseDir}`);
            }
            // if resolved symlink target is a file include it in the manifest
            const stats = await fs.promises.stat(realPath);
            if (stats.isFile()) {
                yield path.posix.relative(baseDir, entry);
            }
        }
    }
}
async function buildManifest(dir) {
    const pluginJson = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), {
        encoding: 'utf8'
    }));
    const manifest = {
        plugin: pluginJson.id,
        version: pluginJson.info.version,
        files: {}
    };
    for await (const p of walk(dir, dir)){
        if (p === MANIFEST_FILE) {
            continue;
        }
        manifest.files[p] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, p))).digest('hex');
    }
    return manifest;
}
async function signManifest(manifest) {
    const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;
    if (!GRAFANA_API_KEY) {
        throw new Error('You must enter a GRAFANA_API_KEY to sign the plugin manifest');
    }
    const url = 'https://grafana.com/api/plugins/ci/sign';
    try {
        const fetch = (await import("node-fetch")).default;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + GRAFANA_API_KEY
            },
            body: JSON.stringify(manifest)
        });
        if (response.status !== 200) {
            console.warn('Error: ', response);
            throw new Error('Error signing manifest');
        }
        return await response.text();
    } catch (err) {
        if (err.response?.data?.message) {
            throw new Error('Error signing manifest: ' + err.response.data.message);
        }
        throw new Error('Error signing manifest: ' + err.message);
    }
}
async function saveManifest(dir, signedManifest) {
    fs.writeFileSync(path.join(dir, MANIFEST_FILE), signedManifest);
    return true;
}


//# sourceMappingURL=main.js.map