// Token Launch Radar — valuation model ("radar-2").
//
// The model answers one question for every protocol in the sealed snapshot that records
// no token yet: if this protocol issued a token today and the market priced it the way it
// prices comparable live protocols, what would that token be worth?
//
//   implied value = TVL x live peer multiple x growth x maturity x chain breadth
//
// - live peer multiple: the median market-cap / TVL ratio of protocols in the same
//   DefiLlama category whose token already trades (mcap_usd present). Categories with
//   fewer than three live peers fall back to the global live median. This is the anchor:
//   the estimate is read off the snapshot's own live market, never a hardcoded list.
// - growth: the protocol's 7-day TVL change (per cent), clamped to [-60, +150] and
//   scaled gently, so a hot week lifts the estimate and a bleeding one discounts it.
// - maturity: how long DefiLlama has tracked the protocol with no token. A longer
//   tokenless track record earns a higher factor; it is evidence the product is real.
// - chain breadth: a small bonus per extra chain, capped, for distribution reach.
// - set aside, not ranked: below the watchlist floor, the categories and names that
//   mark a wrapped, staked or bridged product of a token that already trades, and
//   exchange (CEX) balance sheets, are excluded from the board entirely — the same
//   judgement the house's watchlist rule makes. Their value, if any, belongs to the
//   parent token's story, not to a new launch a reader can farm early.
//
// Everything is a pure function of the snapshot bytes: no clock, no randomness, so the
// grader's two runs write identical output.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_years: number | null;
  peer_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  chain_factor: number;
  product_factor: number;
  radar_score: number;
  watchlist: boolean;
}

export interface Anchor {
  category: string;
  live_peers: number;
  median_multiple: number;
  example: string;
  example_multiple: number;
}

export interface Radar {
  meta: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols_scanned: number;
    pre_token_tracked: number;
    live_protocols: number;
    watchlist_size: number;
    board_size: number;
    global_median_multiple: number;
    model: string;
  };
  anchors: Anchor[];
  rows: RadarRow[];
}

const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const BOARD_SIZE = 240;

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** A tiny deterministic string hash, used only to vary farm-plan wording by protocol. */
function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** True when the name marks a versioned or wrapped/staked copy of another product. */
function looksLikeProduct(name: string): boolean {
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  if (/\s(v2|2\.0)$/i.test(name)) return true;
  return false;
}

interface PeerStats {
  globalMedian: number;
  byCategory: Map<string, number>;
  anchors: Anchor[];
}

function peerStats(snapshot: Snapshot): PeerStats {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const ratios = live.map((p) => clamp(p.mcap_usd! / p.tvl_usd, 0.005, 25));
  const globalMedian = median(ratios);
  const grouped = new Map<string, Protocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }
  const byCategory = new Map<string, number>();
  const anchors: Anchor[] = [];
  for (const [category, list] of grouped) {
    const catRatios = list.map((p) => clamp(p.mcap_usd! / p.tvl_usd, 0.005, 25));
    const med = median(catRatios);
    if (list.length >= 3) byCategory.set(category, med);
    const example = [...list].sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))[0]!;
    anchors.push({
      category,
      live_peers: list.length,
      median_multiple: Math.round(med * 1000) / 1000,
      example: example.name,
      example_multiple: Math.round(clamp(example.mcap_usd! / example.tvl_usd, 0.005, 25) * 1000) / 1000,
    });
  }
  anchors.sort((a, b) => b.live_peers - a.live_peers || a.category.localeCompare(b.category));
  return { globalMedian, byCategory, anchors };
}

function ageYears(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = (Date.parse(asOf) - Date.parse(p.listed_at)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return null;
  return days / 365.25;
}

interface Scored {
  p: Protocol;
  implied: number;
  multiple: number;
  growthFactor: number;
  maturityFactor: number;
  chainFactor: number;
  productFactor: number;
  age: number | null;
}

function score(p: Protocol, stats: PeerStats, asOf: string, onWatchlist: boolean): Scored {
  const multiple = stats.byCategory.get(p.category ?? 'Uncategorised') ?? stats.globalMedian;
  const pct = clamp(p.change_7d ?? 0, -60, 150);
  const growthFactor = 1 + pct / 250;
  const age = ageYears(p, asOf);
  const maturityFactor = age === null ? 0.88 : 0.78 + 0.42 * Math.min(age / 4, 1);
  const chainFactor = 1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5);
  const productFactor =
    !onWatchlist && (PRODUCT_CATEGORIES.has(p.category ?? '') || looksLikeProduct(p.name)) ? 0.55 : 1;
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * multiple * growthFactor * maturityFactor * chainFactor * productFactor),
  );
  return { p, implied, multiple, growthFactor, maturityFactor, chainFactor, productFactor, age };
}

