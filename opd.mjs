// opd.mjs — zopfli-lite optimal-parse deflate (pure JS, Node built-ins only).
// Produces a complete zlib stream for `data`. Deterministic: no clock, no randomness.
// Exports opDeflate(data, opts) -> Uint8Array (zlib stream).

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const LEN_CODE_OF = new Int16Array(259);
for (let c = 0; c < 29; c++) {
  const end = c === 28 ? 258 : LEN_BASE[c] + (1 << LEN_EXTRA[c]) - 1;
  for (let l = LEN_BASE[c]; l <= end; l++) LEN_CODE_OF[l] = c;
}
const DIST_CODE_OF = new Int16Array(32769);
for (let c = 0; c < 30; c++) {
  const end = DIST_BASE[c] + (1 << DIST_EXTRA[c]) - 1;
  for (let d = DIST_BASE[c]; d <= end; d++) DIST_CODE_OF[d] = c;
}
// Fixed (static) Huffman lengths.
const FIXED_LIT = new Int32Array(288);
for (let i = 0; i < 288; i++) FIXED_LIT[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
const FIXED_DIST = new Int32Array(30).fill(5);

// ---------------------------------------------------------------- match finding
function findMatches(data, maxChain) {
  const n = data.length;
  const mLen = new Uint16Array(n);
  const mDist = new Uint16Array(n);
  const HASH_BITS = 16;
  const head = new Int32Array(1 << HASH_BITS).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const limit = n - 2;
  for (let i = 0; i < limit; i++) {
    const h = (((data[i] << 16) ^ (data[i + 1] << 8) ^ data[i + 2]) * 2654435761 >>> (32 - HASH_BITS));
    let cand = head[h];
    prev[i] = cand;
    head[h] = i;
    if (cand < 0) continue;
    const maxL = Math.min(258, n - i);
    let bestLen = 2;
    let bestDist = 0;
    let tries = maxChain;
    while (cand >= 0 && tries-- > 0) {
      const dist = i - cand;
      if (dist > 32768) break;
      if (bestLen >= 3 && data[cand + bestLen] !== data[i + bestLen]) { cand = prev[cand]; continue; }
      let l = 0;
      while (l < maxL && data[cand + l] === data[i + l]) l++;
      if (l > bestLen) {
        bestLen = l;
        bestDist = dist;
        if (l >= maxL) break;
        if (l >= 64 && tries > 8) tries = 8;
      }
      cand = prev[cand];
    }
    if (bestLen >= 3) { mLen[i] = bestLen; mDist[i] = bestDist; }
  }
  return { mLen, mDist };
}

// ---------------------------------------------------------------- length-limited Huffman lengths (zlib-style)
function huffmanLengths(freq, maxBits) {
  const size = freq.length;
  const lengths = new Int32Array(size);
  let used = 0, single = -1;
  for (let i = 0; i < size; i++) if (freq[i] > 0) { used++; single = i; }
  if (used === 0) return lengths;
  if (used === 1) { lengths[single] = 1; return lengths; }
  const heapF = [], heapId = [];
  const push = (f, id) => {
    heapF.push(f); heapId.push(id);
    let c = heapF.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p] <= heapF[c]) break;
      const tf = heapF[p]; heapF[p] = heapF[c]; heapF[c] = tf;
      const ti = heapId[p]; heapId[p] = heapId[c]; heapId[c] = ti;
      c = p;
    }
  };
  const pop = () => {
    const topF = heapF[0], topId = heapId[0];
    const lastF = heapF.pop(), lastId = heapId.pop();
    if (heapF.length > 0) {
      heapF[0] = lastF; heapId[0] = lastId;
      let c = 0;
      for (;;) {
        const l = 2 * c + 1, r = l + 1;
        let m = c;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === c) break;
        const tf = heapF[m]; heapF[m] = heapF[c]; heapF[c] = tf;
        const ti = heapId[m]; heapId[m] = heapId[c]; heapId[c] = ti;
        c = m;
      }
    }
    return [topF, topId];
  };
  const parent = new Int32Array(2 * size).fill(-1);
  for (let i = 0; i < size; i++) if (freq[i] > 0) push(freq[i], i);
  let nodes = size;
  while (heapF.length > 1) {
    const a = pop(), b = pop();
    const id = nodes++;
    parent[a[1]] = id; parent[b[1]] = id;
    push(a[0] + b[0], id);
  }
  const blCount = new Int32Array(maxBits + 1);
  for (let i = 0; i < size; i++) {
    if (freq[i] === 0) continue;
    let d = 0, p = i;
    while (parent[p] !== -1) { d++; p = parent[p]; }
    if (d > maxBits) d = maxBits;
    blCount[d]++;
  }
  // Repair the Kraft sum exactly (integer units of 2^-maxBits). Clamping deep
  // lengths only ever oversubscribes the code; each redistribution step lowers
  // the Kraft sum by exactly one unit, so run it (K - 2^maxBits) times. (The
  // zlib-style "overflow -= 2" loop is wrong when the overflow count is odd.)
  let kraft = 0;
  for (let l = 1; l <= maxBits; l++) kraft += blCount[l] * 2 ** (maxBits - l);
  let excess = kraft - 2 ** maxBits;
  while (excess > 0) {
    let m = maxBits - 1;
    while (m >= 1 && blCount[m] === 0) m--;
    if (m < 1) break; // unrepairable; caller's kraftOk check falls back safely
    blCount[m]--;
    blCount[m + 1] += 2;
    blCount[maxBits]--;
    excess--;
  }
  const syms = [];
  for (let i = 0; i < size; i++) if (freq[i] > 0) syms.push(i);
  syms.sort((a, b) => freq[a] - freq[b] || a - b);
  let idx = 0;
  for (let len = maxBits; len >= 1; len--) {
    let c = blCount[len];
    while (c-- > 0) lengths[syms[idx++]] = len;
  }
  return lengths;
}
function kraftOk(lengths) {
  let sum = 0, used = 0;
  for (const l of lengths) if (l > 0) { sum += 2 ** -l; used++; }
  return used < 2 || Math.abs(sum - 1) < 1e-9;
}
function canonicalCodes(lengths) {
  let maxBits = 0;
  for (const l of lengths) if (l > maxBits) maxBits = l;
  const blCount = new Int32Array(maxBits + 2);
  for (const l of lengths) if (l > 0) blCount[l]++;
  const next = new Int32Array(maxBits + 2);
  let code = 0;
  for (let b = 1; b <= maxBits; b++) { code = (code + blCount[b - 1]) << 1; next[b] = code; }
  const codes = new Int32Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s] > 0) codes[s] = next[lengths[s]]++;
  return codes;
}
function reverseBits(code, len) {
  let r = 0;
  for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; }
  return r;
}
const reversedCodes = (lengths) => {
  const codes = canonicalCodes(lengths);
  const rev = new Int32Array(lengths.length);
  for (let s = 0; s < lengths.length; s++) if (lengths[s] > 0) rev[s] = reverseBits(codes[s], lengths[s]);
  return rev;
};

