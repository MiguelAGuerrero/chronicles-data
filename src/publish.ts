// Publish (PP12, PW19): a new pack only when one of its blocks changed, read against the live manifest. A rebuild in
// which no place changed publishes nothing, whatever happened to the file's bytes.

interface ManifestFile {
  blocks?: Record<string, string>;
  [field: string]: unknown;
}
interface Manifest {
  regions?: { id: string; current?: ManifestFile }[];
  [field: string]: unknown;
}

const sameBlocks = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/** PP12: whether to publish a region's pack, from its blocks (null when the build made none) and the live manifest. */
export function decide({ region, blocks, manifest, unreachable = false, license }: { region: string; blocks: Record<string, string> | null; manifest: Manifest | null; unreachable?: boolean; license?: string }) {
  if (!blocks) return { publish: false, reason: 'no archive built' };
  // One network error must not publish a duplicate (places-worth-the-stop audit 7): only a real 404 is no manifest.
  if (unreachable) return { publish: false, reason: 'manifest unreachable' };
  if (!manifest) return { publish: true, reason: 'no manifest yet' };
  const current = (manifest.regions ?? []).find((r) => r.id === region)?.current;
  if (!current) return { publish: true, reason: 'new region' };
  if (!current.blocks) return { publish: true, reason: 'no blocks yet' };
  // RD11: a region whose license changed is published, its places unchanged or not (a manifest without one is CC0).
  if (license && (current.license ?? 'cc0') !== license) return { publish: true, reason: `license now ${license}` };
  return sameBlocks(current.blocks, blocks) ? { publish: false, reason: 'unchanged' } : { publish: true, reason: 'changed' };
}