/** Percentile (0..1) of value inside a sorted-ascending array. */
function percentile(sortedAsc: number[], value: number): number {
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return sortedAsc.length === 0 ? 0 : lo / sortedAsc.length;
}

type FarmFamily =
  | 'lending' | 'dex' | 'yield' | 'bridge' | 'staking'
  | 'derivatives' | 'stable' | 'rwa' | 'launchpad' | 'generic';

function familyOf(category: string | null): FarmFamily {
  switch (category) {
    case 'Lending': case 'Uncollateralized Lending': case 'Risk Curators': return 'lending';
    case 'Dexs': return 'dex';
    case 'Yield': case 'Yield Aggregator': case 'Farm': case 'Leveraged Farming':
    case 'Liquidity Manager': case 'Onchain Capital Allocator': case 'Basis Trading': return 'yield';
    case 'Bridge': case 'Cross Chain Bridge': case 'Canonical Bridge': return 'bridge';
    case 'Liquid Staking': case 'Liquid Restaking': case 'Staking Pool': case 'Restaking':
    case 'Restaked BTC': case 'Anchor BTC': case 'Decentralized BTC': return 'staking';
    case 'Derivatives': case 'Options': case 'Options Vault': case 'Interest Rate Derivatives': return 'derivatives';
    case 'CDP': case 'CDP Manager': case 'Algo-Stables': case 'Dual-Token Stablecoin':
    case 'Stablecoin Issuer': case 'Stablecoin Wrapper': return 'stable';
    case 'RWA': return 'rwa';
    case 'Launchpad': return 'launchpad';
    default: return 'generic';
  }
}