// ---------------------------------------------------------------- bit writer
class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.nbits = 0; this.totalBits = 0; }
  write(value, count) {
    this.totalBits += count;
    this.acc += value * 2 ** this.nbits;
    this.nbits += count;
    while (this.nbits >= 8) {
      this.bytes.push(this.acc % 256);
      this.acc = Math.floor(this.acc / 256);
      this.nbits -= 8;
    }
  }
  finish() {
    if (this.nbits > 0) { this.bytes.push(this.acc % 256); this.acc = 0; this.nbits = 0; }
    return Uint8Array.from(this.bytes);
  }
}

// ---------------------------------------------------------------- DP parse of one block
// Token arrays: sym (0..255 literal | 257..285 length code), len (match length, 0 for literal), dist.
function dpBlock(data, bs, be, mLen, mDist, litCost, lenCost, distCost, S) {
  const { cost, chLen, chDist, lenSym, distSym } = S;
  for (let c = 0; c < 29; c++) lenSym[c] = lenCost[c] + LEN_EXTRA[c];
  for (let c = 0; c < 30; c++) distSym[c] = distCost[c] + DIST_EXTRA[c];
  cost[be] = 0;
  for (let i = be - 1; i >= bs; i--) {
    let best = litCost[data[i]] + cost[i + 1];
    let bl = 0, bd = 0;
    let L = mLen[i];
    if (L >= 3) {
      if (i + L > be) L = be - i;
      if (L >= 3) {
        const dc = distSym[DIST_CODE_OF[mDist[i]]];
        const dd = mDist[i];
        for (let c = 0; c < 29; c++) {
          const base = LEN_BASE[c];
          if (base > L) break;
          let l = base + (1 << LEN_EXTRA[c]) - 1;
          if (l > L) l = L;
          const cc = lenSym[c] + dc + cost[i + l];
          if (cc < best) { best = cc; bl = l; bd = dd; }
        }
      }
    }
    if (i > bs) {
      const pl = mLen[i - 1] - 1;
      if (pl >= 3 && i + pl <= be) {
        const dd = mDist[i - 1];
        const dc = distSym[DIST_CODE_OF[dd]];
        for (let c = 0; c < 29; c++) {
          const base = LEN_BASE[c];
          if (base > pl) break;
          let l = base + (1 << LEN_EXTRA[c]) - 1;
          if (l > pl) l = pl;
          const cc = lenSym[c] + dc + cost[i + l];
          if (cc < best) { best = cc; bl = l; bd = dd; }
        }
      }
    }
    cost[i] = best;
    chLen[i] = bl;
    chDist[i] = bd;
  }
  const sym = [], len = [], dist = [];
  let i = bs;
  while (i < be) {
    const l = chLen[i];
    if (l === 0) { sym.push(data[i]); len.push(0); dist.push(0); i++; }
    else { sym.push(257 + LEN_CODE_OF[l]); len.push(l); dist.push(chDist[i]); i += l; }
  }
  return { sym, len, dist };
}

