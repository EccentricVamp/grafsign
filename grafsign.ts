import crypto from 'crypto';
import fs from 'fs/promises';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const MANIFEST_FILE = 'MANIFEST.txt';

interface ManifestInfo {
  // time: number;  << filled in by the server
  // keyId: string; << filled in by the server
  // signedByOrg: string; << filled in by the server
  // signedByOrgName: string; << filled in by the server
  signatureType?: string; // filled in by the server if not specified
  rootUrls?: string[]; // for private signatures
  plugin: string;
  version: string;
  files: Record<string, string>;
  signPlugin?: {
    version: string;
  };
}

export async function sign(signatureType?: string, rootUrls?: string[]) {
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

    manifest.signPlugin = { version: "eccentric" };
    const signedManifest = await signManifest(manifest);

    console.log('Saving signed manifest...');
    await saveManifest(distContentDir, signedManifest);

    console.log('Signed successfully');
  } catch (err) {
    console.warn(err);
  }
};

type RecursiveWalk = AsyncGenerator<string, void | RecursiveWalk>;

async function* walk(dir: string, baseDir: string): RecursiveWalk {
  for await (const d of await fs.opendir(dir)) {
    const entry = path.posix.join(dir, d.name);
    if (d.isDirectory()) {
      yield* walk(entry, baseDir);
    } else if (d.isFile()) {
      yield path.posix.relative(baseDir, entry);
    } else if (d.isSymbolicLink()) {
      const realPath = await fs.realpath(entry);
      if (!realPath.startsWith(baseDir)) {
        throw new Error(
          `symbolic link ${path.posix.relative(
            baseDir,
            entry
          )} targets a file outside of the base directory: ${baseDir}`
        );
      }
      // if resolved symlink target is a file include it in the manifest
      const stats = await fs.stat(realPath);
      if (stats.isFile()) {
        yield path.posix.relative(baseDir, entry);
      }
    }
  }
}

async function buildManifest(dir: string): Promise<ManifestInfo> {
  const pluginJson = JSON.parse(readFileSync(path.join(dir, 'plugin.json'), { encoding: 'utf8' }));

  const manifest = {
    plugin: pluginJson.id,
    version: pluginJson.info.version,
    files: {},
  } as ManifestInfo;

  for await (const p of walk(dir, dir)) {
    if (p === MANIFEST_FILE) {
      continue;
    }

    manifest.files[p] = crypto
      .createHash('sha256')
      .update(readFileSync(path.join(dir, p)))
      .digest('hex');
  }

  return manifest;
}

async function signManifest(manifest: ManifestInfo): Promise<string> {
  const GRAFANA_API_KEY = process.env.GRAFANA_API_KEY;
  const GRAFANA_ACCESS_POLICY_TOKEN = process.env.GRAFANA_ACCESS_POLICY_TOKEN;

  if (!GRAFANA_API_KEY && !GRAFANA_ACCESS_POLICY_TOKEN) {
    throw new Error('You must enter a GRAFANA_API_KEY OR GRAFANA_ACCESS_POLICY_TOKEN to sign the plugin manifest');
  }

  if (GRAFANA_API_KEY) {
    console.warn('GRAFANA_API_KEY is deprecated. Use GRAFANA_ACCESS_POLICY_TOKEN instead');
  }

  const url = 'https://grafana.com/api/plugins/ci/sign';

  const token = GRAFANA_ACCESS_POLICY_TOKEN ?? GRAFANA_API_KEY;
  try {
    const fetch = (await import("node-fetch")).default;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token,
      },
      body: JSON.stringify(manifest),
    });
    if (response.status !== 200) {
      console.warn('Error: ', response);
      throw new Error('Error signing manifest');
    }

    return await response.text();
  } catch (err: any) {
    if (err.response?.data?.message) {
      throw new Error('Error signing manifest: ' + err.response.data.message);
    }

    throw new Error('Error signing manifest: ' + err.message);
  }
}

async function saveManifest(dir: string, signedManifest: string): Promise<boolean> {
  writeFileSync(path.join(dir, MANIFEST_FILE), signedManifest);
  return true;
}