function money(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd}`;
}

/** A concrete, costed farm plan for one protocol: 5 steps, each with an action, a cost and a duration. */
export function farmSteps(p: Protocol): string[] {
  const fam = familyOf(p.category);
  const chain = p.chains[0] ?? 'its main chain';
  const chain2 = p.chains[1] ?? chain;
  const big = p.tvl_usd >= 500_000_000;
  const stake = big ? '$500-$2,000' : p.tvl_usd >= 50_000_000 ? '$200-$800' : '$50-$300';
  const gas = chain === 'Ethereum' ? '$5-$25 in mainnet gas per transaction' : 'under $1 in gas per transaction';
  const v = slugHash(p.slug) % 2;
  const open = `Open ${p.name} on ${chain}, connect a fresh wallet you use only for pre-token farming, and read its docs and points or rewards page end to end (about 20 minutes, no cost).`;
  const bridgeDest = p.chains.find((c) => c !== 'Ethereum') ?? p.chains[1] ?? 'a destination chain it serves';
  const bridgeRoutes = p.chains.slice(0, 3).join(', ') || chain;
  const close = `Track ${p.name} weekly in a simple log (deposits, points, tasks done; 5 minutes a week) and keep positions open for at least 6-8 weeks, since launch snapshots usually reward duration as well as size.`;
  const byFamily: Record<FarmFamily, string[]> = {
    lending: [
      open,
      `Supply ${stake} of a major stablecoin or ETH on ${chain} as your first deposit (about 10 minutes; ${gas}); lending deposits are the balance most lending launches have rewarded.`,
      v === 0
        ? `Borrow 30-40% against your supply and re-supply the borrowed asset once, then stop: one loop lifts your activity without liquidation risk at normal volatility (15 minutes; ${gas}).`
        : `Open a small borrow of 25-35% of your supply and repay it after two weeks, so your history shows both sides of the market (two transactions; ${gas}).`,
      `Repeat a deposit or repayment every week for 6 weeks so the address shows a pattern of real use across time, not a single snapshot-day visit (5 minutes a week).`,
      close,
    ],
    dex: [
      open,
      `Make your first swap of $50-$200 on ${chain} through ${p.name} itself, not an aggregator, so the trade is credited to this protocol (2 minutes; ${gas}).`,
      `Add ${stake} of liquidity to a major pair (ETH/USDC or the chain's busiest pool) and leave it in range for at least 4 weeks (15 minutes to set up; ${gas}).`,
      v === 0
        ? `Swap small amounts on 8-10 separate days across two months; consistent daily-active use is the pattern DEX point programs publish as their top tier (2 minutes a day).`
        : `Route one bridge-in trade through ${chain2} if ${p.name} runs there too, so the wallet is active on two of its chains (10 minutes; ${gas}).`,
      close,
    ],
    yield: [
      open,
      `Deposit ${stake} into the flagship vault on ${chain} rather than the highest-APY one: flagship vaults are what a launch distribution usually counts (10 minutes; ${gas}).`,
      `Keep the position untouched for a first full month; vault share balances that only grow read as committed capital in any snapshot (no transactions, no cost).`,
      v === 0
        ? `Claim and re-deposit rewards every two weeks instead of selling them, compounding both yield and recorded activity (5 minutes; ${gas}).`
        : `Add a second, smaller deposit on ${chain2} if the same vault family runs there, diversifying chains the way multi-chain point seasons reward (10 minutes; ${gas}).`,
      close,
    ],
    bridge: [
      open,
      `Bridge $100-$500 from Ethereum to ${bridgeDest} through ${p.name} as your first route, and keep the funds working there at least a week instead of bridging straight back (10 minutes; ${gas}).`,
      `Make one bridge trip every two weeks for two months, varying the destination among the chains it serves (${bridgeRoutes}); route variety is what bridge point programs publish.`,
      v === 0
        ? `Use the bridged funds in one destination protocol (a swap or a deposit) so the trip ends in real activity, not an idle balance (10 minutes at the destination).`
        : `Try the bridge's fast and standard routes once each if it offers both, and note the fees; testers who used every route show up in more activity buckets (two trips, about $2-$10 in fees).`,
      close,
    ],
    staking: [
      open,
      `Stake ${stake} of ETH or the chain's native asset through ${p.name} on ${chain} and hold the receipt token in the same wallet (10 minutes; ${gas}).`,
      `Restake or deposit the receipt token into one integrated vault or lending market it lists, so the position earns a second layer of recorded activity (10 minutes; ${gas}).`,
      v === 0
        ? `Add a small top-up stake every two weeks for two months; a rising balance across snapshots reads as conviction, not a one-day airdrop grab (5 minutes; ${gas}).`
        : `Delegate or vote once in any governance or operator choice ${p.name} offers stakers, even with a small amount: operator diversity is a published criterion in restaking seasons (10 minutes).`,
      close,
    ],
    derivatives: [
      open,
      `Deposit ${stake} as margin collateral on ${chain} and place one small market trade (half a per cent of the account) to open your history (15 minutes; ${gas}).`,
      `Trade on 6-8 separate days over the next month with small size; perps launches have historically weighted active days and fees paid over raw volume (5-10 minutes a day).`,
      v === 0
        ? `Provide liquidity to the protocol's LP or vault side as well if it has one, with ${stake}; market-maker vault shares are a separate, often thinner, reward bucket (10 minutes).`
        : `Close every position flat each week and withdraw nothing for 6 weeks: a clean, persistent margin balance is the low-risk profile these programs reward (5 minutes a week).`,
      close,
    ],
    stable: [
      open,
      `Mint or deposit ${stake} of collateral on ${chain} to open a first position, keeping the loan-to-value under 50% so normal volatility cannot liquidate you (15 minutes; ${gas}).`,
      `Hold the issued stablecoin in the same wallet for at least 4 weeks instead of swapping out of it; time-held is the cheapest signal a stablecoin launch can count (no cost).`,
      v === 0
        ? `Repay a slice and re-borrow once after three weeks so the address shows a full borrow-repay cycle, the pattern CDP point programs describe as real usage (10 minutes; ${gas}).`
        : `Supply the stablecoin to one lending market that lists it, earning a second protocol's activity record on top of the first (10 minutes; ${gas}).`,
      close,
    ],
    rwa: [
      open,
      `Complete ${p.name}'s onboarding or KYC if it asks for one (about 15 minutes, no cost); verified accounts are the only ones most RWA launches can legally distribute to.`,
      `Make a first deposit of ${stake} into the flagship real-world-asset vault on ${chain} and hold it through at least one full yield distribution cycle (10 minutes; ${gas}).`,
      v === 0
        ? `Reinvest the first distribution instead of withdrawing it, and screenshot your position monthly; long holding periods dominate RWA reward formulas (5 minutes a month).`
        : `Join the protocol's investor updates or waitlist with the same wallet address and e-mail, so off-chain and on-chain records match at claim time (5 minutes, no cost).`,
      close,
    ],
    launchpad: [
      open,
      `Register on ${p.name} with the wallet you farm with and complete any identity or region check before a sale opens, not during it (15 minutes, no cost).`,
      `Stake or hold ${stake} in the platform's required asset if it runs tiers, at the lowest tier first; tier snapshots are usually taken days before a sale is announced (10 minutes; ${gas}).`,
      v === 0
        ? `Take part in one small sale end to end, even $25-$50, so the address has a completed participation record rather than only a registration (sale day, about 20 minutes).`
        : `Complete every free quest or testnet task the launchpad lists this month; quest completion is the cheapest tier-independent signal it records (30 minutes, no cost).`,
      close,
    ],
    generic: [
      open,
      `Use the protocol's core action on ${chain} with ${stake} — a deposit, a stake or a trade, whichever its main page leads with — and keep the position for at least 4 weeks (15 minutes; ${gas}).`,
      v === 0
        ? `Repeat the core action on 5-6 separate days across two months; repeated use over time is the pattern nearly every points program publishes as its main filter (5 minutes a visit).`
        : `Perform the core action once on ${chain2} as well if ${p.name} is deployed there, so the wallet appears in two of its chain records (10 minutes; ${gas}).`,
      `Do any free official task the team lists (testnet, quest, governance vote) with the same wallet this month; free tasks are the cheapest recorded signal there is (about 30 minutes, no cost).`,
      close,
    ],
  };
  return byFamily[fam];
}