function tokenFreq(toks) {
  const fLit = new Float64Array(286);
  const fDist = new Float64Array(30);
  for (let t = 0; t < toks.sym.length; t++) {
    fLit[toks.sym[t]]++;
    if (toks.len[t] > 0) fDist[DIST_CODE_OF[toks.dist[t]]]++;
  }
  fLit[256] += 1;
  return { fLit, fDist };
}
// DP costs are INTEGER Huffman code lengths (as in zopfli's cost model), computed
// from smoothed frequencies so every usable symbol has a finite, realistic cost.
// Fractional -log2 costs would undervalue matches on skewed data (a 98.7%-likely
// literal "costs" 0.02 bits fractionally but 1 bit in the real code).
const intCosts = (freq, size) => {
  const f = new Float64Array(size);
  for (let i = 0; i < size; i++) f[i] = (freq[i] || 0) + 1;
  const lens = huffmanLengths(f, 15);
  const out = new Float64Array(size);
  for (let i = 0; i < size; i++) out[i] = lens[i] > 0 ? lens[i] : 15;
  return out;
};

// Quick lazy parse to seed len/dist statistics.
function lazyStats(data, bs, be, mLen, mDist) {
  const fLen = new Float64Array(29);
  const fDist = new Float64Array(30);
  let i = bs;
  while (i < be) {
    let L = mLen[i];
    if (L >= 3 && i + L > be) L = be - i;
    if (L >= 4 && i + 1 < be && mLen[i + 1] > L) { i++; continue; }
    if (L >= 3) { fLen[LEN_CODE_OF[L]]++; fDist[DIST_CODE_OF[mDist[i]]]++; i += L; }
    else i++;
  }
  return { fLen, fDist };
}

