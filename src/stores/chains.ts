// Chains (ST5): a shop that belongs to a chain is never a stop. The list is data (`chains.json`); a name is a chain's
// when its leading whole words are the chain's. "Half Price Books Outlet" is; "Half Price Bookshop" and "Old Goodwill
// Antiques" are not. Case, accents, `&` and punctuation do not matter.
import { readFileSync } from 'node:fs';

export const CHAINS: string[] = JSON.parse(readFileSync(new URL('./chains.json', import.meta.url), 'utf8'));

/** A name's words: lowercase, accents off, `&` as "and", anything else that is not a letter or digit a break. */
export function words(s: string): string[] {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

export function isChain(name: string, chains: string[] = CHAINS): boolean {
  const w = words(name);
  return chains.some((c) => {
    const cw = words(c);
    return cw.length > 0 && cw.length <= w.length && cw.every((x, i) => w[i] === x);
  });
}