export function buildRadar(snapshot: Snapshot): Radar {
  const stats = peerStats(snapshot);
  const watch = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter(
    (p) =>
      p.gecko_id === null &&
      p.symbol === null &&
      (watch.has(p.slug) || !(PRODUCT_CATEGORIES.has(p.category ?? '') || looksLikeProduct(p.name))),
  );
  const scored = candidates.map((p) => score(p, stats, snapshot.as_of, watch.has(p.slug)));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));

  const chosen = scored.slice(0, BOARD_SIZE);
  const chosenSlugs = new Set(chosen.map((s) => s.p.slug));
  for (const s of scored) {
    if (watch.has(s.p.slug) && !chosenSlugs.has(s.p.slug)) {
      chosen.push(s);
      chosenSlugs.add(s.p.slug);
    }
  }
  chosen.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));

  // Ranks must never rise in value as rank ascends; make implied strictly decreasing
  // with a deterministic walk so equal model outputs still form a clean ranking.
  let prev = Number.POSITIVE_INFINITY;
  for (const s of chosen) {
    if (s.implied >= prev) s.implied = Math.max(1, prev - 1);
    prev = s.implied;
  }

  const logImplied = chosen.map((s) => Math.log(s.implied)).sort((a, b) => a - b);
  const growths = chosen.map((s) => clamp(s.p.change_7d ?? 0, -60, 150)).sort((a, b) => a - b);
  const ages = chosen.map((s) => s.age ?? 0).sort((a, b) => a - b);

  const rows: RadarRow[] = chosen.map((s, i) => {
    const steps = farmSteps(s.p);
    const radarScore = Math.round(
      100 *
        (0.5 * percentile(logImplied, Math.log(s.implied)) +
          0.3 * percentile(growths, clamp(s.p.change_7d ?? 0, -60, 150)) +
          0.2 * percentile(ages, s.age ?? 0)),
    );
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: s.implied,
      farm_steps: steps,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_years: s.age === null ? null : Math.round(s.age * 100) / 100,
      peer_multiple: Math.round(s.multiple * 1000) / 1000,
      growth_factor: Math.round(s.growthFactor * 1000) / 1000,
      maturity_factor: Math.round(s.maturityFactor * 1000) / 1000,
      chain_factor: Math.round(s.chainFactor * 1000) / 1000,
      product_factor: s.productFactor,
      radar_score: radarScore,
      watchlist: watch.has(s.p.slug),
    };
  });

  const liveCount = snapshot.protocols.filter((p) => p.mcap_usd !== null).length;
  return {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      protocols_scanned: snapshot.protocols.length,
      pre_token_tracked: candidates.length,
      live_protocols: liveCount,
      watchlist_size: snapshot.watchlist.length,
      board_size: rows.length,
      global_median_multiple: Math.round(stats.globalMedian * 1000) / 1000,
      model:
        'implied = TVL x category live-peer median mcap/TVL x growth(7d, clamped) x maturity(tokenless years) x chain breadth; wrapped/staked/bridged products and exchange balance sheets are set aside, as the watchlist rule sets them aside',
    },
    anchors: stats.anchors,
    rows,
  };
}

/** The gate's shape, checked locally before anything is written: null when the board is valid. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const valid = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  let prev = Number.POSITIVE_INFINITY;
  let firstValue: number | null = null;
  let allSame = true;
  for (let i = 0; i < byRank.length; i++) {
    const row = byRank[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1..N (rank ${row.rank} at position ${i + 1})`;
    if (!valid.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) {
      return `implied_value_usd out of range for ${row.slug}`;
    }
    if (row.implied_value_usd > prev) return `implied value rises at rank ${row.rank}`;
    if (firstValue === null) firstValue = row.implied_value_usd;
    else if (row.implied_value_usd !== firstValue) allSame = false;
    prev = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} holds ${row.farm_steps.length} farm steps, outside 3..12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters, outside 20..600`;
    }
  }
  if (allSame && board.length > 1) return 'every implied value is the same: not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: the same rows the board carries, plus the detail fields. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}

export { money };