// ---------------------------------------------------------------- dynamic header
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
function rleLengths(seq) {
  const items = []; // [sym, extraValue]
  let i = 0;
  const n = seq.length;
  while (i < n) {
    const v = seq[i];
    if (v === 0) {
      let run = 1;
      while (i + run < n && seq[i + run] === 0) run++;
      i += run;
      while (run > 0) {
        if (run >= 11) {
          let c = Math.min(138, run);
          if (run - c > 0 && run - c < 3) c -= 3 - (run - c);
          items.push([18, c - 11]);
          run -= c;
        } else if (run >= 3) { items.push([17, run - 3]); run = 0; }
        else { items.push([0, 0]); run--; }
      }
    } else {
      items.push([v, 0]);
      i++;
      let run = 0;
      while (i + run < n && seq[i + run] === v) run++;
      i += run;
      if (run === 1 || run === 2) { while (run-- > 0) items.push([v, 0]); }
      else {
        while (run >= 3) {
          let c = Math.min(6, run);
          if (run - c === 1 || run - c === 2) c -= 3 - (run - c);
          items.push([16, c - 3]);
          run -= c;
        }
      }
    }
  }
  return items;
}
function buildDynamic(litLens, distLens) {
  let hlit = 286;
  while (hlit > 257 && litLens[hlit - 1] === 0) hlit--;
  let hdist = 30;
  while (hdist > 1 && distLens[hdist - 1] === 0) hdist--;
  const seq = [];
  for (let i = 0; i < hlit; i++) seq.push(litLens[i]);
  for (let i = 0; i < hdist; i++) seq.push(distLens[i]);
  const items = rleLengths(seq);
  const fCL = new Float64Array(19);
  for (const [s] of items) fCL[s]++;
  const clLens = huffmanLengths(fCL, 7);
  // Guard: CL code needs >= 2 used symbols forming a complete tree.
  let usedCL = 0, onlyCL = -1;
  for (let i = 0; i < 19; i++) if (clLens[i] > 0) { usedCL++; onlyCL = i; }
  if (usedCL === 1) {
    const dummy = onlyCL === 18 ? 17 : 18;
    clLens[dummy] = 1;
  }
  let hclen = 19;
  while (hclen > 4 && clLens[CL_ORDER[hclen - 1]] === 0) hclen--;
  let headerBits = 5 + 5 + 4 + 3 * hclen;
  const clExtra = { 16: 2, 17: 3, 18: 7 };
  for (const [s] of items) headerBits += clLens[s] + (clExtra[s] || 0);
  return { hlit, hdist, hclen, items, clLens, headerBits };
}

export const _debug = { findMatches, huffmanLengths, kraftOk, dpBlock, tokenFreq, intCosts, lazyStats };

