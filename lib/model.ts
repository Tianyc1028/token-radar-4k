// Token Radar's value model (radar-2): a sealed snapshot in, a ranked board out.
//
// The board ranks every protocol the snapshot records as pre-token and rankable:
// the watchlist is the floor, and the early radar is every other rankable protocol,
// not a capped sample. A protocol is pre-token when its record carries no token
// (no market cap, no CoinGecko id, no symbol). Live-token protocols are kept apart
// and shown with the market's own value, never scored by this model.
//
// Implied value is one function of the snapshot's own figures, the same for every
// protocol, and no name is ever special-cased:
//
//   base        = tvl_usd x BASE_MULTIPLE
//   growth      = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) in per cent
//   growthMult  = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity    = MATURITY_FLOOR + MATURITY_RANGE x (1 - exp(-age_days / MATURITY_SCALE))
//   implied     = max(1, round(base x growthMult x maturity))
//
// Maturity saturates: a protocol that has run a long time with no token has earned
// most of the credit for surviving, and each extra year adds less. Age is the days
// since DefiLlama first listed the protocol; when the record carries no date the
// model uses UNKNOWN_AGE_DAYS. TVL is the anchor, growth is the momentum, and age
// is the patience: a big, growing, long-lived protocol without a token is the one
// whose launch would be worth the most.

/** One protocol entry, exactly the ten fields the sealed snapshot carries. */
export interface ProtocolRecord {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: ProtocolRecord[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard so a reader can check them. */
export interface ModelTuning {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_scale_days: number;
  unknown_age_days: number;
}

export const TUNING: ModelTuning = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_scale_days: 540,
  unknown_age_days: 365,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live tab carries, by market cap. */
export const LIVE_LIMIT = 24;

/** One farm step: what to do, what it costs, how long it takes. */
export interface PlanStep {
  action: string;
  cost: string;
  duration: string;
}

/** One row of board.json. */
export interface BoardEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watch: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One row as the dashboard's data.js carries it. */
export interface RadarEntry {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  watch: boolean;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelTuning;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarEntry[];
  live: LiveEntry[];
}

/** The snapshot is not one this model can score. */
export class SnapshotProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotProblem';
  }
}

const MS_PER_DAY = 86_400_000;

/** A finite number, or `fallback` when the value is missing or not finite. */
function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listed` to `asOf`, never below zero; null when either date is missing or bad. */
export function daysSince(asOf: string, listed: string | null): number | null {
  if (listed === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listed}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The multipliers and the implied value one protocol earns under `tuning`. */
export function scoreProtocol(
  p: ProtocolRecord,
  asOf: string,
  tuning: ModelTuning,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = daysSince(asOf, p.listed_at);
  const raw = asNumber(p.change_7d, 0);
  const growthPct = Math.min(tuning.growth_cap, Math.max(tuning.growth_floor, raw));
  const growthMult = 1 + (growthPct / 100) * tuning.growth_weight;
  const ageUsed = age ?? tuning.unknown_age_days;
  const maturityMult =
    tuning.maturity_floor + tuning.maturity_range * (1 - Math.exp(-Math.max(ageUsed, 0) / tuning.maturity_scale_days));
  const implied = Math.max(1, Math.round(p.tvl_usd * tuning.base_multiple * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** A name ending in a release marker is a pool of another protocol, not a protocol of its own. */
const RELEASE_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the house rule keeps off the watchlist: wrapped, staked or bridged products. */
const OFF_WATCHLIST = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether the record shows no token at all. */
export function hasNoToken(p: ProtocolRecord): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank this protocol: pre-token and not a wrapped, staked, bridged or exchange product. */
export function canRank(p: ProtocolRecord): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category !== null && OFF_WATCHLIST.has(p.category)) return false;
  if (RELEASE_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

/** The snapshot's protocols keyed by slug. */
function indexBySlug(protocols: ProtocolRecord[]): Map<string, ProtocolRecord> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A number rounded to four decimals, for the model's breakdown. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The ranked board: every watchlist slug, then every other rankable pre-token protocol, strongest first. */
export function buildBoard(snapshot: SnapshotDoc, tuning: ModelTuning = TUNING): BoardEntry[] {
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, ProtocolRecord>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) picked.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!picked.has(p.slug) && canRank(p)) picked.set(p.slug, p);
  }
  const scored = [...picked.values()].map((p) => {
    const s = scoreProtocol(p, snapshot.as_of, tuning);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watch: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: tuning.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: planFor(s.p, s.age).map(renderStep),
  }));
}

/** One step as a single string: action, cost and time, within the gate's 20 to 600 characters. */
export function renderStep(step: PlanStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.duration}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase when it names none. */
function firstChain(p: ProtocolRecord): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL tier. */
function stakeFor(p: ProtocolRecord): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: ProtocolRecord, stake: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${stake} of USDC to ${name} on ${chain} and leave the position open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${stake} of liquidity to ${name}'s main pool on ${chain} and leave the position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${stake} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${stake} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${stake} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${stake} and take one position in a market on ${name}.`;
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${stake} into a ${name} vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${stake} of the stable asset through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${stake} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${stake} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  return `Deposit $${stake} of USDC into ${name} on ${chain} and leave the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Every
 * step is derived from the protocol's own record (category, chains, TVL, age); no
 * protocol name is ever special-cased.
 */
export function planFor(p: ProtocolRecord, age: number | null): PlanStep[] {
  const chain = firstChain(p);
  const stake = stakeFor(p);
  const hold = holdFor(age);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = stake >= 150 ? 8 : 4;
  return [
    {
      action: `Set up a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      duration: '5 minutes',
    },
    {
      action: coreAction(p, stake, chain),
      cost: `$${stake} of capital and about $${gas} of gas`,
      duration: '15 minutes to set up',
    },
    {
      action: `Do one qualifying action each week: a deposit, a borrow, a swap, a vote, or a claim.`,
      cost: 'about $2 of gas a week',
      duration: '10 minutes a week',
    },
    {
      action:
        secondChain === null
          ? `Open a second, smaller position of $25 in the same protocol so the wallet shows repeat activity.`
          : `Repeat the same position on ${secondChain} with $25 so the wallet shows activity on two chains.`,
      cost: '$25 of capital and about $3 of gas',
      duration: '15 minutes',
    },
    {
      action: `Hold the main position for at least ${hold} days so the activity spans more than one snapshot.`,
      cost: `the $${stake} stays in the position`,
      duration: `${hold} days`,
    },
    {
      action: `Before withdrawing, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      duration: '10 minutes',
    },
    {
      action: `Write the wallet, the dates and every transaction hash in a farm log, so the position can be repeated or unwound.`,
      cost: 'nothing but the log',
      duration: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveSet(snapshot: SnapshotDoc): LiveEntry[] {
  return snapshot.protocols
    .filter((p) => !hasNoToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_LIMIT)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board entry's compact form for data.js. */
export function compactEntry(row: BoardEntry): RadarEntry {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    watch: row.watch,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Everything the dashboard renders, from one snapshot. */
export function buildRadar(snapshot: SnapshotDoc, tuning: ModelTuning = TUNING): { board: BoardEntry[]; payload: RadarPayload } {
  const board = buildBoard(snapshot, tuning);
  const live = liveSet(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: tuning,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(compactEntry),
    live,
  };
  return { board, payload };
}

/** The snapshot out of a file's text, refused unless it is the shape this model scores. */
export function readSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotProblem('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotProblem('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotProblem('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotProblem('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotProblem('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotProblem('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotProblem('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotProblem(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotProblem(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function checkBoard(board: BoardEntry[], snapshot: SnapshotDoc): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