// ---------------------------------------------------------------- main entry
export function opDeflate(data, opts = {}) {
  const blockSize = opts.blockSize ?? (1 << 20);
  const iterations = opts.iterations ?? 2;
  const maxChain = opts.maxChain ?? 128;
  const n = data.length;
  const { mLen, mDist } = findMatches(data, maxChain);
  const S = {
    cost: new Float64Array(n + 1),
    chLen: new Int32Array(n + 1),
    chDist: new Int32Array(n + 1),
    lenSym: new Float64Array(29),
    distSym: new Float64Array(30),
  };
  const bw = new BitWriter();
  const blocks = [];
  for (let bs = 0; bs < n; bs += blockSize) blocks.push([bs, Math.min(n, bs + blockSize)]);
  if (blocks.length === 0) blocks.push([0, 0]);
  blocks.forEach(([bs, be], bi) => {
    const last = bi === blocks.length - 1;
    // Initial costs: literal stats from bytes, len/dist stats from a lazy parse.
    const byteFreq = new Float64Array(256);
    for (let i = bs; i < be; i++) byteFreq[data[i]]++;
    let litCost = intCosts(byteFreq, 256);
    const seed = lazyStats(data, bs, be, mLen, mDist);
    let lenCost = intCosts(seed.fLen, 29);
    let distCost = intCosts(seed.fDist, 30);
    let toks = null;
    for (let it = 0; it < iterations; it++) {
      toks = dpBlock(data, bs, be, mLen, mDist, litCost, lenCost, distCost, S);
      const { fLit, fDist } = tokenFreq(toks);
      litCost = intCosts(fLit, 256);
      const fLen = new Float64Array(29);
      for (let s = 257; s <= 285; s++) fLen[s - 257] = fLit[s];
      lenCost = intCosts(fLen, 29);
      distCost = intCosts(fDist, 30);
    }
    // Exact frequencies -> real code lengths.
    const { fLit, fDist } = tokenFreq(toks);
    let litLens = huffmanLengths(fLit, 15);
    let distLens = huffmanLengths(fDist, 15);
    // Guards for degenerate dist alphabets.
    let usedDist = 0, onlyDist = -1;
    for (let i = 0; i < 30; i++) if (distLens[i] > 0) { usedDist++; onlyDist = i; }
    if (usedDist === 0) { distLens[0] = 1; distLens[1] = 1; }
    else if (usedDist === 1) { distLens[onlyDist === 0 ? 1 : 0] = 1; }
    if (!kraftOk(litLens) || !kraftOk(distLens)) {
      // Fall back to a static block with the same tokens.
      emitBlock(bw, toks, last, FIXED_LIT, FIXED_DIST, false, null);
      return;
    }
    // Exact bit costs: dynamic vs static.
    let dynDataBits = litLens[256];
    let staDataBits = FIXED_LIT[256];
    for (let t = 0; t < toks.sym.length; t++) {
      const s = toks.sym[t];
      dynDataBits += litLens[s];
      staDataBits += FIXED_LIT[s];
      if (toks.len[t] > 0) {
        const lc = LEN_CODE_OF[toks.len[t]];
        const dc = DIST_CODE_OF[toks.dist[t]];
        dynDataBits += LEN_EXTRA[lc] + distLens[dc] + DIST_EXTRA[dc];
        staDataBits += LEN_EXTRA[lc] + FIXED_DIST[dc] + DIST_EXTRA[dc];
      }
    }
    const dyn = buildDynamic(litLens, distLens);
    const dynTotal = 3 + dyn.headerBits + dynDataBits;
    const staTotal = 3 + staDataBits;
    if (opts.onBlock) opts.onBlock({ bs, be, dynTotal, staTotal, headerBits: dyn.headerBits, dynDataBits, staDataBits, toks: toks.sym.length });
    if (dynTotal <= staTotal) emitBlock(bw, toks, last, litLens, distLens, true, dyn);
    else emitBlock(bw, toks, last, FIXED_LIT, FIXED_DIST, false, null);
    if (opts.onBlock) opts.onBlock({ bs, emittedBits: bw.totalBits });
  });
  const body = bw.finish();
  // zlib wrapper: header + body + Adler-32.
  let a = 1, b = 0;
  for (let i = 0; i < n; i++) {
    a += data[i];
    b += a;
    if (i % 4096 === 4095) { a %= 65521; b %= 65521; }
  }
  a %= 65521; b %= 65521;
  const adler = ((b << 16) | a) >>> 0;
  const out = new Uint8Array(2 + body.length + 4);
  out[0] = 0x78; out[1] = 0x9c;
  out.set(body, 2);
  out[2 + body.length] = adler >>> 24;
  out[2 + body.length + 1] = (adler >>> 16) & 255;
  out[2 + body.length + 2] = (adler >>> 8) & 255;
  out[2 + body.length + 3] = adler & 255;
  return out;
}

function emitBlock(bw, toks, last, litLens, distLens, dynamic, dyn) {
  const litRev = reversedCodes(litLens);
  const distRev = reversedCodes(distLens);
  bw.write(last ? 1 : 0, 1);
  bw.write(dynamic ? 2 : 1, 2);
  if (dynamic) {
    bw.write(dyn.hlit - 257, 5);
    bw.write(dyn.hdist - 1, 5);
    bw.write(dyn.hclen - 4, 4);
    const clRev = reversedCodes(dyn.clLens);
    for (let i = 0; i < dyn.hclen; i++) bw.write(dyn.clLens[CL_ORDER[i]], 3);
    const clExtra = { 16: 2, 17: 3, 18: 7 };
    for (const [s, extra] of dyn.items) {
      bw.write(clRev[s], dyn.clLens[s]);
      if (clExtra[s]) bw.write(extra, clExtra[s]);
    }
  }
  for (let t = 0; t < toks.sym.length; t++) {
    const s = toks.sym[t];
    bw.write(litRev[s], litLens[s]);
    if (toks.len[t] > 0) {
      const l = toks.len[t];
      const lc = LEN_CODE_OF[l];
      if (LEN_EXTRA[lc] > 0) bw.write(l - LEN_BASE[lc], LEN_EXTRA[lc]);
      const d = toks.dist[t];
      const dc = DIST_CODE_OF[d];
      bw.write(distRev[dc], distLens[dc]);
      if (DIST_EXTRA[dc] > 0) bw.write(d - DIST_BASE[dc], DIST_EXTRA[dc]);
    }
  }
  bw.write(litRev[256], litLens[256]);
}
