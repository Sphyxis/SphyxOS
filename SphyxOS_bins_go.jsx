/**Author:
 * Original base script from Yichi - https://github.com/yichizhng/bitburner-scripts/blob/main/autokroos.js
 * 
 * Discord: Sphyxis
 * 
 */

// ==== Top-level state (worker section) ====
let isBlack = true; //What color are you playing?  Only allowed false when on No AI board.
let SEARCH_PLAYER_IS_BLACK = true;
let BOARD_SIZE = 5;
const POSITION_KEY_STRIDE_5 = 0x2000000;
// Bit 31 flags a history-restricted decision node; bits 0-24 hold its legal moves.
const DECISION_CONTEXT_TAG = 0x80000000;
let PLAYOUTS = 1000;
let EMPTY_BOARD_PLAYOUT_CAP = 5000;   // empty openings don't need the full budget
let MAXITERATIONS = 500;
let EXPLORATION_PARAMETER = 0.3;      // MCGS exploration, hand-tuned
let EXPLORATION_PARAMETER_OVERRIDE = null;
let SEARCH_KOMI = 5.5;
const SEARCH_WIN_UTILITY = 25;
const SEARCH_MARGIN_UTILITY_SCALE = 0.01;
let ROOT_REPLY_COLLAPSE_MIN_STONES = 2;
let NEAR_EQUAL_VALUE_EPSILON = SEARCH_WIN_UTILITY * 0.0002;  // ties within 0.02% of a win
let PURGE_PROVEN_WORTHLESS_NODES = true;
let CONFIDENCE_BEFORE_VALUE = false;
let ROOT_CONFIDENCE_Z = 1.96;
let CHANCE_RESPONSE_MIN_VISITS = 16;
let CHANCE_RESPONSE_QUOTA_FRACTION = 0.7;
// MCGS diagnostic counters.
let PROVEN_NODE_PURGE_COUNT = 0;
let PROVEN_NODE_PURGED_EDGE_COUNT = 0;
let PROVEN_CHANCE_PURGE_SKIP_COUNT = 0;
let CHANCE_CONTEXT_REUSE_COUNT = 0;
let CHANCE_CONTEXT_SPLIT_COUNT = 0;
let DECISION_CONTEXT_REUSE_COUNT = 0;
let DECISION_CONTEXT_SPLIT_COUNT = 0;
let RETAINED_EVIDENCE_SCALE_COUNT = 0;
let RETAINED_EVIDENCE_REMOVED = 0;
// Cheats — master toggle (host first-choice layer + worker rollouts).
let CHEATS_ENABLED = false;
// Only cheat while the reported success chance is >= this (1.0 = risk-free).
// Re-read each turn; disabled for the rest of the game once it decays below.
let CHEAT_MIN_SUCCESS_CHANCE = 1.0;
// Guaranteed-capture cheat: fill both liberties of a 2-lib enemy group in one
// turn; only groups with at least this many stones qualify.
let CHEAT_CAPTURE_MIN_STONES = 3;
// Suppress playouts when a transposed child has more playouts than the edge's
// visits. Disabled: the visit-deficit accounting starves turns or inflates
// visits through graph cycles; plain descents always produce information.
const SUPPRESS_TRANSPOSITION = false;
// Max descent depth per playout before its edge scores as a rollout leaf.
// Caps per-playout cost on large retained graphs and prevents cycle hangs.
let DESCENT_DEPTH_LIMIT = 64;
// Per-worker, per-search cap on CREATED tree nodes (the memory clamp) — the
// search stops expanding when hit. Rough cost ~25KB/node (up to ~60KB worst),
// so 1000 nodes ~= 25MB/worker. Forwarded to every worker each search.
let MAX_ACTIVE_SEARCH_NODES_PER_WORKER = 1000;
// 19x19 play radius (Chebyshev) from any existing stone: black = us (bait
// spots exempt), white = modeled AI. Forwarded to every worker each search.
let Y19_BLACK_NEAR_RADIUS = 1;
let Y19_WHITE_NEAR_RADIUS = 1;
// Bounded semeai reader for the 19x19 cascade; read each turn and forwarded to
// workers, so changes apply without rebuilding the pool.
let Y19_SEMEAI_READING = true;
// False = only host pre-scan proofs; true also allows the distributed worker
// proof, once the pre-scan exposes an AND/OR frontier.
let Y19_DEEP_SEMEAI = false;
let Y19_SEMEAI_PRESCAN_TIME_LIMIT_MS = 200;
// Total placements by both players in the capturing-race proof (~5 plies seen).
let Y19_SEMEAI_MAX_MOVES = 10;
// Wall-clock limit per worker request; a hit here or on the node cap returns
// "unknown", never a false proof.
let Y19_SEMEAI_TIME_LIMIT_MS = 600;
const Y19_SEMEAI_DEADLINE_CHECK_NODES = 1;
let Y19_DEFER_SEMEAI_REPLY_BOARDS = true;
let Y19_LOCAL_OWN_FORCED_CANDIDATES = true;
// Groups larger than this liberty count are not treated as bounded semeai.
let Y19_SEMEAI_MAX_LIBERTIES = 10;
// Commit-safety (A/B). One-ply terminal validation only sees policy replies;
// the ???'s ~10% random fallback can whittle committed stones over 2-4 turns.
// When true a terminal commits only if every committed attacker keeps a spare
// liberty (>=3), so one unmodeled reply can't start a fatal chase.
let Y19_SEMEAI_COMMIT_SAFETY = true;
// A committed multi-turn chase is only worth it for a target this large;
// smaller ones are atari'd directly. Checked at build and each continuation.
let Y19_SEMEAI_MIN_TARGET_STONES = 2;
// Cascade steps above the semeai continuation slot the reader models as OUR
// forced interruptions: 0 none, 1 counterLib, 2 +libAttack(88), 3 +libDefend.
let Y19_OWN_FORCED_PREFIX = 3;
// Point index of the outstanding bait stone (null = none) so libDefend won't
// rescue the intended sacrifice. Cleared once taken/resolved.
let BAITED = null;
// Pending bait follow-up: the liberty fill to play next turn if the opponent
// took the bait. Module-level so the ladder maker can arm it. Reset per game.
let y19BaitFollowUp = null;
let y19BaitOwner = null;
let y19LadderPlan = null;
// Pending removeRouter eye-kill: after the cheat clears a stone from a <=1-eye
// group, occupy that point next turn before the AI refills it. Reset per game.
let y19RouterKill = null;
// Ladder bait: open a ladder with a self-atari stone the defender must capture,
// buying a free liberty fill (3->2) so a 3-lib group becomes ladderable.
let Y19_LADDER_BAIT = true;
// Also try 2-lib baits (forced to 1 lib, then captured), preferred in enemy
// territory. Load-bearing: off was ~10pts of the 2026-07-16 regression.
let Y19_LADDER_BAIT_2LIB = true;
// Semeai bait-capture conversion: while the AI is committed to taking our
// createBait stone (free tempo), groups one liberty beyond normal eligibility
// are checked for a fill that wins the race once the capture resolves.
let Y19_SEMEAI_BAIT = true;
// Distribute semeai/ladder/bait reads across the worker pool (round-robin, host
// fallback per slice). Off = sequential host reads.
let Y19_PARALLEL_READS = true;
// Prep ladder: fill one liberty of a 3-lib enemy group (largest first) so it
// stands at 2 libs — a ladder-maker target next turn — but only when the read
// proves the result is a winning ladder AND the fill stone itself is safe.
let Y19_PREP_LADDER = true;
// Minimum enemy-group size worth prepping (A/B winner: 4 — fewest fires, safest
// worst case, margin tied with lower values).
let Y19_PREP_LADDER_MIN_STONES = 4;
// Lane buckets for distributed reads: off = plain round-robin split; on =
// weight-balanced buckets with spare workers taking follow-up lanes.
let Y19_READ_LANES = true;
// Bolster ladder veto: when on, bolster won't reinforce a chain still a proven-
// dead ladder after the move. Measured neutral; kept as a lever.
let Y19_BOLSTER_LADDER_VETO = false;
// "engaged" opening pause: yield to the cascade while a chain holds <= this
// many liberties (0 = never pause).
let Y19_OPENING_ENGAGED_LIBS = 2;
// Opening style:
//   "original"  turn-gated, raw star points, no engaged pause (old baseline).
//   "resolved"  original gating + star points slid to the bitverse layout.
//   "engaged"   placement-counted, resolved points, + the engaged pause.
// A/B winner: engaged (the pause is the value-add).
let Y19_OPENING_STYLE = "engaged";
// Opening bait: the bitverse's far-left/right dead-end corridors take a 2-lib
// bait on worthless ground — the AI spends 2 moves capturing 1 stone while we
// get 2 free framework moves. Played as the first two opening moves; exempt
// from the engaged pause (being attacked is the point).
let Y19_OPENING_BAIT = true;
// Opening stones staked on star points before the fighting cascade takes over.
// Counted by placements, not turns: yields while a chain is engaged and resumes
// when safe (within 2x this many turns). Default 6 (2 corridor baits + 4 framework).
let Y19_OPENING_MOVES = 6;
// Kill eyespace (nakade): play the vital point of an enemy's single 4-6 point
// eyespace so it can't make two eyes — the offensive mirror of createEyes.
let Y19_KILL_EYESPACE = true;
// Ladder maker's nominal cascade position — no longer a splice slot; only tells
// the reader how many forced own-moves sit above it (caps the forced prefix at 3).
let Y19_LADDER_MAKER_CASCADE_POSITION = 4;
// Ladder reader budget (alternating placements across the full board).
let Y19_LADDER_MAKER_MAX_MOVES = 2 * 19;
let Y19_LADDER_MAKER_NODE_LIMIT = 4 * 19 * 19;
// Ladder maximize: rank candidates by TOTAL kill (target + forced extensions,
// longest proven line), since every extension dies with the group. Off = old
// shortest-proof ranking.
let Y19_LADDER_MAXIMIZE = true;
// Ladder terminal safety: a ladder stopping on an "effectively dead" (1-lib,
// not captured) terminal must survive EVERY legal defender reply, not just the
// modeled ones — the ???'s ~10% random fallback can otherwise recapture our
// committed chain and let the group escape. Strict subset of what fires today.
let Y19_LADDER_TERMINAL_SAFETY = true;
// Same safety for the semeai/liberty-race terminal: the committed race win must
// survive every legal defender reply, closing the same random-fallback gap.
let Y19_SEMEAI_TERMINAL_SAFETY = true;
const Y19_RESCUE_LADDER_CACHE_LIMIT = 256;
const y19RescueLadderCache = new Map();
const RETAINED_ROOT_RESERVE_NODES = 128;
let SATURATED_PLAYOUT_REBALANCE_ENABLED = true;
let SATURATED_PLAYOUT_MIN_FRACTION = 0.4;
let SATURATED_PLAYOUT_CHECK_INTERVAL = 64;
let SATURATED_PLAYOUT_EXTRA_LEAF_VISITS = 192;
let SATURATED_PLAYOUT_EXTRA_FRACTION = 0.2;
let SATURATED_PLAYOUT_NEW_NODE_RATE = 0.06;
let SATURATED_PLAYOUT_MIN_VISITS_PER_ROOT_TASK = 24;
let SATURATED_PLAYOUT_ASSIST_RESERVE_FRACTION = 0.08;
let SATURATED_PLAYOUT_ASSIST_RESERVE_MAX = 128;
// A retained node contributes at most this fraction of one fresh worker
// search. Scale N/S/SS together so old evidence keeps its mean and variance
// but can never overwhelm the next turn's observations.
let RETAINED_EVIDENCE_MAX_FRACTION = 0.5;
// Repeated rollouts from the same leaf are draws of one biased estimator:
// past this window their statistical weight stops growing (the estimate
// keeps updating as an exponential moving average). Real tree descents are
// unaffected, so an edge can never carry more weight than its evidence.
let LEAF_EVIDENCE_WINDOW = 64;
let PROGRESSIVE_WIDENING_BASE = 12;
let PROGRESSIVE_WIDENING_SCALE = 1.5;
let PROGRESSIVE_WIDENING_OVERRIDE = null;
let MOVE_SCRATCH = null;
let NODE_EXPANSION_SCRATCH = null;
const BITBOARD_FULL_5 = 0x1FFFFFF;
const BITBOARD_COL0_5 = 0x108421;
const BITBOARD_COL4_5 = 0x1084210;
let TERRITORY_SCRATCH = null;
let HISTORY_SCRATCH = null;
let SEARCH_PATH_SCRATCH = null;
let SEARCH_MISS_GENERATION = 0;
let WORKER_SEARCH_SEQUENCE = 0;
const RETAINED_ROOT_EDGE_SCRATCH = new Array(26);
// Benson pass-alive on bitboards (~0.07us for both colors): chains whose
// vital enclosed regions number >=2 are unconditionally alive. Used for OUR
// analysis only — opponent replies still come from the source-faithful
// policy functions.
const BENSON_CHAINS = new Int32Array(16);
const BENSON_CHAIN_LIBS = new Int32Array(16);
const BENSON_REGION_EMPTY = new Int32Array(16);
const BENSON_REGION_CHAINS = new Int32Array(16);
// Rollout PRNG: xorshift32, ~1.7x faster than Math.random and the only
// randomness consumer in the search. Seedable for reproducible runs.
let ROLLOUT_RNG_STATE = 0x9E3779B1;
let FAST_PLAYOUT_SCRATCH = null;
// Boards are fully determined by a position key plus the game-constant
// offline mask, so nodes and edges never need to retain a board array.
let EXPANSION_BOARD_SCRATCH = null;
let EYE_SCRATCH = null;
const KOMI_BY_OPPONENT = {
  "No AI": 5.5,
  "Netburners": 1.5,
  "Slum Snakes": 3.5,
  "The Black Hand": 3.5,
  "Tetrads": 5.5,
  "Daedalus": 5.5,
  "Illuminati": 7.5,
  "????????????": 9.5,
};
const EXPLORATION_PARAMETER_BY_OPPONENT = {
  "No AI": 1,
  "Netburners": 0.43,
  "Slum Snakes": 0.95,
  "The Black Hand": 1.19,
  "Tetrads": 0.87,
  "Daedalus": 1.03,
  "Illuminati": 1.00,
  "????????????": 1.00,
};
const PLAYOUTS_BY_OPPONENT = {
  "No AI": {
    "Min": 10,
    "Low": 100,
    "Med": 1000,
    "High": 10000,
    "Max": 100000,
    "Ultra": 200000
  },
  "Netburners": {
    "Min": 60, //70
    "Low": 190, //80
    "Med": 450, //90
    "High": 740, //95
    "Max": 7500, //98
    "Ultra": 20000 //99
  },
  "Slum Snakes": {
    "Min": 220, //70
    "Low": 450, //80
    "Med": 690, //90
    "High": 940, //95
    "Max": 14000, //98
    "Ultra": 32000 //99
  },
  "The Black Hand": {
    "Min": 200, //70
    "Low": 300, //80
    "Med": 410, //90
    "High": 660, //95
    "Max": 10000, //98
    "Ultra": 26000 //99
  },
  "Tetrads": {
    "Min": 300, //70
    "Low": 430, //80
    "Med": 1000, //90
    "High": 2500, //95
    "Max": 9600, //98
    "Ultra": 25000 //99
  },
  "Daedalus": {
    "Min": 720, //70
    "Low": 1300, //80
    "Med": 5000, //90
    "High": 30200, //95
    "Max": 79000, //98
    "Ultra": 400000 //99
  },
  "Illuminati": {
    "Min": 700, //70
    "Low": 850, //80
    "Med": 1700, //90
    "High": 4000, //95
    "Max": 22000, //98
    "Ultra": 60000 //99
  },
  "????????????": {
    "Min": 700, //70
    "Low": 850, //80
    "Med": 1700, //90
    "High": 4000, //95
    "Max": 22000, //98
    "Ultra": 44000 //99
  }
};
const MEMORY_NODE_CAPS = {
  "Min": 4000,  // ~100-240MB
  "Low": 10000,   // ~250-600MB
  "Med": 25000,  // ~625-1500MB
  "High": 40000, // ~1000-2400MB
  "Max": 50000  // ~1250-3000MB
}
// Reserved for the 19x19 path (not yet wired in).
const Y19MEMORY_NODE_CAPS = {
  "Min": 100,  // ~100-240MB
  "Low": 1000,   // ~250-600MB
  "Med": 10000,  // ~625-800MB
  "High": 50000, // ~Maxed
  "Max": 50000  // ~Maxed
}
const PROGRESSIVE_WIDENING_BY_OPPONENT = {
  "Netburners": [12, 1.5],
  "Slum Snakes": [17.5, 4.75],
  "The Black Hand": [15, 1],
  "Tetrads": [10.5, 1.5],
  "Daedalus": [10.5, 1.5],
  "Illuminati": [7.25, 1.75],
};
const AI_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const AI_PATTERNS = [
  ["XOX", "...", "???"], ["XO.", "...", "?.?"], ["XO?", "X..", "o.?"],
  [".O.", "X..", "..."], ["XO?", "O.x", "?x?"], ["XO?", "O.X", "???"],
  ["?X?", "O.O", "xxx"], ["OX?", "x.O", "???"], ["X.?", "O.?", "   "],
  ["OX?", "X.O", "   "], ["?X?", "o.O", "   "], ["?XO", "o.o", "   "],
  ["?OX", "X.O", "   "],
];
const EXPANDED_AI_PATTERNS = AI_PATTERNS.flatMap(getAllPatterns);
const COMPILED_AI_PATTERNS = [
  ...new Set(EXPANDED_AI_PATTERNS.map((pattern) => pattern.join(""))),
];
const AI_PATTERN_CACHE_SLOTS = 8192;
let AI_PATTERN_CACHE_KEYS = null;
let AI_PATTERN_CACHE_VALUES = null;
// SOURCE_FAITHFUL_POLICY_START
/*
 * Source-faithful 5x5 AI policy.
 *
 * These helpers mirror boardAnalysis.ts, controlledTerritory.ts,
 * patternMatching.ts, and goAI.ts. In particular, they preserve x/y scan
 * order and the source's N/E/S/W neighbor order. The policy result is the
 * union of every move reachable through the source RNG branches. A move is
 * forced only when that union is a single move and pass is unreachable.
 */
const SOURCE_AI_NEIGHBORS_5 = Array.from({ length: 25 }, (_, pos) => {
  const x = (pos / 5) | 0;
  const y = pos % 5;
  const result = [];
  if (y < 4) result.push(pos + 1);
  if (x < 4) result.push(pos + 5);
  if (y > 0) result.push(pos - 1);
  if (x > 0) result.push(pos - 5);
  return result;
});
// Flood/marker scratch reused across calls (fill(0) is equivalent to a
// fresh array and removes ~40 allocations per policy resolution).
const SOURCE_ANALYZE_CHECKED = new Uint8Array(25);
const SOURCE_ANALYZE_IN_GROUP = new Uint8Array(25);
const SOURCE_ANALYZE_SEEN = new Uint8Array(25);
const SOURCE_OUTSIDE_IN_GROUP = new Uint8Array(25);
const SOURCE_OUTSIDE_SEEN = new Uint8Array(25);
const SOURCE_NEIGHBOR_GROUP_SEEN = new Uint8Array(26);
const SOURCE_FACTION_CUTS5 = Object.freeze({
  Netburners: Object.freeze([0, .2, .4, .6, .75, 1]),
  "Slum Snakes": Object.freeze([0, .2, .6, .65, 1]),
  "The Black Hand": Object.freeze([0, .25, .3, .4, .6, .75, .8, 1]),
  Tetrads: Object.freeze([0, .25, .4, .6, 1]),
  Daedalus: Object.freeze([0, .25, .4, .6, .9, 1]),
  default: Object.freeze([0, .25, .4, .6, 1]),
});
// SOURCE_FAITHFUL_POLICY_END

const AI_POLICY_CACHE_SLOTS = 2048;
let AI_POLICY_CACHE_HASHES = null;
let AI_POLICY_CACHE_AVAILABLE = null;
let AI_POLICY_CACHE_POSITIONS = null;
let AI_POLICY_CACHE_CASCADES = null;
let AI_POLICY_CACHE_ALTERNATIVES = null;
let AI_POLICY_CACHE_OPPONENTS = null;
let AI_POLICY_CACHE_STATUS = null;
let AI_POLICY_CACHE_FLAGS = null;
let AI_POLICY_CACHE_PROBS = null;
let AI_POLICY_CACHE_TERMINAL_RISK_PROBS = null;
const AI_POLICY_CACHE_MISS = {};
let AI_POLICY_CACHE_HITS = 0;
let AI_POLICY_CACHE_MISSES = 0;
const SEARCH_SNAPSHOT_MAGIC = 0x59494348;
const SEARCH_SNAPSHOT_HEADER_BYTES = 24;
const SEARCH_SNAPSHOT_NODE_BYTES = 80;
const SEARCH_SNAPSHOT_EDGE_BYTES = 56;
const SEARCH_SNAPSHOT_PENDING_BYTES = 12;
const SEARCH_DELTA_MAGIC = 0x5949444C;
const SEARCH_DELTA_HEADER_BYTES = 24;
const SEARCH_DELTA_MERGE_GAP = 8;
let WORKER_SHARED_SNAPSHOT = null;
// ============== 19x19 BOARD HELPERS (cheat layer support) ==============
// The previous 19x19 search engine has been removed; a different solver will
// be integrated for the big board. Retained here: the generic array-board
// helpers the host's playTwoMoves first-choice cheat layer uses on every
// board size, plus the flood-fill scratch they run on.
const Y19_EMPTY = 0, Y19_BLACK = 1, Y19_WHITE = 2, Y19_WALL = 3;
let Y19_SIZE = 0, Y19_NN = 0;
let Y19_NEIGH = null;   // Int16Array NN*4, -1 padded
let Y19_DIAG = null;    // Int16Array NN*4, -1 padded
let Y19_SOURCE_NEIGH = null; // N/E/S/W order used by the game AI
let Y19_STACK = null;   // Int32Array flood-fill stack
let Y19_GROUP = null;   // Int32Array collected group stones
let Y19_MARK = null;    // Int32Array generation marks (stones)
let Y19_LIBMARK = null; // Int32Array generation marks (liberties)
let Y19_ZOBRIST = null; // Uint32Array NN*4, one value per point/state
let Y19_ZOBRIST_SECOND = null;
let Y19_SEMEAI_ANALYSIS_CACHE = new Map();
let Y19_SEMEAI_ANALYSIS_QUEUE = [];
let Y19_SEMEAI_ANALYSIS_HEAD = 0;
let Y19_SEMEAI_ANALYSIS_SIZE = 0;
let Y19_SEMEAI_ANALYSIS_STAMP = 0;
let Y19_MARK_GEN = 0;
let Y19_GROUP_LEN = 0;
// Flood-fills the same-colored group at p. Returns its liberty count and
// leaves the group's stones in Y19_GROUP[0..Y19_GROUP_LEN). Y19_LAST_LIB
// holds one liberty of the group — for an atari group, the capture point.
let Y19_LAST_LIB = -1;
const Y19_CAPTURE_REFUTED = -1;
const Y19_CAPTURE_UNKNOWN = 0;
const Y19_CAPTURE_PROVEN = 1;

function y19MayStartSemeaiRead(followUpOnly, activeTarget) {
  return followUpOnly || activeTarget == null;
}

function y19BaitIsActive() {
  return BAITED != null || y19BaitFollowUp != null;
}

function y19ArmBait(owner, firstMove, expectKey, followUpMove) {
  if (y19BaitIsActive()) return false;
  y19LadderPlan = null;
  BAITED = firstMove;
  y19BaitOwner = owner;
  y19BaitFollowUp = { expectKey, move: followUpMove };
  return true;
}

function y19ResolveBaitFollowUp(board) {
  if (!y19BaitFollowUp) return null;
  const followUp = y19BaitFollowUp;
  const owner = y19BaitOwner ?? "ladder";
  y19BaitFollowUp = null;
  y19BaitOwner = null;
  BAITED = null;
  y19Configure(board.length);
  if (y19Key(y19CellsFromBoard(board)) !== followUp.expectKey) return null;
  const x = (followUp.move / board.length) | 0;
  const y = followUp.move % board.length;
  const label = "Ladder bait follow-up";
  return {
    coords: [x, y],
    msg: label + ": fill (" + x + "," + y + ")",
    telemetry: { type: "baitFollowUp", owner },
  };
}

// Play the forced follow-up to a removeRouter eye-kill: occupy the point we just
// vacated so the enemy stone can't come back. One-shot — either we take the spot
// now or we abandon it (the AI already refilled it, or the play would be
// suicide).
function y19ResolveRouterKill(board) {
  if (y19RouterKill == null) return null;
  const point = y19RouterKill;
  y19RouterKill = null;
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  if (cells[point] !== Y19_EMPTY) return null;          // AI refilled it -> abandon
  if (!y19TryPlay(cells, point, Y19_BLACK)) return null; // would be suicide -> abandon
  const x = (point / board.length) | 0, y = point % board.length;
  return {
    coords: [x, y],
    msg: "WallBreaker follow-up: occupy vacated (" + x + "," + y + ")",
    telemetry: { type: "routerKillFollowUp" },
  };
}

// Is the AI scheduled to take the remainder of our createBait NEXT turn? True
// exactly when the bait stone sits at one liberty and the modeled policy's
// FORCED reply on the current board removes it. That reply makes our current
// move free in tempo — the window the bait-conversion checks exploit.
function y19CreateBaitCapturePending(board, historyKeys) {
  if (BAITED == null || y19BaitOwner !== "createBait") return null;
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  if (cells[BAITED] !== Y19_BLACK) return null;
  if (y19GroupLibs(cells, BAITED) !== 1) return null;
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const legal = y19LegalChildren(cells, Y19_WHITE, history);
  const policy = y19ResolveUnknownOpponentPolicy(
    cells,
    legal.map(child => child.point),
    Y19_WHITE,
    false
  );
  if (!policy.forced) return null;
  const reply = legal.find(child => child.point === policy.forcedPosition);
  if (!reply || reply.cells[BAITED] === Y19_BLACK) return null;
  return { baitPoint: BAITED, capturePoint: policy.forcedPosition };
}

// Round-robin split for the balanced read dispatcher (task i -> slice i % N):
// even sizes, nothing dropped or duplicated, heavy head tasks spread out.
function y19SplitTasksRoundRobin(tasks, sliceCount) {
  const active = Math.max(1, Math.min(Math.floor(sliceCount), tasks.length));
  const slices = Array.from({ length: active }, () => []);
  for (let index = 0; index < tasks.length; index++) {
    slices[index % active].push(tasks[index]);
  }
  return slices;
}

// Live read config shipped with every worker request — workers are separate
// instances holding the file defaults, so runtime changes must be forwarded.
function y19WorkerRuntimeSnapshot() {
  return {
    playouts: PLAYOUTS,
    maxActiveNodesPerWorker: MAX_ACTIVE_SEARCH_NODES_PER_WORKER,
    semeaiCommitSafety: Y19_SEMEAI_COMMIT_SAFETY,
    semeaiTerminalSafety: Y19_SEMEAI_TERMINAL_SAFETY,
    ladderTerminalSafety: Y19_LADDER_TERMINAL_SAFETY,
    semeaiMinTarget: Y19_SEMEAI_MIN_TARGET_STONES,
    semeaiLibs: Y19_SEMEAI_MAX_LIBERTIES,
    ownForcedPrefix: Y19_OWN_FORCED_PREFIX,
    ladderBait2lib: Y19_LADDER_BAIT_2LIB,
    ladderMaximize: Y19_LADDER_MAXIMIZE,
  };
}

function y19ApplyWorkerRuntime(runtime) {
  if (!runtime) return;
  if (Number.isFinite(runtime.playouts) && runtime.playouts > 0) {
    PLAYOUTS = Math.floor(runtime.playouts);
  }
  if (Number.isFinite(runtime.maxActiveNodesPerWorker) &&
    runtime.maxActiveNodesPerWorker > 0) {
    MAX_ACTIVE_SEARCH_NODES_PER_WORKER =
      Math.floor(runtime.maxActiveNodesPerWorker);
  }
  if (runtime.semeaiCommitSafety !== undefined) {
    Y19_SEMEAI_COMMIT_SAFETY = !!runtime.semeaiCommitSafety;
  }
  if (runtime.semeaiTerminalSafety !== undefined) {
    Y19_SEMEAI_TERMINAL_SAFETY = !!runtime.semeaiTerminalSafety;
  }
  if (runtime.ladderTerminalSafety !== undefined) {
    Y19_LADDER_TERMINAL_SAFETY = !!runtime.ladderTerminalSafety;
  }
  if (runtime.semeaiMinTarget !== undefined) {
    Y19_SEMEAI_MIN_TARGET_STONES = runtime.semeaiMinTarget;
  }
  if (runtime.semeaiLibs !== undefined) {
    Y19_SEMEAI_MAX_LIBERTIES = runtime.semeaiLibs;
  }
  if (runtime.ownForcedPrefix !== undefined) {
    Y19_OWN_FORCED_PREFIX = runtime.ownForcedPrefix;
  }
  if (runtime.ladderBait2lib !== undefined) {
    Y19_LADDER_BAIT_2LIB = !!runtime.ladderBait2lib;
  }
  if (runtime.ladderMaximize !== undefined) {
    Y19_LADDER_MAXIMIZE = !!runtime.ladderMaximize;
  }
}

// Rows-of-strings board from a cells array (inverse of y19CellsFromBoard).
function y19RowsFromCells(cells) {
  const rows = [];
  for (let x = 0; x < Y19_SIZE; x++) {
    let row = "";
    for (let y = 0; y < Y19_SIZE; y++) {
      const value = cells[x * Y19_SIZE + y];
      row += value === Y19_BLACK
        ? "X"
        : value === Y19_WHITE
          ? "O"
          : value === Y19_EMPTY
            ? "."
            : "#";
    }
    rows.push(row);
  }
  return rows;
}

function configureProgressiveWidening(opponent) {
  const [base, scale] = PROGRESSIVE_WIDENING_OVERRIDE ?? PROGRESSIVE_WIDENING_BY_OPPONENT[opponent] ?? [12, 1.5];
  PROGRESSIVE_WIDENING_BASE = base;
  PROGRESSIVE_WIDENING_SCALE = scale;
  EXPLORATION_PARAMETER =
    EXPLORATION_PARAMETER_OVERRIDE ??
    EXPLORATION_PARAMETER_BY_OPPONENT[opponent] ??
    0.3;
  SEARCH_KOMI = KOMI_BY_OPPONENT[opponent] ?? 5.5;
}

function requireSupportedBoardSize(size) {
  if (size !== 5) {
    throw new Error(`This solver is specialized for 5x5 boards, received ${size}x${size}`);
  }
}

/** @param {string[][] | string[]} board
  * @param {boolean} blackToPlay */
function zobristHash(board, blackToPlay) {
  if (BOARD_SIZE !== 5) {
    // Big-board position key: the exact board as a digit string, matching
    // y19Key's encoding (0 empty, 1 black, 2 white, 3 wall).
    let s = "";
    for (let x = 0; x < BOARD_SIZE; ++x) {
      for (let y = 0; y < BOARD_SIZE; ++y) {
        const ch = board[x][y];
        s += ch === "X" ? "1" : ch === "O" ? "2" : ch === "#" ? "3" : "0";
      }
    }
    return s;
  }
  let black = 0;
  let white = 0;
  for (var x = 0; x < BOARD_SIZE; ++x) {
    for (var y = 0; y < BOARD_SIZE; ++y) {
      const bit = 1 << (BOARD_SIZE * x + y);
      if (board[x][y] === 'X') black |= bit;
      else if (board[x][y] === 'O') white |= bit;
    }
  }
  const positionKey = positionKeyBits5(black, white);
  return blackToPlay ? stateKey5(positionKey, true, false) : positionKey;
}

/** @param {Int8Array} board
  * @param {boolean} blackToPlay */
function zobristHashLinear(board, blackToPlay) {
  let black = 0;
  let white = 0;
  for (var pos = 0; pos < BOARD_SIZE * BOARD_SIZE; ++pos) {
    const bit = 1 << pos;
    if (board[pos] === 1) black |= bit;
    else if (board[pos] === 2) white |= bit;
  }
  const positionKey = positionKeyBits5(black, white);
  return blackToPlay ? stateKey5(positionKey, true, false) : positionKey;
}

function positionKeyBits5(black, white) {
  return black * POSITION_KEY_STRIDE_5 + white;
}

function stateKey5(positionKey, blackToPlay, lastPassed) {
  return positionKey * 4 + (blackToPlay ? 2 : 0) + (lastPassed ? 1 : 0);
}

function positionKeyFromState5(stateKey) {
  return Math.floor(stateKey / 4);
}

function mixExactKey5(key) {
  const low = key | 0;
  const high = Math.floor(key / 0x100000000) | 0;
  return Math.imul(low ^ (low >>> 16) ^ high, 0x45D9F3B);
}

/**
 * @param {string[][]} board
 * @param {Int8Array} buf optional buffer to store linear board into
 * @return {Int8Array} linearized board (buf if provided, newly allocated otherwise)
 */
function linearizeBoard(board, buf) {
  buf ??= new Int8Array(BOARD_SIZE * BOARD_SIZE);
  for (let x = 0; x < BOARD_SIZE; ++x) {
    for (let y = 0; y < BOARD_SIZE; ++y) {
      switch (board[x][y]) {
        case '#': buf[BOARD_SIZE * x + y] = -1; break;
        case '.': buf[BOARD_SIZE * x + y] = 0; break;
        case 'X': buf[BOARD_SIZE * x + y] = 1; break;
        case 'O': buf[BOARD_SIZE * x + y] = 2; break;
        default: throw new Error('Unrecognized character on board (wrong board size?)');
      }
    }
  }
  return buf;
}

/**
 * @param {Int8Array} linearBoard
 * @return {string[][]} delinearized board
 */
function deLinearizeBoard(linearBoard) {
  let board = [];
  for (let x = 0; x < BOARD_SIZE; ++x) {
    board.push([]);
    for (let y = 0; y < BOARD_SIZE; ++y) {
      switch (linearBoard[BOARD_SIZE * x + y]) {
        case -1: board[x][y] = '#'; break;
        case 0: board[x][y] = '.'; break;
        case 1: board[x][y] = 'X'; break;
        case 2: board[x][y] = 'O'; break;
        default: throw new Error('Unrecognized character on board (wrong board size?)');
      }
    }
  }
  return board;
}

function getMoveScratch(length) {
  if (MOVE_SCRATCH?.length === length) return MOVE_SCRATCH;
  return MOVE_SCRATCH = { length, sourceBits: new Int32Array(3), nextBits: new Int32Array(3), };
}

function getNodeExpansionScratch(length) {
  if (NODE_EXPANSION_SCRATCH?.length === length) return NODE_EXPANSION_SCRATCH;
  return NODE_EXPANSION_SCRATCH = {
    length,
    board: new Int8Array(length),
    sourceLiberties: new Int8Array(length),
    liberties: new Int8Array(length),
    sourceBits: new Int32Array(3),
    nextBits: new Int32Array(3),
    candidatePositions: new Int16Array(length + 1),
    candidateHashes: new Float64Array(length + 1),
    candidateOrder: new Float64Array(length + 1),
    tierOrder: new Float64Array(length + 1),
  };
}

function getLibertiesLinear(board, liberties) {
  const bits = boardToBitboards5(board, getMoveScratch(board.length).sourceBits);
  fillLiberties5(bits[0], bits[1], bits[2], liberties);
}

/** 
 * @param {Int8Array} position 
 * @param {boolean} immediate if true, scores the board immediately (without removing dead stones)
 * */
function scoreTerminalLinear(board, immediate) {
  const bits = boardToBitboards5(board, getTerritoryScratch(25).sourceBits);
  return scoreTerminalBits5(bits[0], bits[1], bits[2], immediate);
}

function boardToBitboards5(board, output) {
  let black = 0;
  let white = 0;
  let offline = 0;
  for (let pos = 0; pos < 25; pos++) {
    const bit = 1 << pos;
    if (board[pos] === 1) black |= bit;
    else if (board[pos] === 2) white |= bit;
    else if (board[pos] === -1) offline |= bit;
  }
  output[0] = black;
  output[1] = white;
  output[2] = offline;
  return output;
}

function neighborBits5(bits) {
  return (((bits & ~BITBOARD_COL0_5) >>> 1) | ((bits & ~BITBOARD_COL4_5) << 1) | (bits >>> 5) | (bits << 5)) & BITBOARD_FULL_5;
}

function groupBits5(stoneMask, startBit) {
  let group = startBit;
  while (true) {
    const expanded = group | (neighborBits5(group) & stoneMask);
    if (expanded === group) return group;
    group = expanded;
  }
}

function popcount32(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
}

function fillLiberties5(black, white, offline, liberties) {
  liberties.fill(-1);
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  for (let colorIndex = 0; colorIndex < 2; colorIndex++) {
    const stones = colorIndex === 0 ? black : white;
    let remaining = stones;
    while (remaining) {
      const first = remaining & -remaining;
      const group = groupBits5(stones, first);
      const libertyCount = popcount32(neighborBits5(group) & empty);
      let groupStones = group;
      while (groupStones) {
        const bit = groupStones & -groupStones;
        liberties[31 - Math.clz32(bit)] = libertyCount;
        groupStones ^= bit;
      }
      remaining &= ~group;
    }
  }
}

function addMoveBitboard5(board, nextBoard, x, y, blackToPlay, black, white, offline, nextLibertiesOut = null, nextBitsOut = null) {
  const playedPos = 5 * x + y;
  const playedBit = 1 << playedPos;
  if ((black | white | offline) & playedBit) return false;
  let own = blackToPlay ? black : white;
  let enemy = blackToPlay ? white : black;
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  const adjacent = neighborBits5(playedBit);
  let legal = !!(adjacent & empty);
  let captures = 0;

  let adjacentOwn = adjacent & own;
  while (adjacentOwn) {
    const first = adjacentOwn & -adjacentOwn;
    const group = groupBits5(own, first);
    if (popcount32(neighborBits5(group) & empty) > 1) legal = true;
    adjacentOwn &= ~group;
  }

  let adjacentEnemy = adjacent & enemy;
  while (adjacentEnemy) {
    const first = adjacentEnemy & -adjacentEnemy;
    const group = groupBits5(enemy, first);
    if (popcount32(neighborBits5(group) & empty) === 1) {
      legal = true;
      captures |= group;
    }
    adjacentEnemy &= ~group;
  }
  if (!legal) return false;

  own |= playedBit;
  enemy &= ~captures;
  const nextBlack = blackToPlay ? own : enemy;
  const nextWhite = blackToPlay ? enemy : own;
  nextBoard.set(board);
  nextBoard[playedPos] = blackToPlay ? 1 : 2;
  let capturedBits = captures;
  while (capturedBits) {
    const bit = capturedBits & -capturedBits;
    nextBoard[31 - Math.clz32(bit)] = 0;
    capturedBits ^= bit;
  }

  if (nextLibertiesOut) {
    fillLiberties5(nextBlack, nextWhite, offline, nextLibertiesOut);
  }
  if (nextBitsOut) {
    nextBitsOut[0] = nextBlack;
    nextBitsOut[1] = nextWhite;
    nextBitsOut[2] = offline;
  }
  return true;
}

function isLegalMoveBits5(position, blackToPlay, black, white, offline) {
  const playedBit = 1 << position;
  if ((black | white | offline) & playedBit) return false;
  const own = blackToPlay ? black : white;
  const enemy = blackToPlay ? white : black;
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  const adjacent = neighborBits5(playedBit);
  if (adjacent & empty) return true;

  let adjacentOwn = adjacent & own;
  while (adjacentOwn) {
    const first = adjacentOwn & -adjacentOwn;
    const group = groupBits5(own, first);
    if (popcount32(neighborBits5(group) & empty) > 1) return true;
    adjacentOwn &= ~group;
  }

  let adjacentEnemy = adjacent & enemy;
  while (adjacentEnemy) {
    const first = adjacentEnemy & -adjacentEnemy;
    const group = groupBits5(enemy, first);
    if (popcount32(neighborBits5(group) & empty) === 1) return true;
    adjacentEnemy &= ~group;
  }
  return false;
}

function getTerritoryScratch(length) {
  if (TERRITORY_SCRATCH?.length === length) return TERRITORY_SCRATCH;
  return TERRITORY_SCRATCH = { length, controlled: new Int8Array(length), sourceBits: new Int32Array(3), controlledBits: new Int32Array(2), };
}

function getTerritoryBits5(black, white, offline, output) {
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  let remaining = empty;
  let controlledBlack = 0;
  let controlledWhite = 0;

  while (remaining) {
    const first = remaining & -remaining;
    const region = groupBits5(empty, first);
    remaining &= ~region;

    // Match the game's scoring guard for nearly empty boards.
    if (popcount32(region) > 22) continue;

    const border = neighborBits5(region);
    const touchesBlack = !!(border & black);
    const touchesWhite = !!(border & white);
    if (touchesBlack && !touchesWhite) controlledBlack |= region;
    else if (touchesWhite && !touchesBlack) controlledWhite |= region;
  }
  output[0] = controlledBlack;
  output[1] = controlledWhite;
  return output;
}

function rawTerminalMarginBits5(black, white, offline) {
  const territory = getTerritoryBits5(black, white, offline, getTerritoryScratch(25).controlledBits);
  const blackScore = popcount32(black) + popcount32(territory[0]);
  const whiteScore = popcount32(white) + popcount32(territory[1]);
  return blackScore - whiteScore;
}

function searchUtilityFromRawMargin(rawMargin) {
  const margin = rawMargin - SEARCH_KOMI;
  if (margin > 0) {
    return SEARCH_WIN_UTILITY + margin * SEARCH_MARGIN_UTILITY_SCALE;
  }
  if (margin < 0) {
    return -SEARCH_WIN_UTILITY + margin * SEARCH_MARGIN_UTILITY_SCALE;
  }
  return 0;
}

function scoreTerminalBits5(black, white, offline, _immediate) {
  return searchUtilityFromRawMargin(
    rawTerminalMarginBits5(black, white, offline)
  );
}

function getTerritory(board) {
  const scratch = getTerritoryScratch(board.length);
  const { controlled } = scratch;
  const bits = boardToBitboards5(board, scratch.sourceBits);
  const territory = getTerritoryBits5(bits[0], bits[1], bits[2], scratch.controlledBits);
  for (let pos = 0; pos < 25; pos++) {
    const bit = 1 << pos;
    controlled[pos] = board[pos] === -1
      ? -1
      : territory[0] & bit
        ? 1
        : territory[1] & bit
          ? 2
          : 0;
  }
  return controlled;
}

function createLibertiesLinear(board) {
  const liberties = new Int8Array(board.length);
  getLibertiesLinear(board, liberties);
  return liberties;
}

// Sized so worst-case long playouts (up to MAXITERATIONS adds) stay at a
// low load factor; near-full linear probing degrades sharply.
function getHistoryScratch(capacity = 2048) {
  if (HISTORY_SCRATCH?.capacity === capacity) return HISTORY_SCRATCH;
  return HISTORY_SCRATCH = {
    capacity,
    mask: capacity - 1,
    keys: new Float64Array(capacity),
    stamps: new Uint32Array(capacity),
    generation: 0,
  };
}

function getSearchPathScratch(capacity) {
  if (!SEARCH_PATH_SCRATCH || SEARCH_PATH_SCRATCH.path.length < capacity) {
    SEARCH_PATH_SCRATCH = { path: new Array(capacity), selected: new Array(capacity), previousSum: new Float64Array(capacity), previousSquaredSum: new Float64Array(capacity), };
  }
  return SEARCH_PATH_SCRATCH;
}

class ExactHistorySet5 {
  constructor(values) {
    let capacity = 8;
    while (capacity < values.length * 2) capacity <<= 1;
    this.mask = capacity - 1;
    this.keys = new Float64Array(capacity);
    for (const value of values) this.add(value);
  }

  add(hash) {
    const key = hash + 1;
    let index = mixExactKey5(hash) & this.mask;
    while (this.keys[index] && this.keys[index] !== key) {
      index = (index + 1) & this.mask;
    }
    this.keys[index] = key;
  }

  has(hash) {
    const key = hash + 1;
    let index = mixExactKey5(hash) & this.mask;
    while (this.keys[index]) {
      if (this.keys[index] === key) return true;
      index = (index + 1) & this.mask;
    }
    return false;
  }
}

class LayeredHistory {
  constructor(baseHistory) {
    this.baseHistory = baseHistory;
    this.scratch = getHistoryScratch();
    this.reset();
  }

  reset() {
    this.generation = this.scratch.generation = (this.scratch.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.scratch.stamps.fill(0);
      this.generation = this.scratch.generation = 1;
    }
    this.lastMissHash = undefined;
    this.lastMissIndex = 0;
  }

  has(hash) {
    if (this.baseHistory.has(hash)) return true;
    const { keys, stamps, mask } = this.scratch;
    let index = mixExactKey5(hash) & mask;
    while (stamps[index] === this.generation) {
      if (keys[index] === hash) return true;
      index = (index + 1) & mask;
    }
    return false;
  }

  // Rollout variant: remembers the free slot on a miss so the add of the
  // same hash (the accepted move) skips re-mixing and re-probing. Kept out
  // of has() because the selection loop calls that far more often.
  hasTrackMiss(hash) {
    if (this.baseHistory.has(hash)) return true;
    const { keys, stamps, mask } = this.scratch;
    let index = mixExactKey5(hash) & mask;
    while (stamps[index] === this.generation) {
      if (keys[index] === hash) return true;
      index = (index + 1) & mask;
    }
    this.lastMissHash = hash;
    this.lastMissIndex = index;
    return false;
  }

  add(hash) {
    if (this.baseHistory.has(hash)) return this;
    const { keys, stamps, mask } = this.scratch;
    let index;
    if (this.lastMissHash === hash &&
      stamps[this.lastMissIndex] !== this.generation) {
      index = this.lastMissIndex;
    } else {
      index = mixExactKey5(hash) & mask;
      while (stamps[index] === this.generation) {
        if (keys[index] === hash) return this;
        index = (index + 1) & mask;
      }
    }
    stamps[index] = this.generation;
    keys[index] = hash;
    return this;
  }
}

function passAliveMask5(friendly, enemy, offline) {
  if (!friendly) return 0;
  const empty = BITBOARD_FULL_5 & ~(friendly | enemy | offline);

  let chainCount = 0;
  let remaining = friendly;
  while (remaining) {
    const seed = remaining & -remaining;
    const chain = groupBits5(friendly, seed);
    BENSON_CHAINS[chainCount] = chain;
    BENSON_CHAIN_LIBS[chainCount] = neighborBits5(chain) & empty;
    chainCount++;
    remaining &= ~chain;
  }

  const regionSpace = BITBOARD_FULL_5 & ~friendly & ~offline;
  let regionCount = 0;
  remaining = regionSpace;
  while (remaining) {
    const seed = remaining & -remaining;
    const region = groupBits5(regionSpace, seed);
    BENSON_REGION_EMPTY[regionCount] = region & empty;
    let adjacent = 0;
    const border = neighborBits5(region);
    for (let index = 0; index < chainCount; index++) {
      if (border & BENSON_CHAINS[index]) adjacent |= 1 << index;
    }
    BENSON_REGION_CHAINS[regionCount] = adjacent;
    regionCount++;
    remaining &= ~region;
  }

  let aliveChains = (1 << chainCount) - 1;
  let aliveRegions = (1 << regionCount) - 1;
  while (true) {
    let changed = false;
    for (let c = 0; c < chainCount; c++) {
      if (!(aliveChains & (1 << c))) continue;
      let vital = 0;
      for (let r = 0; r < regionCount; r++) {
        if (!(aliveRegions & (1 << r))) continue;
        if ((BENSON_REGION_EMPTY[r] & ~BENSON_CHAIN_LIBS[c]) === 0 &&
          (BENSON_REGION_CHAINS[r] & (1 << c))) {
          vital++;
          if (vital >= 2) break;
        }
      }
      if (vital < 2) {
        aliveChains &= ~(1 << c);
        changed = true;
      }
    }
    for (let r = 0; r < regionCount; r++) {
      if (!(aliveRegions & (1 << r))) continue;
      if (BENSON_REGION_CHAINS[r] & ~aliveChains) {
        aliveRegions &= ~(1 << r);
        changed = true;
      }
    }
    if (!changed) break;
  }

  let mask = 0;
  for (let c = 0; c < chainCount; c++) {
    if (aliveChains & (1 << c)) mask |= BENSON_CHAINS[c];
  }
  return mask;
}

// A position where every stone is pass-alive and every empty region is
// single-color territory cannot change under any continuation: score it
// statically instead of rolling it out. Returns null when not settled.
function settledTerminalUtility5(black, white, offline) {
  // Settled positions need a nearly full board; one popcount gates the
  // Benson work away from the mid-game hot path.
  if (popcount32(black | white | offline) < 20) return null;
  if (passAliveMask5(black, white, offline) !== black) return null;
  if (passAliveMask5(white, black, offline) !== white) return null;
  const territory = getTerritoryBits5(
    black,
    white,
    offline,
    getTerritoryScratch(25).controlledBits
  );
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  if ((empty & ~(territory[0] | territory[1])) !== 0) return null;
  return searchUtilityFromRawMargin(
    popcount32(black) + popcount32(territory[0]) -
    popcount32(white) - popcount32(territory[1])
  );
}

// Empty points that are one of OUR own real single-point eyes: fully enclosed
// by our own stones (or walls) with no empty and no enemy orthogonal neighbor.
// A play there captures nothing and only removes a liberty/eye of a living own
// group, so filling it is never correct — the root uses this to veto self-eye
// fills and pass instead (passing forfeits a smaller margin than self-capture).
function ownRealEyeFillMask5(black, white, offline, playerIsBlack) {
  const friendly = playerIsBlack ? black : white;
  const enemy = playerIsBlack ? white : black;
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  let mask = 0;
  let remaining = empty;
  while (remaining) {
    const point = remaining & -remaining;
    remaining ^= point;
    const around = neighborBits5(point);
    if ((around & empty) === 0 &&
      (around & enemy) === 0 &&
      (around & friendly) !== 0) {
      mask |= point;
    }
  }
  return mask;
}

function seedRolloutRng(seed) {
  ROLLOUT_RNG_STATE = (seed | 0) || 0x9E3779B1;
}

function rolloutRandom() {
  let state = ROLLOUT_RNG_STATE | 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  ROLLOUT_RNG_STATE = state;
  return (state >>> 0) / 4294967296;
}

function getFastPlayoutScratch() {
  const length = BOARD_SIZE * BOARD_SIZE;
  if (FAST_PLAYOUT_SCRATCH?.length === length) return FAST_PLAYOUT_SCRATCH;

  FAST_PLAYOUT_SCRATCH = {
    length,
    sourceBits: new Int32Array(3),
    nextBits: new Int32Array(3),
    analysis: new Int32Array(2),
    blackGroups: {
      masks: new Int32Array(25),
      liberties: new Int32Array(25),
      capturesByPosition: new Int32Array(25),
      captureStamps: new Uint32Array(25),
      captureGeneration: 0,
      count: 0,
      allLiberties: 0,
      healthyLiberties: 0,
      atariLiberties: 0,
    },
    whiteGroups: {
      masks: new Int32Array(25),
      liberties: new Int32Array(25),
      capturesByPosition: new Int32Array(25),
      captureStamps: new Uint32Array(25),
      captureGeneration: 0,
      count: 0,
      allLiberties: 0,
      healthyLiberties: 0,
      atariLiberties: 0,
    },
  };
  return FAST_PLAYOUT_SCRATCH;
}

function resetRolloutAggregates5(state) {
  state.allLiberties = 0;
  state.healthyLiberties = 0;
  state.atariLiberties = 0;
  state.captureGeneration = (state.captureGeneration + 1) >>> 0;
  if (!state.captureGeneration) {
    state.captureStamps.fill(0);
    state.captureGeneration = 1;
  }
}

function addRolloutAggregate5(state, group, liberties) {
  state.allLiberties |= liberties;
  if (liberties && !(liberties & (liberties - 1))) {
    state.atariLiberties |= liberties;
    const position = 31 - Math.clz32(liberties);
    if (state.captureStamps[position] !== state.captureGeneration) {
      state.captureStamps[position] = state.captureGeneration;
      state.capturesByPosition[position] = group;
    } else {
      state.capturesByPosition[position] |= group;
    }
  } else {
    state.healthyLiberties |= liberties;
  }
}

function rolloutCapturesAt5(state, position) {
  return state.captureStamps[position] === state.captureGeneration
    ? state.capturesByPosition[position]
    : 0;
}

function rebuildRolloutGroups5(stones, empty, state) {
  resetRolloutAggregates5(state);
  let remaining = stones;
  let count = 0;
  while (remaining) {
    const first = remaining & -remaining;
    const group = groupBits5(stones, first);
    remaining &= ~group;
    const liberties = neighborBits5(group) & empty;
    state.masks[count] = group;
    state.liberties[count] = liberties;
    addRolloutAggregate5(state, group, liberties);
    count++;
  }
  state.count = count;
}

function updateRolloutGroups5(
  ownState,
  enemyState,
  playedBit,
  captures,
  nextEmpty
) {
  const adjacent = neighborBits5(playedBit);
  let merged = playedBit;
  let write = 0;
  const ownCount = ownState.count;
  resetRolloutAggregates5(ownState);
  for (let index = 0; index < ownCount; index++) {
    const group = ownState.masks[index];
    if (group & adjacent) {
      merged |= group;
    } else {
      const liberties = neighborBits5(group) & nextEmpty;
      ownState.masks[write] = group;
      ownState.liberties[write] = liberties;
      addRolloutAggregate5(ownState, group, liberties);
      write++;
    }
  }
  const mergedLiberties = neighborBits5(merged) & nextEmpty;
  ownState.masks[write] = merged;
  ownState.liberties[write] = mergedLiberties;
  addRolloutAggregate5(ownState, merged, mergedLiberties);
  ownState.count = write + 1;

  write = 0;
  const enemyCount = enemyState.count;
  resetRolloutAggregates5(enemyState);
  for (let index = 0; index < enemyCount; index++) {
    const group = enemyState.masks[index];
    if (group & captures) continue;
    const liberties = neighborBits5(group) & nextEmpty;
    enemyState.masks[write] = group;
    enemyState.liberties[write] = liberties;
    addRolloutAggregate5(enemyState, group, liberties);
    write++;
  }
  enemyState.count = write;
}

function rolloutConnectedGroup5(state, playedBit) {
  const adjacent = neighborBits5(playedBit);
  let merged = playedBit;
  for (let index = 0; index < state.count; index++) {
    const group = state.masks[index];
    if (group & adjacent) merged |= group;
  }
  return merged;
}

function analyzeRolloutMoves5(
  ownState,
  enemyState,
  empty,
  output
) {
  const adjacentEmpty = neighborBits5(empty) & empty;
  const fillsEye = empty & ~adjacentEmpty &
    ~(ownState.atariLiberties | enemyState.allLiberties);
  const legal = adjacentEmpty |
    ownState.healthyLiberties |
    enemyState.atariLiberties;
  output[0] = legal & ~fillsEye & empty;
  output[1] = ownState.healthyLiberties;
  return output;
}

function applyAnalyzedRolloutMove5(
  pos,
  blackToPlay,
  black,
  white,
  offline,
  captures,
  nextBitsOut
) {
  const playedBit = 1 << pos;
  let own = (blackToPlay ? black : white) | playedBit;
  let enemy = (blackToPlay ? white : black) & ~captures;
  nextBitsOut[0] = blackToPlay ? own : enemy;
  nextBitsOut[1] = blackToPlay ? enemy : own;
  nextBitsOut[2] = offline;
}

function fastPlayoutBits5(
  startBlack,
  startWhite,
  offline,
  blackToPlay,
  history,
  knownBoardHash = null
) {
  const scratch = getFastPlayoutScratch();
  let black = startBlack;
  let white = startWhite;
  let boardHash = knownBoardHash ?? positionKeyBits5(black, white);
  let lastPassed = false;
  const initialEmpty = BITBOARD_FULL_5 & ~(black | white | offline);
  rebuildRolloutGroups5(black, initialEmpty, scratch.blackGroups);
  rebuildRolloutGroups5(white, initialEmpty, scratch.whiteGroups);

  for (let iteration = 0; iteration < MAXITERATIONS; iteration++) {
    const ownGroups = blackToPlay ? scratch.blackGroups : scratch.whiteGroups;
    const enemyGroups = blackToPlay ? scratch.whiteGroups : scratch.blackGroups;
    const empty = BITBOARD_FULL_5 & ~(black | white | offline);
    const analysis = analyzeRolloutMoves5(
      ownGroups,
      enemyGroups,
      empty,
      scratch.analysis
    );
    let candidateBits = analysis[0];
    const healthyFriendlyConnections = analysis[1];
    let candidateCount = popcount32(candidateBits);

    while (candidateCount) {
      // Select a uniformly random set bit directly instead of extracting
      // every candidate into an array first.
      let skip = Math.floor(rolloutRandom() * candidateCount);
      let remainingBits = candidateBits;
      let playedBit = remainingBits & -remainingBits;
      while (skip--) {
        remainingBits ^= playedBit;
        playedBit = remainingBits & -remainingBits;
      }
      const pos = 31 - Math.clz32(playedBit);
      const captures = rolloutCapturesAt5(enemyGroups, pos);
      applyAnalyzedRolloutMove5(
        pos,
        blackToPlay,
        black,
        white,
        offline,
        captures,
        scratch.nextBits
      );
      const nextBlack = scratch.nextBits[0];
      const nextWhite = scratch.nextBits[1];
      const nextHash = positionKeyBits5(nextBlack, nextWhite);
      if (history.hasTrackMiss(nextHash)) {
        candidateBits ^= playedBit;
        candidateCount--;
        continue;
      }
      const nextEmpty = BITBOARD_FULL_5 & ~(nextBlack | nextWhite | offline);
      const playedGroup = rolloutConnectedGroup5(ownGroups, playedBit);
      if (popcount32(neighborBits5(playedGroup) & nextEmpty) === 1) {
        if (healthyFriendlyConnections & playedBit) {
          candidateBits ^= playedBit;
          candidateCount--;
          continue;
        }
      }

      updateRolloutGroups5(
        ownGroups,
        enemyGroups,
        playedBit,
        captures,
        nextEmpty
      );
      black = nextBlack;
      white = nextWhite;
      boardHash = nextHash;
      lastPassed = false;
      break;
    }

    if (!candidateCount) {
      if (lastPassed) break;
      lastPassed = true;
    }
    if ((blackToPlay ? white === 0 : black === 0) && iteration >= 2) break;
    blackToPlay = !blackToPlay;
    history.add(boardHash);
  }
  return scoreTerminalBits5(black, white, offline, false);
}

function fastPlayoutLinear(board, blackToPlay, history, knownBoardHash = null) {
  const bits = boardToBitboards5(board, getFastPlayoutScratch().sourceBits);
  return fastPlayoutBits5(
    bits[0],
    bits[1],
    bits[2],
    blackToPlay,
    history,
    knownBoardHash
  );
}

function boardFromKey5(positionKey, offline, out) {
  out ??= EXPANSION_BOARD_SCRATCH ??= new Int8Array(25);
  const black = Math.floor(positionKey / POSITION_KEY_STRIDE_5);
  const white = positionKey - black * POSITION_KEY_STRIDE_5;
  for (let pos = 0; pos < 25; pos++) {
    const bit = 1 << pos;
    out[pos] = black & bit ? 1 : white & bit ? 2 : offline & bit ? -1 : 0;
  }
  return out;
}

function moveName(x, y) {
  return 'ABCDEFGHJKLMNOPQRSTUVWXYZ'[x] + (y + 1);
}

function getEyeScratch() {
  return EYE_SCRATCH ??= {
    sourceBits: new Int32Array(3),
    eyeCounts: new Uint8Array(25),
  };
}

function getEyeProfileBits5(black, white, offline, color) {
  const scratch = getEyeScratch();
  const friendly = color === 1 ? black : white;
  const enemy = color === 1 ? white : black;
  const empty = BITBOARD_FULL_5 & ~(black | white | offline);
  const eyeCounts = scratch.eyeCounts;
  eyeCounts.fill(0);
  let checked = 0;
  let eyeRegions = 0;
  let remaining = friendly;

  while (remaining) {
    const first = remaining & -remaining;
    const root = 31 - Math.clz32(first);
    const chain = groupBits5(friendly, first);
    remaining &= ~chain;
    checked |= chain;
    let liberties = neighborBits5(chain) & empty;

    while (liberties) {
      const liberty = liberties & -liberties;
      liberties ^= liberty;
      if (checked & liberty) continue;
      const eye = groupBits5(empty, liberty);
      checked |= eye;
      let isEye = !(neighborBits5(eye) & enemy) && popcount32(eye) <= 11;
      if (isEye) {
        const otherFriendly = neighborBits5(eye) & friendly & ~chain;
        if (otherFriendly) {
          let reachable = otherFriendly;
          const traversable = empty | (friendly & ~chain);
          while (true) {
            const expanded = reachable | (neighborBits5(reachable) & traversable);
            if (expanded === reachable) break;
            reachable = expanded;
          }
          if (neighborBits5(reachable) & enemy) isEye = false;
        }
      }
      if (isEye) {
        eyeRegions++;
        eyeCounts[root]++;
      } else {
        checked &= ~eye;
      }
    }
  }

  let eyedGroups = 0;
  let livingGroups = 0;
  let livingMask = 0;
  for (let root = 0; root < 25; root++) {
    if (!eyeCounts[root]) continue;
    eyedGroups++;
    if (eyeCounts[root] >= 2) {
      livingGroups++;
      livingMask |= 1 << root;
    }
  }
  return { eyeRegions, eyedGroups, livingGroups, livingMask };
}

function getEyeProfileBitboard5(board, color) {
  const bits = boardToBitboards5(board, getEyeScratch().sourceBits);
  return getEyeProfileBits5(bits[0], bits[1], bits[2], color);
}

function getEyeProfileLinear(board, color) {
  return getEyeProfileBitboard5(board, color);
}

/**
 * @param {Int8Array} board
 */
function countWhiteEyesLinear(board) {
  return getEyeProfileLinear(board, 2).eyeRegions;
}

/** @param {string[]} pattern */
function rotate90Degrees(pattern) {
  return pattern.map((_value, index) => pattern.map((row) => row[index]).reverse().join(""));
}

/** @param {string[]} pattern */
function verticalMirror(pattern) {
  return pattern.toReversed();
}

/** @param {string[]} pattern */
function getAllPatterns(pattern) {
  const rotated90 = rotate90Degrees(pattern);
  const rotated180 = rotate90Degrees(rotated90);
  const rotations = [pattern, rotated90, rotated180, rotate90Degrees(rotated180),];
  return [...rotations, ...rotations.map(verticalMirror)];
}

function ensurePatternCache() {
  if (!AI_PATTERN_CACHE_KEYS) {
    AI_PATTERN_CACHE_KEYS = new Int32Array(AI_PATTERN_CACHE_SLOTS);
    AI_PATTERN_CACHE_VALUES = new Uint8Array(AI_PATTERN_CACHE_SLOTS);
  }
}

function patternCell(board, x, y) {
  if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) return undefined;
  const value = board[x * BOARD_SIZE + y];
  return value === -1 ? null : value;
}

function matchesPatternToken(token, value, player) {
  const opponent = 3 - player;
  if (token === "X") return value === player;
  if (token === "O") return value === opponent;
  if (token === "x") return value !== opponent;
  if (token === "o") return value !== player;
  if (token === ".") return value === 0;
  if (token === " ") return value === null;
  return token === "?";
}

function isPatternMoveLinear(board, x, y, player) {
  const neighborhood = [];
  let cacheKey = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const value = patternCell(board, x + dx, y + dy);
      neighborhood.push(value);

      let normalized = 0;
      if (value === null) normalized = 1;
      else if (value === 0) normalized = 2;
      else if (value === player) normalized = 3;
      else if (value === 3 - player) normalized = 4;
      cacheKey = cacheKey * 5 + normalized;
    }
  }

  const cacheSlot =
    (Math.imul(cacheKey, 0x9E3779B1) >>> 0) & (AI_PATTERN_CACHE_SLOTS - 1);
  const storedKey = cacheKey + 1;
  ensurePatternCache();
  if (AI_PATTERN_CACHE_KEYS[cacheSlot] === storedKey) {
    return AI_PATTERN_CACHE_VALUES[cacheSlot] === 2;
  }

  const matched = COMPILED_AI_PATTERNS.some((pattern) => {
    for (let index = 0; index < pattern.length; index++) {
      if (!matchesPatternToken(pattern[index], neighborhood[index], player)) return false;
    }
    return true;
  });

  AI_PATTERN_CACHE_KEYS[cacheSlot] = storedKey;
  AI_PATTERN_CACHE_VALUES[cacheSlot] = matched ? 2 : 1;
  return matched;
}

function getColorGroupsBitboard5(board, color) {
  const bits = boardToBitboards5(board, getEyeScratch().sourceBits);
  const colorMask = color === 1 ? bits[0] : bits[1];
  let remaining = colorMask;
  const groups = [];
  while (remaining) {
    const first = remaining & -remaining;
    const groupMask = groupBits5(colorMask, first);
    remaining &= ~groupMask;
    const stones = [];
    let groupStones = groupMask;
    while (groupStones) {
      const bit = groupStones & -groupStones;
      stones.push(31 - Math.clz32(bit));
      groupStones ^= bit;
    }

    const liberties = [];
    let libertyMask = 0;
    for (const pos of stones) {
      const x = (pos / 5) | 0;
      const y = pos % 5;
      for (const [dx, dy] of AI_DIRS) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= 5 || yy >= 5) continue;
        const next = 5 * xx + yy;
        const bit = 1 << next;
        if (board[next] === 0 && !(libertyMask & bit)) {
          libertyMask |= bit;
          liberties.push(next);
        }
      }
    }
    groups.push({ root: 32 - Math.clz32(first), stones, liberties, mask: groupMask, libertyMask, });
  }
  return groups;
}

function getColorGroupsLinear(board, color) {
  return getColorGroupsBitboard5(board, color);
}

function sourceAnalyzeBoard5(board) {
  const groupAt = new Int8Array(25);
  groupAt.fill(-1);
  const groups = [];
  const checked = SOURCE_ANALYZE_CHECKED;

  for (let start = 0; start < 25; start++) {
    if (board[start] === -1 || groupAt[start] >= 0) continue;
    const color = board[start];
    const points = [start];
    const stack = [start];
    checked.fill(0);
    checked[start] = 1;

    while (stack.length) {
      const current = stack.pop();
      for (const neighbor of SOURCE_AI_NEIGHBORS_5[current]) {
        if (board[neighbor] !== color || checked[neighbor]) continue;
        checked[neighbor] = 1;
        points.push(neighbor);
        stack.push(neighbor);
      }
    }

    const id = groups.length;
    for (const point of points) groupAt[point] = id;
    groups.push({ id, color, points, liberties: null });
  }

  const inGroup = SOURCE_ANALYZE_IN_GROUP;
  const seen = SOURCE_ANALYZE_SEEN;
  for (const group of groups) {
    inGroup.fill(0);
    seen.fill(0);
    for (const point of group.points) inGroup[point] = 1;
    const liberties = [];
    for (const point of group.points) {
      for (const neighbor of SOURCE_AI_NEIGHBORS_5[point]) {
        if (inGroup[neighbor] || seen[neighbor]) continue;
        seen[neighbor] = 1;
        if (board[neighbor] === 0) liberties.push(neighbor);
      }
    }
    group.liberties = liberties;
  }

  return { board, groups, groupAt };
}

function sourceOutsideNeighbors5(analysis, group) {
  const inGroup = SOURCE_OUTSIDE_IN_GROUP;
  const seen = SOURCE_OUTSIDE_SEEN;
  inGroup.fill(0);
  seen.fill(0);
  const result = [];
  for (const point of group.points) inGroup[point] = 1;
  for (const point of group.points) {
    for (const neighbor of SOURCE_AI_NEIGHBORS_5[point]) {
      if (inGroup[neighbor] || seen[neighbor]) continue;
      seen[neighbor] = 1;
      result.push(neighbor);
    }
  }
  return result;
}



function sourceNeighborGroups5(analysis, group) {
  const seen = SOURCE_NEIGHBOR_GROUP_SEEN;
  seen.fill(0, 0, analysis.groups.length);
  const result = [];
  for (const point of sourceOutsideNeighbors5(analysis, group)) {
    if (analysis.board[point] === 0 || analysis.board[point] === -1) continue;
    const groupId = analysis.groupAt[point];
    if (groupId < 0 || seen[groupId]) continue;
    seen[groupId] = 1;
    result.push(analysis.groups[groupId]);
  }
  return result;
}

function sourceChainSpread5(points) {
  let north = -1;
  let east = -1;
  let south = 5;
  let west = 5;
  for (const point of points) {
    const x = (point / 5) | 0;
    const y = point % 5;
    north = Math.max(north, y);
    east = Math.max(east, x);
    south = Math.min(south, y);
    west = Math.min(west, x);
  }
  return { north, east, south, west };
}

function sourceGroupEncirclesEye5(analysis, eyeGroup, neighbors, neighborIndex) {
  const candidateSpread = sourceChainSpread5(eyeGroup.points);
  const neighbor = neighbors[neighborIndex];
  const neighborSpread = sourceChainSpread5(neighbor.points);
  const boardMax = 4;
  const wrapsNorth = neighborSpread.north > candidateSpread.north ||
    (candidateSpread.north === boardMax && neighborSpread.north === boardMax);
  const wrapsEast = neighborSpread.east > candidateSpread.east ||
    (candidateSpread.east === boardMax && neighborSpread.east === boardMax);
  const wrapsSouth = neighborSpread.south < candidateSpread.south ||
    (candidateSpread.south === 0 && neighborSpread.south === 0);
  const wrapsWest = neighborSpread.west < candidateSpread.west ||
    (candidateSpread.west === 0 && neighborSpread.west === 0);
  if (!wrapsNorth || !wrapsEast || !wrapsSouth || !wrapsWest) return false;

  const evaluationBoard = new Int8Array(analysis.board);
  for (let index = 0; index < neighbors.length; index++) {
    if (index === neighborIndex) continue;
    for (const point of neighbors[index].points) evaluationBoard[point] = 0;
  }
  const evaluation = sourceAnalyzeBoard5(evaluationBoard);
  const mergedEye = evaluation.groups[evaluation.groupAt[eyeGroup.points[0]]];
  if (!mergedEye) return false;

  // The source deliberately asks for neighbors on the original board using
  // the expanded chain from the evaluation board.
  const inMergedEye = new Uint8Array(25);
  const seenGroups = new Uint8Array(analysis.groups.length);
  const originalNeighbors = [];
  for (const point of mergedEye.points) inMergedEye[point] = 1;
  for (const point of mergedEye.points) {
    for (const adjacent of SOURCE_AI_NEIGHBORS_5[point]) {
      if (inMergedEye[adjacent] || analysis.board[adjacent] <= 0) continue;
      const groupId = analysis.groupAt[adjacent];
      if (groupId < 0 || seenGroups[groupId]) continue;
      seenGroups[groupId] = 1;
      originalNeighbors.push(groupId);
    }
  }
  return originalNeighbors.length === 1 && originalNeighbors[0] === neighbor.id;
}

function sourcePotentialEyes5(analysis, player, maxSize = null) {
  const nodeCount = analysis.board.reduce(
    (count, value) => count + (value === -1 ? 0 : 1),
    0
  );
  const maximum = maxSize ?? Math.min(nodeCount * 0.4, 11);
  const result = [];
  for (const group of analysis.groups) {
    if (group.color !== 0 || group.points.length > maximum) continue;
    const neighbors = sourceNeighborGroups5(analysis, group);
    const hasWhite = neighbors.some((neighbor) => neighbor.color === 2);
    const hasBlack = neighbors.some((neighbor) => neighbor.color === 1);
    if ((player === 2 && hasWhite && !hasBlack) ||
      (player === 1 && hasBlack && !hasWhite)) {
      result.push({ group, neighbors });
    }
  }
  return result;
}

function sourceEyesByGroup5(analysis, player) {
  const eyes = new Map();
  for (const candidate of sourcePotentialEyes5(analysis, player)) {
    if (!candidate.neighbors.length) continue;
    if (candidate.neighbors.length === 1) {
      const groupId = candidate.neighbors[0].id;
      if (!eyes.has(groupId)) eyes.set(groupId, []);
      eyes.get(groupId).push(candidate.group.points);
      continue;
    }
    for (let index = 0; index < candidate.neighbors.length; index++) {
      if (!sourceGroupEncirclesEye5(
        analysis,
        candidate.group,
        candidate.neighbors,
        index
      )) {
        continue;
      }
      const groupId = candidate.neighbors[index].id;
      if (!eyes.has(groupId)) eyes.set(groupId, []);
      eyes.get(groupId).push(candidate.group.points);
    }
  }
  return eyes;
}

function sourceAvailableMoves5(board, legalPositions, player, smart) {
  const analysis = sourceAnalyzeBoard5(board);
  let available = legalPositions.slice();
  if (smart) {
    const claimed = new Uint8Array(25);
    for (const eyeSpaces of sourceEyesByGroup5(analysis, player).values()) {
      if (eyeSpaces.length < 2) continue;
      for (const eye of eyeSpaces) {
        for (const point of eye) claimed[point] = 1;
      }
    }
    available = available.filter((point) => !claimed[point]);
  }

  const enemy = player === 1 ? 2 : 1;
  const spaces = sourcePotentialEyes5(analysis, enemy);
  const insideEnemySpace = new Uint8Array(25);
  const playableInside = new Uint8Array(25);
  for (const space of spaces) {
    for (const point of space.group.points) insideEnemySpace[point] = 1;
    for (const neighboringChain of space.neighbors) {
      const liberties = neighboringChain.liberties;
      if (liberties.length > 4) continue;
      const neighboringGroups = sourceNeighborGroups5(analysis, neighboringChain);
      if (!neighboringGroups.some((group) => group.color === player)) continue;
      const inside = liberties.filter((point) =>
        analysis.groupAt[point] === space.group.id
      );
      if (inside.length !== liberties.length) continue;
      for (const point of inside) playableInside[point] = 1;
    }
  }

  available = available.filter((point) =>
    !insideEnemySpace[point] || playableInside[point]
  );
  return { analysis, available };
}

function sourceEffectiveLiberties5(analysis, move, player) {
  const all = [];
  for (const neighbor of SOURCE_AI_NEIGHBORS_5[move]) {
    if (analysis.board[neighbor] === 0) all.push(neighbor);
  }
  for (const neighbor of SOURCE_AI_NEIGHBORS_5[move]) {
    if (analysis.board[neighbor] !== player) continue;
    const group = analysis.groups[analysis.groupAt[neighbor]];
    if (group) all.push(...group.liberties);
  }
  const seen = new Uint8Array(25);
  const result = [];
  for (const liberty of all) {
    if (liberty === move || seen[liberty]) continue;
    seen[liberty] = 1;
    result.push(liberty);
  }
  return result;
}

function sourceWeakestAdjacentGroup5(analysis, move, color) {
  const neighboringGroups = [];
  for (const neighbor of SOURCE_AI_NEIGHBORS_5[move]) {
    if (analysis.board[neighbor] !== color) continue;
    neighboringGroups.push(analysis.groups[analysis.groupAt[neighbor]]);
  }
  if (!neighboringGroups.length) return null;
  let minimum = neighboringGroups[0].liberties.length;
  for (const group of neighboringGroups) {
    minimum = Math.min(minimum, group.liberties.length);
  }
  return neighboringGroups.find(
    (group) => group.liberties.length === minimum
  ) ?? null;
}

function sourceGrowthMoves5(analysis, player, available) {
  const allowed = new Uint8Array(25);
  for (const point of available) allowed[point] = 1;
  const result = [];
  for (const group of analysis.groups) {
    if (group.color !== player) continue;
    for (const move of group.liberties) {
      if (!allowed[move]) continue;
      const weakest = sourceWeakestAdjacentGroup5(analysis, move, player);
      const oldLibertyCount = weakest?.liberties.length ?? 99;
      const newLibertyCount =
        sourceEffectiveLiberties5(analysis, move, player).length;
      if (newLibertyCount > 1 && newLibertyCount >= oldLibertyCount) {
        result.push({ pos: move, oldLibertyCount, newLibertyCount });
      }
    }
  }
  return result;
}

function sourceMaximumGrowthMoves5(growthMoves, defendOnly = false) {
  const moves = defendOnly
    ? growthMoves.filter((move) =>
      move.oldLibertyCount <= 1 &&
      move.newLibertyCount > move.oldLibertyCount
    )
    : growthMoves;
  let maximum = -Infinity;
  for (const move of moves) {
    maximum = Math.max(
      maximum,
      move.newLibertyCount - move.oldLibertyCount
    );
  }
  if (defendOnly && maximum < 1) return [];
  return moves.filter((move) =>
    move.newLibertyCount - move.oldLibertyCount === maximum
  );
}

function sourceSurroundMove5(analysis, player, available, smart) {
  const enemy = player === 1 ? 2 : 1;
  const allowed = new Uint8Array(25);
  for (const point of available) allowed[point] = 1;
  const enemyLiberties = [];
  for (const group of analysis.groups) {
    if (group.color !== enemy) continue;
    for (const liberty of group.liberties) {
      if (allowed[liberty]) enemyLiberties.push(liberty);
    }
  }
  const capture = [];
  const atari = [];
  const surround = [];
  for (const move of enemyLiberties) {
    const newLibertyCount =
      sourceEffectiveLiberties5(analysis, move, player).length;
    const weakest = sourceWeakestAdjacentGroup5(analysis, move, enemy);
    const weakestLength = weakest?.points.length ?? 99;
    const enemyLibertyCount = weakest?.liberties.length ?? 99;
    const libertyRegions = new Set(
      (weakest?.liberties ?? []).map((point) => analysis.groupAt[point])
    );
    if (newLibertyCount <= 2 && enemyLibertyCount > 2) continue;
    const candidate = {
      pos: move,
      oldLibertyCount: enemyLibertyCount,
      newLibertyCount: enemyLibertyCount - 1,
    };
    if (enemyLibertyCount <= 1) {
      capture.push(candidate);
    } else if (
      enemyLibertyCount === 2 &&
      (
        newLibertyCount >= 2 ||
        (libertyRegions.size === 1 && weakestLength > 3) ||
        !smart
      )
    ) {
      atari.push(candidate);
    } else if (newLibertyCount >= 2) {
      surround.push(candidate);
    }
  }
  return capture[0] ?? atari[0] ?? surround[0] ?? null;
}

function sourceDisputedMoves5(analysis, available, maxChainSize = 99) {
  const result = [];
  for (const point of available) {
    const emptyGroup = analysis.groups[analysis.groupAt[point]];
    if (!emptyGroup || emptyGroup.points.length > maxChainSize) continue;
    const neighbors = sourceNeighborGroups5(analysis, emptyGroup)
      .filter((group) => group.points.length <= maxChainSize);
    if (neighbors.some((group) => group.color === 1) &&
      neighbors.some((group) => group.color === 2)) {
      result.push(point);
    }
  }
  return result;
}

function sourceExpansionMoves5(analysis, available) {
  const open = available.filter((point) =>
    SOURCE_AI_NEIGHBORS_5[point].length === 4 &&
    SOURCE_AI_NEIGHBORS_5[point].every(
      (neighbor) => analysis.board[neighbor] === 0
    )
  );
  return open.length ? open : sourceDisputedMoves5(analysis, available, 1);
}

function sourceCornerMove5(board) {
  const checks = [
    [2, 2, 2, 2, 4, 4],
    [2, 2, 0, 2, 2, 4],
    [2, 2, 0, 0, 2, 2],
    [2, 2, 2, 0, 4, 2],
  ];
  for (const [x, y, x1, y1, x2, y2] of checks) {
    let live = 0;
    let occupied = 0;
    for (let xx = x1; xx <= x2; xx++) {
      for (let yy = y1; yy <= y2; yy++) {
        const value = board[xx * 5 + yy];
        if (value === -1) continue;
        live++;
        if (value !== 0) occupied++;
      }
    }
    const point = x * 5 + y;
    if (live >= 7 && occupied === 0 && board[point] !== -1) return point;
  }
  return -1;
}

function sourceEvaluateMove5(board, move, player) {
  if (board[move] === -1) return board;
  const result = new Int8Array(board);
  result[move] = player;
  let analysis = sourceAnalyzeBoard5(result);
  const enemy = player === 1 ? 2 : 1;
  let captured = analysis.groups.filter(
    (group) => group.color === enemy && group.liberties.length === 0
  );
  if (!captured.length) {
    captured = analysis.groups.filter(
      (group) => group.color === player && group.liberties.length === 0
    );
  }
  for (const group of captured) {
    for (const point of group.points) result[point] = 0;
  }
  return result;
}

function sourceEyeCreationMoves5(
  analysis,
  player,
  available,
  maxLiberties = 99
) {
  const allEyes = sourceEyesByGroup5(analysis, player);
  const eyeGroups = [...allEyes.values()];
  const livingGroupIds = new Set(
    [...allEyes.entries()]
      .filter(([, eyes]) => eyes.length >= 2)
      .map(([groupId]) => groupId)
  );
  const currentLivingGroups = livingGroupIds.size;
  const currentEyeGroups = eyeGroups.filter((eyes) => eyes.length).length;
  const allowed = new Uint8Array(25);
  for (const point of available) allowed[point] = 1;
  const liberties = [];

  for (const group of analysis.groups) {
    if (group.color !== player ||
      group.points.length <= 1 ||
      group.liberties.length > maxLiberties ||
      livingGroupIds.has(group.id)) {
      continue;
    }
    for (const point of group.liberties) {
      if (!allowed[point]) continue;
      let enclosed = 4 - SOURCE_AI_NEIGHBORS_5[point].length;
      let hasEmpty = false;
      for (const neighbor of SOURCE_AI_NEIGHBORS_5[point]) {
        const value = analysis.board[neighbor];
        if (value === -1 || value === player) enclosed++;
        if (value === 0) hasEmpty = true;
      }
      if (enclosed >= 2 && hasEmpty) liberties.push(point);
    }
  }

  const result = [];
  for (const point of liberties) {
    const nextBoard = sourceEvaluateMove5(analysis.board, point, player);
    const nextEyes = [...sourceEyesByGroup5(
      sourceAnalyzeBoard5(nextBoard),
      player
    ).values()];
    const nextLivingGroups =
      nextEyes.filter((eyes) => eyes.length >= 2).length;
    const nextEyeGroups = nextEyes.filter((eyes) => eyes.length).length;
    if (
      nextLivingGroups > currentLivingGroups ||
      (
        nextEyeGroups > currentEyeGroups &&
        nextLivingGroups === currentLivingGroups
      )
    ) {
      result.push({
        pos: point,
        createsLife: nextLivingGroups > currentLivingGroups,
      });
    }
  }
  return result.sort((a, b) => +b.createsLife - +a.createsLife);
}

function sourcePatternMoves5(analysis, player, available, smart) {
  const allowed = new Uint8Array(25);
  for (const point of available) allowed[point] = 1;
  const result = [];
  for (let point = 0; point < 25; point++) {
    if (!allowed[point]) continue;
    const x = (point / 5) | 0;
    const y = point % 5;
    if (!isPatternMoveLinear(analysis.board, x, y, player)) continue;
    if (!smart ||
      sourceEffectiveLiberties5(analysis, point, player).length > 1) {
      result.push(point);
    }
  }
  return result;
}

function sourcePolicyOptions5(
  board,
  legalPositions,
  player,
  smart,
  lastPassed
) {
  const { analysis, available } = sourceAvailableMoves5(
    board,
    legalPositions,
    player,
    smart
  );
  const contested = sourceDisputedMoves5(analysis, available);
  const endGameAvailable = contested.length === 0 && lastPassed;
  const growthMoves = sourceGrowthMoves5(analysis, player, available);
  const growthCandidates = sourceMaximumGrowthMoves5(growthMoves);
  const defendCandidates = sourceMaximumGrowthMoves5(growthMoves, true);
  const surround = sourceSurroundMove5(
    analysis,
    player,
    available,
    smart
  );
  const expansion = sourceExpansionMoves5(analysis, available);
  const patterns = endGameAvailable
    ? []
    : sourcePatternMoves5(analysis, player, available, smart);
  const eyeMoves = endGameAvailable
    ? []
    : sourceEyeCreationMoves5(analysis, player, available);
  let eyeBlock = -1;
  if (!endGameAvailable) {
    const enemyEyeMoves = sourceEyeCreationMoves5(
      analysis,
      player === 1 ? 2 : 1,
      available,
      5
    );
    const createsLife = enemyEyeMoves.filter((move) => move.createsLife);
    const createsEye = enemyEyeMoves.filter((move) => !move.createsLife);
    if (createsLife.length === 1) eyeBlock = createsLife[0].pos;
    else if (!createsLife.length && createsEye.length === 1) {
      eyeBlock = createsEye[0].pos;
    }
  }
  const jump = expansion.filter((point) => {
    const x = (point / 5) | 0;
    const y = point % 5;
    return [[x, y + 2], [x + 2, y], [x, y - 2], [x - 2, y]]
      .some(([xx, yy]) =>
        xx >= 0 && yy >= 0 && xx < 5 && yy < 5 &&
        board[xx * 5 + yy] === player
      );
  });
  return {
    available,
    contested,
    endGameAvailable,
    growthCandidates: endGameAvailable ? [] : growthCandidates,
    defendCandidates,
    surround,
    expansion,
    patterns,
    eyeMove: eyeMoves[0]?.pos ?? -1,
    eyeBlock,
    jump,
    corner: sourceCornerMove5(board),
  };
}

function sourceRngCutsForOptions5(options) {
  const cuts = new Set([0, 1]);
  const addCuts = (length) => {
    for (let index = 1; index < length; index++) cuts.add(index / length);
  };
  addCuts(options.growthCandidates.length);
  addCuts(options.expansion.length);
  addCuts(options.patterns.length);
  addCuts(options.jump.length);
  if (options.contested.length) addCuts(options.available.length);
  return [...cuts].sort((a, b) => a - b);
}

function sourcePickByRng5(values, rng) {
  return values[Math.floor(rng * values.length)] ?? null;
}

function sourceChoicesAtRng5(options, rng) {
  const growth = sourcePickByRng5(options.growthCandidates, rng)?.pos ?? -1;
  const expansion = sourcePickByRng5(options.expansion, rng) ?? -1;
  const pattern = sourcePickByRng5(options.patterns, rng) ?? -1;
  const jump = sourcePickByRng5(options.jump, rng) ?? -1;
  const random = options.contested.length
    ? sourcePickByRng5(options.available, rng) ?? -1
    : -1;
  const defend = options.defendPositions ??= (() => {
    const points = [];
    for (const move of options.defendCandidates) {
      if (!points.includes(move.pos)) points.push(move.pos);
    }
    return points;
  })();
  return {
    capture: options.surround?.newLibertyCount === 0
      ? options.surround.pos
      : -1,
    defendCapture: options.defendCandidates.length &&
      options.defendCandidates[0].oldLibertyCount === 1 &&
      options.defendCandidates[0].newLibertyCount > 1
      ? defend
      : [],
    eyeMove: options.eyeMove,
    eyeBlock: options.eyeBlock,
    pattern,
    growth,
    expansion,
    jump,
    defend,
    surround: options.surround,
    corner: options.corner,
    random,
  };
}

function sourceResult5(positions, type, cascade = false) {
  const values = Array.isArray(positions) ? positions : [positions];
  const filtered = [];
  for (const point of values) {
    if (point >= 0 && !filtered.includes(point)) filtered.push(point);
  }
  return filtered.length ? { positions: filtered, type, cascade } : null;
}

function sourceIlluminatiResult5(choices, rng) {
  let result = sourceResult5(choices.capture, "capture", true);
  if (result) return result;
  result = sourceResult5(choices.defendCapture, "defend", true);
  if (result) return result;
  result = sourceResult5(choices.eyeMove, "eyeMove", true);
  if (result) return result;
  if (choices.surround?.newLibertyCount <= 1) {
    return sourceResult5(choices.surround.pos, "atari", true);
  }
  result = sourceResult5(choices.eyeBlock, "eyeBlock", true);
  if (result) return result;
  result = sourceResult5(choices.corner, "corner", true);
  if (result) return result;
  const hasMoves = [
    choices.eyeMove,
    choices.eyeBlock,
    choices.growth,
    choices.defend.length ? choices.defend[0] : -1,
    choices.surround?.pos ?? -1,
  ].filter((point) => point >= 0).length;
  if ((rng > 0.25 || !hasMoves) && choices.pattern >= 0) {
    return sourceResult5(choices.pattern, "pattern");
  }
  if (rng > 0.4 && choices.jump >= 0) {
    return sourceResult5(choices.jump, "jump");
  }
  if (rng < 0.6 && choices.surround?.newLibertyCount <= 2) {
    return sourceResult5(choices.surround.pos, "surround");
  }
  return null;
}

function sourceFactionPriority5(opponent, choices, rng) {
  if (opponent === "Netburners") {
    if (rng < 0.2) {
      const result = sourceIlluminatiResult5(choices, rng);
      if (result) result.cascade = false;
      return result;
    }
    if (rng < 0.4 && choices.expansion >= 0) {
      return sourceResult5(choices.expansion, "expansion");
    }
    if (rng < 0.6 && choices.growth >= 0) {
      return sourceResult5(choices.growth, "growth");
    }
    if (rng < 0.75) return sourceResult5(choices.random, "random");
    return null;
  }
  if (opponent === "Slum Snakes") {
    const defend = sourceResult5(
      choices.defendCapture,
      "defend",
      true
    );
    if (defend) return defend;
    if (rng < 0.2) return sourceIlluminatiResult5(choices, rng);
    if (rng < 0.6 && choices.growth >= 0) {
      return sourceResult5(choices.growth, "growth");
    }
    if (rng < 0.65) return sourceResult5(choices.random, "random");
    return null;
  }
  if (opponent === "The Black Hand") {
    let result = sourceResult5(choices.capture, "capture", true);
    if (result) return result;
    if (choices.surround?.newLibertyCount <= 1) {
      return sourceResult5(choices.surround.pos, "atari", true);
    }
    result = sourceResult5(choices.defendCapture, "defend", true);
    if (result) return result;
    if (choices.surround?.newLibertyCount <= 2) {
      return sourceResult5(choices.surround.pos, "surround", true);
    }
    if (rng < 0.3) return sourceIlluminatiResult5(choices, rng);
    if (rng < 0.75 && choices.surround) {
      return sourceResult5(choices.surround.pos, "surround");
    }
    if (rng < 0.8) return sourceResult5(choices.random, "random");
    return null;
  }
  if (opponent === "Tetrads") {
    let result = sourceResult5(choices.capture, "capture", true);
    if (result) return result;
    result = sourceResult5(choices.defendCapture, "defend", true);
    if (result) return result;
    result = sourceResult5(choices.pattern, "pattern", true);
    if (result) return result;
    if (choices.surround?.newLibertyCount <= 1) {
      return sourceResult5(choices.surround.pos, "atari", true);
    }
    return rng < 0.4 ? sourceIlluminatiResult5(choices, rng) : null;
  }
  if (opponent === "Daedalus") {
    return rng < 0.9 ? sourceIlluminatiResult5(choices, rng) : null;
  }
  return sourceIlluminatiResult5(choices, rng);
}

function sourceFallbackResults5(choices) {
  const entries = [
    sourceResult5(choices.growth, "growth"),
    choices.surround
      ? sourceResult5(choices.surround.pos, "surround")
      : null,
    sourceResult5(choices.defend, "defend"),
    sourceResult5(choices.expansion, "expansion"),
    sourceResult5(choices.pattern, "pattern"),
    sourceResult5(choices.eyeMove, "eyeMove"),
    sourceResult5(choices.eyeBlock, "eyeBlock"),
  ];
  return entries.filter(Boolean);
}

function sourceFactionRngCuts5(opponent) {
  return SOURCE_FACTION_CUTS5[opponent] ?? SOURCE_FACTION_CUTS5.default;
}

function sourceSmartBranches5(opponent) {
  if (opponent === "Netburners") return [false];
  if (opponent === "Slum Snakes" ||
    opponent === "The Black Hand") {
    return [true, false];
  }
  return [true];
}

function resolveSourcePolicy5(
  board,
  legalPositions,
  player,
  opponent,
  lastPassed
) {
  let positionMask = 0;
  let passPossible = false;
  let cascadePositionMask = 0;
  let alternativePositionMask = 0;
  let allBranchesCascade = true;
  const typesByPosition = new Map();
  const factionCuts = sourceFactionRngCuts5(opponent);
  const likelihoods = opponent === "Daedalus"
    ? new Float64Array(26)
    : null;

  const record = (result, likelihood = 0) => {
    if (!result?.cascade) allBranchesCascade = false;
    if (!result) {
      passPossible = true;
      if (likelihoods) likelihoods[25] += likelihood;
      return;
    }
    const likelihoodPerPosition = result.positions.length
      ? likelihood / result.positions.length
      : 0;
    for (const point of result.positions) {
      positionMask |= 1 << point;
      if (likelihoods) likelihoods[point] += likelihoodPerPosition;
      if (result.cascade) cascadePositionMask |= 1 << point;
      else alternativePositionMask |= 1 << point;
      if (!typesByPosition.has(point)) typesByPosition.set(point, new Set());
      typesByPosition.get(point).add(result.type);
    }
  };

  const smartBranches = sourceSmartBranches5(opponent);
  for (let smartIndex = 0; smartIndex < smartBranches.length; smartIndex++) {
    const smart = smartBranches[smartIndex];
    const options = sourcePolicyOptions5(
      board,
      legalPositions,
      player,
      smart,
      lastPassed
    );
    const optionCuts = sourceRngCutsForOptions5(options);
    for (let optionIndex = 0;
      optionIndex < optionCuts.length - 1;
      optionIndex++) {
      const optionRng =
        (optionCuts[optionIndex] + optionCuts[optionIndex + 1]) / 2;
      const optionLikelihood =
        optionCuts[optionIndex + 1] - optionCuts[optionIndex];
      const choices = sourceChoicesAtRng5(options, optionRng);
      for (let factionIndex = 0;
        factionIndex < factionCuts.length - 1;
        factionIndex++) {
        const factionRng =
          (factionCuts[factionIndex] + factionCuts[factionIndex + 1]) / 2;
        const branchLikelihood = optionLikelihood *
          (factionCuts[factionIndex + 1] - factionCuts[factionIndex]);
        const priority = sourceFactionPriority5(
          opponent,
          choices,
          factionRng
        );
        if (priority) {
          record(priority, branchLikelihood);
          continue;
        }
        const fallback = sourceFallbackResults5(choices);
        if (!fallback.length) {
          record(null, branchLikelihood);
        } else {
          const fallbackLikelihood = branchLikelihood / fallback.length;
          for (const result of fallback) {
            record(result, fallbackLikelihood);
          }
        }
      }
    }
  }

  const forced = allBranchesCascade &&
    !passPossible &&
    popcount32(positionMask) === 1;
  let type = "source";
  if (forced) {
    const point = 31 - Math.clz32(positionMask);
    const types = typesByPosition.get(point);
    if (types?.size === 1) type = [...types][0];
  }
  const probabilityWeights = new Uint16Array(26);
  for (let point = 0; point < 25; point++) {
    if (positionMask & (1 << point)) {
      probabilityWeights[point] = 1;
    }
  }
  if (passPossible) probabilityWeights[25] = 1;
  const terminalRiskWeights = likelihoods
    ? Uint16Array.from(likelihoods, likelihood =>
      likelihood > 0
        ? Math.max(1, Math.round(likelihood * 65535))
        : 0
    )
    : null;
  return {
    positionMask,
    cascadePositionMask,
    alternativePositionMask,
    passPossible,
    forced,
    type,
    probabilityWeights,
    terminalRiskWeights,
  };
}

function ensurePolicyCache() {
  if (AI_POLICY_CACHE_HASHES) return;
  AI_POLICY_CACHE_HASHES = new Float64Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_AVAILABLE = new Uint32Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_POSITIONS = new Uint32Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_CASCADES = new Uint32Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_ALTERNATIVES = new Uint32Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_OPPONENTS = new Uint8Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_STATUS = new Uint8Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_FLAGS = new Uint8Array(AI_POLICY_CACHE_SLOTS);
  AI_POLICY_CACHE_PROBS = new Uint16Array(AI_POLICY_CACHE_SLOTS * 26);
  AI_POLICY_CACHE_TERMINAL_RISK_PROBS =
    new Uint16Array(AI_POLICY_CACHE_SLOTS * 26);
}

function policyOpponentCode(opponent) {
  if (opponent === "Slum Snakes") return 1;
  if (opponent === "The Black Hand") return 2;
  if (opponent === "Tetrads") return 3;
  if (opponent === "Daedalus") return 4;
  if (opponent === "Illuminati") return 5;
  if (opponent === "????????????") return 6;
  return 0;
}

function policyCacheSlot(hash, availableMask, opponentCode) {
  return (
    mixExactKey5(hash) ^
    Math.imul(availableMask, 0x9E3779B1) ^
    opponentCode
  ) & (AI_POLICY_CACHE_SLOTS - 1);
}

function getCachedPolicy(hash, availableMask, opponentCode) {
  ensurePolicyCache();
  const slot = policyCacheSlot(hash, availableMask, opponentCode);
  if (!AI_POLICY_CACHE_STATUS[slot] ||
    AI_POLICY_CACHE_HASHES[slot] !== hash ||
    AI_POLICY_CACHE_AVAILABLE[slot] !== availableMask ||
    AI_POLICY_CACHE_OPPONENTS[slot] !== opponentCode) {
    AI_POLICY_CACHE_MISSES++;
    return AI_POLICY_CACHE_MISS;
  }
  AI_POLICY_CACHE_HITS++;
  if (AI_POLICY_CACHE_STATUS[slot] === 1) return null;
  return {
    positionMask: AI_POLICY_CACHE_POSITIONS[slot],
    cascadePositionMask: AI_POLICY_CACHE_CASCADES[slot],
    alternativePositionMask: AI_POLICY_CACHE_ALTERNATIVES[slot],
    forced: !!(AI_POLICY_CACHE_FLAGS[slot] & 1),
    passPossible: !!(AI_POLICY_CACHE_FLAGS[slot] & 2),
    probabilityWeights: AI_POLICY_CACHE_PROBS.subarray(
      slot * 26,
      slot * 26 + 26
    ),
    terminalRiskWeights: AI_POLICY_CACHE_TERMINAL_RISK_PROBS.subarray(
      slot * 26,
      slot * 26 + 26
    ),
  };
}

function setCachedPolicy(hash, availableMask, opponentCode, policy) {
  ensurePolicyCache();
  const slot = policyCacheSlot(hash, availableMask, opponentCode);
  AI_POLICY_CACHE_HASHES[slot] = hash;
  AI_POLICY_CACHE_AVAILABLE[slot] = availableMask;
  AI_POLICY_CACHE_OPPONENTS[slot] = opponentCode;
  AI_POLICY_CACHE_STATUS[slot] = policy ? 2 : 1;
  AI_POLICY_CACHE_POSITIONS[slot] = policy?.positionMask ?? 0;
  AI_POLICY_CACHE_CASCADES[slot] = policy?.cascadePositionMask ?? 0;
  AI_POLICY_CACHE_ALTERNATIVES[slot] =
    policy?.alternativePositionMask ?? 0;
  AI_POLICY_CACHE_FLAGS[slot] = policy
    ? (policy.forced ? 1 : 0) | (policy.passPossible ? 2 : 0)
    : 0;
  if (policy?.probabilityWeights) {
    AI_POLICY_CACHE_PROBS.set(policy.probabilityWeights, slot * 26);
  } else {
    AI_POLICY_CACHE_PROBS.fill(0, slot * 26, slot * 26 + 26);
  }
  if (policy?.terminalRiskWeights) {
    AI_POLICY_CACHE_TERMINAL_RISK_PROBS.set(
      policy.terminalRiskWeights,
      slot * 26
    );
  } else {
    AI_POLICY_CACHE_TERMINAL_RISK_PROBS.fill(
      0,
      slot * 26,
      slot * 26 + 26
    );
  }
}

class MCGSEdge {
  constructor(hash, pos, weight) {
    /** @type {number} */
    this.hash = hash;
    // Cached position key (hash without the to-play/passed flags): read on
    // every superko check during selection.
    /** @type {number} */
    this.positionKey = positionKeyFromState5(hash);
    /** @type {number} */
    this.pos = pos;
    /** @type {number} */
    this.weight = weight;
    /** @type {number} */
    this.visits = 0;
    /** @type {MCGSNode | null} */
    this.nn = null;
    // Search generation of the last transposition-map miss taken while the
    // map was full (membership frozen): skip further lookups this search.
    /** @type {number} */
    this.nnMissGeneration = 0;
    /** @type {number} */
    this.nnMissContext = -1;
    /** @type {number} */
    this.value = 0;
    // Leaf rollout evidence as flat scalars (read on every selection score).
    /** @type {number} */
    this.leafSum = 0;
    /** @type {number} */
    this.leafSquaredSum = 0;
    /** @type {number} */
    this.leafVisits = 0;
  }
}

class PendingEdgeStore {
  constructor(edges = []) {
    this.count = edges.length;
    this.cursor = 0;
    this.buffer = new ArrayBuffer(12 * this.count);
    this.hashes = new Float64Array(this.buffer, 0, this.count);
    this.positions = new Int16Array(this.buffer, 8 * this.count, this.count);
    this.weights = new Int16Array(this.buffer, 10 * this.count, this.count);
    for (let index = 0; index < this.count; index++) {
      const edge = edges[index];
      this.hashes[index] = edge.hash;
      this.positions[index] = edge.pos;
      this.weights[index] = edge.weight;
    }
  }

  get length() {
    return this.count - this.cursor;
  }

  edgeAt(index) {
    return new MCGSEdge(
      this.hashes[index],
      this.positions[index],
      this.weights[index]
    );
  }

  pop() {
    return this.cursor < this.count ? this.edgeAt(this.cursor++) : undefined;
  }

  *[Symbol.iterator]() {
    for (let index = this.cursor; index < this.count; index++) {
      yield this.edgeAt(index);
    }
  }
}

function widenNode(node) {
  // nextWidenN underestimates the true trigger (float-safe), so the exact
  // widening formula below is always the one that decides; the cache only
  // skips the sqrt on visits that cannot possibly widen.
  if (node.N < node.nextWidenN || !node.pendingChildren?.length) return;
  const passCount = node.children[0]?.pos === -1 ? 1 : 0;
  const target = PROGRESSIVE_WIDENING_BASE +
    Math.floor(PROGRESSIVE_WIDENING_SCALE * Math.sqrt(Math.max(0, node.N - 1)));
  while (node.children.length - passCount < target && node.pendingChildren.length) {
    node.children.push(node.pendingChildren.pop());
  }
  if (!node.pendingChildren.length) {
    node.nextWidenN = Infinity;
    return;
  }
  const nextStep =
    node.children.length - passCount - PROGRESSIVE_WIDENING_BASE + 1;
  node.nextWidenN = nextStep <= 0
    ? 0
    : Math.floor((nextStep / PROGRESSIVE_WIDENING_SCALE) ** 2);
}

class MCGSNode {
  /**
   * @param {Int8Array} board
   * @param {boolean} blackToPlay
   * @param {Map<number, MCGSNode>} map
   * @param {Set<number>} history hashes of previous game states, used for superko detection
   * @param {number[] | null} allowedPositions optional root-only move positions assigned to this worker
   * @param {number | null} knownHash optional precomputed hash including side-to-play
   * @param {boolean} registerInMap whether this node should become the canonical transposition node
   */
  constructor(
    board,
    blackToPlay,
    map,
    history,
    allowedPositions = null,
    opp,
    knownHash = null,
    registerInMap = true,
    lastPassed = false
  ) {
    this.blackToPlay = blackToPlay;
    this.lastPassed = lastPassed;
    // Opponent nodes are chance nodes: selection samples the modeled reply
    // distribution instead of assuming an adversarial opponent.
    /** @type {boolean} */
    this.isChance = false;

    const expansionScratch = getNodeExpansionScratch(board.length);
    const bits = boardToBitboards5(board, expansionScratch.sourceBits);
    this.blackBits = bits[0];
    this.whiteBits = bits[1];
    this.offlineBits = bits[2];
    this.hash = knownHash ?? stateKey5(
      positionKeyBits5(this.blackBits, this.whiteBits),
      blackToPlay,
      lastPassed
    );

    /** @type {number} */
    this.nextWidenN = 0;
    /** @type MCGSEdge[] */
    this.children = [new MCGSEdge(
      stateKey5(positionKeyFromState5(this.hash), !blackToPlay, true),
      -1,
      0
    )];
    this.pendingChildren = null;
    const opponentToPlay = blackToPlay !== SEARCH_PLAYER_IS_BLACK;
    const aiColor = SEARCH_PLAYER_IS_BLACK ? 2 : 1;
    const hasKnownPolicy = opp !== "No AI";
    // An AI root is a chance node, not a worker bucket. Every worker needs
    // the complete source move set in order to resolve the same policy.
    const positions = opponentToPlay && hasKnownPolicy
      ? [...Array(BOARD_SIZE * BOARD_SIZE).keys()]
      : allowedPositions ?? [...Array(BOARD_SIZE * BOARD_SIZE).keys()];
    // Reusable typed scratch instead of per-candidate objects (this runs
    // for every node expansion; the objects died immediately).
    const candPositions = expansionScratch.candidatePositions;
    const candHashes = expansionScratch.candidateHashes;
    const candOrder = expansionScratch.candidateOrder;
    let candidateCount = 0;
    let boardLegalMask = 0;
    let historyBarredMask = 0;
    let nonAtariLegalMask = 0;
    const nextBoard = expansionScratch.board;

    for (const pos of positions) {
      const x = (pos / BOARD_SIZE) | 0;
      const y = pos % BOARD_SIZE;
      const legal = addMoveBitboard5(
        board,
        nextBoard,
        x,
        y,
        blackToPlay,
        this.blackBits,
        this.whiteBits,
        this.offlineBits,
        null,
        expansionScratch.nextBits
      );
      if (!legal) {
        continue;
      }

      const boardHash = positionKeyBits5(
        expansionScratch.nextBits[0],
        expansionScratch.nextBits[1]
      );
      boardLegalMask |= 1 << pos;
      // Root legality is fixed by the real-game history. Remove superko
      // moves before retained statistics or policy ordering can revive them.
      if (history.has(boardHash)) {
        historyBarredMask |= 1 << pos;
        if (!registerInMap) continue;
      }
      const ownAfter = blackToPlay
        ? expansionScratch.nextBits[0]
        : expansionScratch.nextBits[1];
      const playedGroup = groupBits5(ownAfter, 1 << pos);
      const emptyAfter = BITBOARD_FULL_5 &
        ~(expansionScratch.nextBits[0] |
          expansionScratch.nextBits[1] |
          this.offlineBits);
      if (popcount32(neighborBits5(playedGroup) & emptyAfter) > 1) {
        nonAtariLegalMask |= 1 << pos;
      }
      const hash = stateKey5(boardHash, !blackToPlay, false);
      candPositions[candidateCount] = pos;
      candHashes[candidateCount] = hash;
      candOrder[candidateCount] =
        Math.imul(mixExactKey5(hash) >>> 0, 0x9E3779B1) >>> 0;
      candidateCount++;
    }

    let sourcePolicy = null;
    let modeledPositionMask = 0;
    if (opponentToPlay && hasKnownPolicy) {
      // Keep all board-legal reply edges as shared structure, but resolve
      // reachable replies and statistics under the path's superko-legal
      // mask. Equal boards with different reply masks are distinct chance
      // contexts in the transposition table.
      const legalPositions = [];
      const legalMask = boardLegalMask;
      for (let index = 0; index < candidateCount; index++) {
        const positionBit = 1 << candPositions[index];
        if (!(historyBarredMask & positionBit)) {
          legalPositions.push(candPositions[index]);
        }
      }
      const effectiveLegalMask = legalMask & ~historyBarredMask;
      const opponentCode =
        policyOpponentCode(opp) + (aiColor === 1 ? 8 : 0);
      sourcePolicy = getCachedPolicy(
        this.hash,
        effectiveLegalMask,
        opponentCode
      );
      if (sourcePolicy === AI_POLICY_CACHE_MISS) {
        sourcePolicy = resolveSourcePolicy5(
          board,
          legalPositions,
          aiColor,
          opp,
          lastPassed
        );
        setCachedPolicy(
          this.hash,
          effectiveLegalMask,
          opponentCode,
          sourcePolicy
        );
      }
      // Preserve the source result exactly. In particular, an endgame
      // fallback can pass even while other board-legal moves exist.
      const passAllowed = !!sourcePolicy.passPossible;
      modeledPositionMask = sourcePolicy.positionMask & effectiveLegalMask;
      if (!passAllowed) this.children.length = 0;
      if (sourcePolicy) {
        this.isChance = true;
        this.legalMask = legalMask;
        this.nonAtariLegalMask = nonAtariLegalMask;
        this.transpositionContext = effectiveLegalMask >>> 0;
        this.opponentCode = opponentCode;
        if (this.children.length && sourcePolicy.probabilityWeights) {
          this.children[0].weight =
            sourcePolicy.probabilityWeights[25] || 1;
          if (sourcePolicy.terminalRiskWeights?.[25]) {
            this.children[0].terminalRiskWeight =
              sourcePolicy.terminalRiskWeights[25];
          }
        }
      }
    }
    if (!this.isChance) {
      this.legalMask = boardLegalMask >>> 0;
      this.nonAtariLegalMask = 0;
      this.transpositionContext = decisionContextFromMasks(
        boardLegalMask,
        historyBarredMask
      );
    }

    const selectedTier = [];
    const tierOrder = expansionScratch.tierOrder;
    const zeroWeightTail = [];
    for (let index = 0; index < candidateCount; index++) {
      const pos = candPositions[index];
      const inUnion =
        !sourcePolicy || !!(modeledPositionMask & (1 << pos));
      // Chance nodes keep every legal reply at weight 0 when outside the
      // unrestricted union: a ko-barred forced move redirects the cascade
      // to replies the union never contained, and the sampler re-resolves
      // their weights for the reduced legal set. Zero-weight edges sit in a
      // tail segment the common sampling path never touches.
      if (!inUnion) {
        if (sourcePolicy) {
          zeroWeightTail.push(new MCGSEdge(candHashes[index], pos, 0));
        }
        continue;
      }
      tierOrder[selectedTier.length] = candOrder[index];
      const edge = new MCGSEdge(
        candHashes[index],
        pos,
        sourcePolicy?.probabilityWeights?.[pos] || 1
      );
      if (sourcePolicy?.terminalRiskWeights?.[pos]) {
        edge.terminalRiskWeight = sourcePolicy.terminalRiskWeights[pos];
      }
      selectedTier.push(edge);
    }
    if (zeroWeightTail.length) {
      this.weightedEdgeCount = this.children.length + selectedTier.length;
    }
    if (allowedPositions == null &&
      !sourcePolicy &&
      selectedTier.length > PROGRESSIVE_WIDENING_BASE) {
      const wideningOrder = new Map();
      for (let index = 0; index < selectedTier.length; index++) {
        wideningOrder.set(selectedTier[index].hash, tierOrder[index]);
      }
      selectedTier.sort((a, b) => {
        return wideningOrder.get(a.hash) - wideningOrder.get(b.hash);
      });
      this.children.push(...selectedTier.slice(0, PROGRESSIVE_WIDENING_BASE));
      this.pendingChildren = new PendingEdgeStore(
        selectedTier.slice(PROGRESSIVE_WIDENING_BASE)
      );
    } else {
      this.children.push(...selectedTier);
    }
    if (zeroWeightTail.length) this.children.push(...zeroWeightTail);

    if (registerInMap) map.set(this.hash, this);

    // result of the playout rooted at this position
    const boardHash = positionKeyFromState5(this.hash);
    this.U = fastPlayoutBits5(
      this.blackBits,
      this.whiteBits,
      this.offlineBits,
      this.blackToPlay,
      history,
      boardHash
    );

    // Playouts going though this node
    this.priorWeight = 1;
    this.N = 1;

    // Total utility of playouts going through this node
    this.S = this.U;

    // Total square of utility of playouts going through this node
    this.SS = this.U ** 2;
    this.updateCPUct();
  }

  updateCPUct() {
    const PRIOR_MULTIPLIER = 10;
    const sampledValue = this.S / this.N;
    const sampledSecondMoment = this.SS / this.N;
    const sampledVariance = Math.max(
      0,
      sampledSecondMoment - sampledValue * sampledValue
    );
    // Cache the decision value (read per child on every selection); all
    // S/SS mutations funnel through here, DP changes through
    // ensureDoublePassOption, so both keep it fresh.
    const weightedChanceVariance = this.isChance
      ? updateChanceDecisionMoments(this)
      : null;
    if (weightedChanceVariance == null) {
      this.decisionValue = this.DP && !this.isChance
        ? (this.blackToPlay
          ? Math.max(sampledValue, this.DP[5])
          : Math.min(sampledValue, this.DP[5]))
        : sampledValue;
      this.decisionSecondMoment =
        sampledVariance + this.decisionValue * this.decisionValue;
    }
    // Clamp the variance: identical playout values (proven terminals) can
    // produce a tiny negative via floating-point cancellation, and the NaN
    // from sqrt would make this node's edge permanently unselectable.
    const variance = weightedChanceVariance ?? sampledVariance;
    return this.cPUCT = (PRIOR_MULTIPLIER * Math.sqrt(0.75 * BOARD_SIZE * BOARD_SIZE) + this.N * Math.max(0.1, Math.sqrt(variance))) / (this.N + PRIOR_MULTIPLIER);
  }

  getcPUCT() {
    return this.cPUCT ?? this.updateCPUct();
  }
}

class TypedTranspositionTable {
  constructor(capacity = 256) {
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.hashes = new Float64Array(capacity);
    this.contexts = new Uint32Array(capacity);
    this.states = new Uint8Array(capacity);
    this.nodes = new Array(capacity);
    this.size = 0;
    this.used = 0;
  }

  indexFor(hash, context = 0) {
    return (
      mixExactKey5(hash) ^
      Math.imul(context >>> 0, 0x9E3779B1)
    ) & this.mask;
  }

  get(hash, context = 0) {
    context >>>= 0;
    let index = this.indexFor(hash, context);
    while (this.states[index]) {
      if (this.states[index] === 1 &&
        this.hashes[index] === hash &&
        this.contexts[index] === context) {
        return this.nodes[index];
      }
      index = (index + 1) & this.mask;
    }
    return undefined;
  }

  getAny(hash) {
    for (let index = 0; index < this.capacity; index++) {
      if (this.states[index] === 1 && this.hashes[index] === hash) {
        return this.nodes[index];
      }
    }
    return undefined;
  }

  has(hash, context = 0) {
    return this.get(hash, context) !== undefined;
  }

  set(hash, node, context = node?.transpositionContext ?? 0) {
    context >>>= 0;
    if ((this.used + 1) * 4 >= this.capacity * 3) this.rebuild();
    let index = this.indexFor(hash, context);
    let deleted = -1;
    while (this.states[index]) {
      if (this.states[index] === 1 &&
        this.hashes[index] === hash &&
        this.contexts[index] === context) {
        this.nodes[index] = node;
        return this;
      }
      if (deleted < 0 && this.states[index] === 2) deleted = index;
      index = (index + 1) & this.mask;
    }
    if (deleted >= 0) index = deleted;
    else this.used++;
    this.states[index] = 1;
    this.hashes[index] = hash;
    this.contexts[index] = context;
    this.nodes[index] = node;
    this.size++;
    return this;
  }

  delete(hash, context = 0) {
    context >>>= 0;
    let index = this.indexFor(hash, context);
    while (this.states[index]) {
      if (this.states[index] === 1 &&
        this.hashes[index] === hash &&
        this.contexts[index] === context) {
        this.states[index] = 2;
        this.nodes[index] = null;
        this.size--;
        return true;
      }
      index = (index + 1) & this.mask;
    }
    return false;
  }

  clear() {
    this.states.fill(0);
    this.nodes.fill(null);
    this.size = 0;
    this.used = 0;
  }

  rebuild() {
    const entries = [...this.entries()];
    // Grow when the load comes from live entries rather than tombstones:
    // a fixed-capacity compaction re-crosses the load threshold during its
    // own re-insertion and cascades into recursive rebuilds (~43ms per
    // insert once live entries exceed 3/4 capacity — the 200->205 node-cap
    // hang). Choosing a capacity where the threshold cannot fire also makes
    // the set() calls below safe.
    let capacity = this.capacity;
    while ((entries.length + 1) * 4 >= capacity * 3) capacity <<= 1;
    if (capacity !== this.capacity) {
      this.capacity = capacity;
      this.mask = capacity - 1;
      this.hashes = new Float64Array(capacity);
      this.contexts = new Uint32Array(capacity);
      this.states = new Uint8Array(capacity);
      this.nodes = new Array(capacity);
      this.size = 0;
      this.used = 0;
    } else {
      this.clear();
    }
    for (const [hash, node] of entries) this.set(hash, node);
  }

  *keys() {
    for (let index = 0; index < this.capacity; index++) {
      if (this.states[index] === 1) yield this.hashes[index];
    }
  }

  *values() {
    for (let index = 0; index < this.capacity; index++) {
      if (this.states[index] === 1) yield this.nodes[index];
    }
  }

  *entries() {
    for (let index = 0; index < this.capacity; index++) {
      if (this.states[index] === 1) {
        yield [this.hashes[index], this.nodes[index]];
      }
    }
  }
}

const WORKER_SEARCH_STATE = {
  map: new TypedTranspositionTable(),
  boardSize: 0,
  opponent: null,
  playerIsBlack: null,
};

function clearAIPatternCache() {
  AI_PATTERN_CACHE_KEYS = null;
  AI_PATTERN_CACHE_VALUES = null;
}

function clearAIPolicyCache() {
  AI_POLICY_CACHE_HASHES = null;
  AI_POLICY_CACHE_AVAILABLE = null;
  AI_POLICY_CACHE_POSITIONS = null;
  AI_POLICY_CACHE_CASCADES = null;
  AI_POLICY_CACHE_ALTERNATIVES = null;
  AI_POLICY_CACHE_OPPONENTS = null;
  AI_POLICY_CACHE_STATUS = null;
  AI_POLICY_CACHE_FLAGS = null;
  AI_POLICY_CACHE_PROBS = null;
  AI_POLICY_CACHE_TERMINAL_RISK_PROBS = null;
  AI_POLICY_CACHE_HITS = 0;
  AI_POLICY_CACHE_MISSES = 0;
}

function resetWorkerGameState() {
  WORKER_SEARCH_STATE.map = new TypedTranspositionTable();
  WORKER_SEARCH_STATE.boardSize = 0;
  WORKER_SEARCH_STATE.opponent = null;
  WORKER_SEARCH_STATE.playerIsBlack = null;
  WORKER_SHARED_SNAPSHOT = null;
  y19RescueLadderCache.clear();
  y19ClearSemeaiAnalysisCache();

  MOVE_SCRATCH = null;
  NODE_EXPANSION_SCRATCH = null;
  TERRITORY_SCRATCH = null;
  HISTORY_SCRATCH = null;
  SEARCH_PATH_SCRATCH = null;
  FAST_PLAYOUT_SCRATCH = null;
  EXPANSION_BOARD_SCRATCH = null;
  EYE_SCRATCH = null;
  RETAINED_ROOT_EDGE_SCRATCH.fill(null);
  clearAIPatternCache();
  clearAIPolicyCache();
  return 0;
}

function snapshotChecksum(buffer) {
  const bytes = new Uint8Array(buffer);
  let hash = 0x811C9DC5;
  for (let index = 0; index < bytes.length; index++) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193);
  }
  return hash >>> 0;
}

function fullSnapshotUpdate(snapshot) {
  return {
    type: "full",
    boardSize: snapshot.boardSize,
    opponent: snapshot.opponent,
    buffer: snapshot.buffer,
  };
}

function encodeSearchSnapshotUpdate(base, snapshot, allowDelta = true) {
  if (!allowDelta ||
    !base ||
    base.boardSize !== snapshot.boardSize ||
    base.opponent !== snapshot.opponent) {
    return fullSnapshotUpdate(snapshot);
  }

  const baseBytes = new Uint8Array(base.buffer);
  const nextBytes = new Uint8Array(snapshot.buffer);
  const ranges = [];
  let start = -1;
  let lastChanged = -1;
  for (let index = 0; index < nextBytes.length; index++) {
    const changed =
      nextBytes[index] !== (index < baseBytes.length ? baseBytes[index] : 0);
    if (!changed) continue;
    if (start < 0) {
      start = index;
    } else if (index - lastChanged > SEARCH_DELTA_MERGE_GAP + 1) {
      ranges.push([start, lastChanged + 1]);
      start = index;
    }
    lastChanged = index;
  }
  if (start >= 0) ranges.push([start, lastChanged + 1]);

  let byteLength = SEARCH_DELTA_HEADER_BYTES;
  for (const [rangeStart, rangeEnd] of ranges) {
    byteLength += 8 + rangeEnd - rangeStart;
  }
  if (byteLength >= snapshot.buffer.byteLength) {
    return fullSnapshotUpdate(snapshot);
  }

  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, SEARCH_DELTA_MAGIC, true);
  view.setUint16(4, 1, true);
  view.setUint32(8, base.buffer.byteLength, true);
  view.setUint32(12, snapshot.buffer.byteLength, true);
  view.setUint32(16, snapshotChecksum(base.buffer), true);
  view.setUint32(20, ranges.length, true);
  let writeOffset = SEARCH_DELTA_HEADER_BYTES;
  for (const [rangeStart, rangeEnd] of ranges) {
    const length = rangeEnd - rangeStart;
    view.setUint32(writeOffset, rangeStart, true);
    view.setUint32(writeOffset + 4, length, true);
    writeOffset += 8;
    new Uint8Array(buffer, writeOffset, length).set(
      nextBytes.subarray(rangeStart, rangeEnd)
    );
    writeOffset += length;
  }
  return {
    type: "delta",
    boardSize: snapshot.boardSize,
    opponent: snapshot.opponent,
    buffer,
  };
}

function applySearchSnapshotUpdate(base, update, size, opponent) {
  if (!update ||
    update.boardSize !== size ||
    update.opponent !== opponent ||
    !(update.buffer instanceof ArrayBuffer)) {
    return null;
  }
  if (update.type === "full") {
    return {
      boardSize: size,
      opponent,
      buffer: update.buffer,
    };
  }
  if (update.type !== "delta" ||
    !base ||
    base.boardSize !== size ||
    base.opponent !== opponent) {
    return null;
  }

  const view = new DataView(update.buffer);
  if (update.buffer.byteLength < SEARCH_DELTA_HEADER_BYTES ||
    view.getUint32(0, true) !== SEARCH_DELTA_MAGIC ||
    view.getUint16(4, true) !== 1 ||
    view.getUint32(8, true) !== base.buffer.byteLength ||
    view.getUint32(16, true) !== snapshotChecksum(base.buffer)) {
    return null;
  }

  const nextLength = view.getUint32(12, true);
  const rangeCount = view.getUint32(20, true);
  const buffer = new ArrayBuffer(nextLength);
  const output = new Uint8Array(buffer);
  output.set(
    new Uint8Array(base.buffer, 0, Math.min(base.buffer.byteLength, nextLength))
  );
  let readOffset = SEARCH_DELTA_HEADER_BYTES;
  for (let range = 0; range < rangeCount; range++) {
    if (readOffset + 8 > update.buffer.byteLength) return null;
    const start = view.getUint32(readOffset, true);
    const length = view.getUint32(readOffset + 4, true);
    readOffset += 8;
    if (start + length > nextLength ||
      readOffset + length > update.buffer.byteLength) {
      return null;
    }
    output.set(
      new Uint8Array(update.buffer, readOffset, length),
      start
    );
    readOffset += length;
  }
  if (readOffset !== update.buffer.byteLength) return null;
  return { boardSize: size, opponent, buffer };
}

function encodeSearchSnapshot(map, size, opponent) {
  const nodes = [...map.values()];
  const nodeIndex = new Map(nodes.map((node, index) => [node, index]));
  let activeEdgeCount = 0;
  let pendingEdgeCount = 0;
  for (const node of nodes) {
    activeEdgeCount += node.children.length;
    pendingEdgeCount += node.pendingChildren?.length ?? 0;
  }

  const nodeRecordsOffset = SEARCH_SNAPSHOT_HEADER_BYTES;
  const edgeRecordsOffset =
    nodeRecordsOffset + nodes.length * SEARCH_SNAPSHOT_NODE_BYTES;
  const pendingRecordsOffset =
    edgeRecordsOffset + activeEdgeCount * SEARCH_SNAPSHOT_EDGE_BYTES;
  const buffer = new ArrayBuffer(
    pendingRecordsOffset + pendingEdgeCount * SEARCH_SNAPSHOT_PENDING_BYTES
  );
  const view = new DataView(buffer);
  view.setUint32(0, SEARCH_SNAPSHOT_MAGIC, true);
  view.setUint16(4, 8, true);
  view.setUint16(6, size, true);
  view.setUint32(8, nodes.length, true);
  view.setUint32(12, activeEdgeCount, true);
  view.setUint32(16, pendingEdgeCount, true);
  // Boards are derived from each hash plus the game-constant offline mask.
  view.setInt32(20, nodes[0]?.offlineBits ?? 0, true);

  let edgeIndex = 0;
  let pendingIndex = 0;
  for (let nodeIndexValue = 0; nodeIndexValue < nodes.length; nodeIndexValue++) {
    const node = nodes[nodeIndexValue];
    const offset = nodeRecordsOffset + nodeIndexValue * SEARCH_SNAPSHOT_NODE_BYTES;
    view.setFloat64(offset, node.hash, true);
    view.setUint32(offset + 8, edgeIndex, true);
    view.setUint8(offset + 12, node.children.length);
    view.setUint8(offset + 13, node.pendingChildren?.length ?? 0);
    view.setUint8(offset + 14, node.blackToPlay ? 1 : 0);
    view.setUint8(offset + 15, node.DP ? 1 : 0);
    view.setFloat64(offset + 16, node.N, true);
    view.setFloat64(offset + 24, node.U, true);
    view.setFloat64(offset + 32, node.S, true);
    view.setFloat64(offset + 40, node.SS, true);
    view.setFloat64(offset + 48, node.DP?.[1] ?? 0, true);
    view.setFloat64(offset + 56, node.DP?.[5] ?? 0, true);
    view.setUint32(offset + 64, node.transpositionContext ?? 0, true);
    view.setUint32(offset + 68, node.legalMask ?? 0, true);
    view.setUint32(offset + 72, node.nonAtariLegalMask ?? 0, true);
    view.setFloat32(offset + 76, node.priorWeight ?? 1, true);

    for (const edge of node.children) {
      const edgeOffset = edgeRecordsOffset + edgeIndex++ * SEARCH_SNAPSHOT_EDGE_BYTES;
      const childIndex = nodeIndex.get(edge.nn);
      view.setFloat64(edgeOffset, edge.hash, true);
      view.setInt16(edgeOffset + 8, edge.pos, true);
      view.setInt16(edgeOffset + 10, edge.weight, true);
      view.setInt16(edgeOffset + 12, childIndex ?? -1, true);
      view.setInt16(edgeOffset + 14, -3, true);
      view.setFloat64(edgeOffset + 16, edge.visits, true);
      view.setFloat64(edgeOffset + 24, edge.leafSum, true);
      view.setFloat64(edgeOffset + 32, edge.leafSquaredSum, true);
      view.setFloat64(edgeOffset + 40, edge.leafVisits, true);
      view.setUint8(edgeOffset + 48, edge.leafVisits > 0 ? 1 : 0);
    }

    for (const edge of node.pendingChildren ?? []) {
      const pendingOffset =
        pendingRecordsOffset + pendingIndex++ * SEARCH_SNAPSHOT_PENDING_BYTES;
      view.setFloat64(pendingOffset, edge.hash, true);
      view.setInt16(pendingOffset + 8, edge.pos, true);
      view.setInt16(pendingOffset + 10, edge.weight, true);
    }
  }
  return { boardSize: size, opponent, buffer };
}

function decodeSearchSnapshot(snapshot, size, opponent) {
  if (!snapshot ||
    snapshot.boardSize !== size ||
    snapshot.opponent !== opponent ||
    !(snapshot.buffer instanceof ArrayBuffer)) {
    return null;
  }
  const view = new DataView(snapshot.buffer);
  if (view.getUint32(0, true) !== SEARCH_SNAPSHOT_MAGIC ||
    view.getUint16(4, true) !== 8 ||
    view.getUint16(6, true) !== size) {
    return null;
  }

  const nodeCount = view.getUint32(8, true);
  const activeEdgeCount = view.getUint32(12, true);
  const pendingEdgeCount = view.getUint32(16, true);
  const offlineBits = view.getInt32(20, true);
  const nodeRecordsOffset = SEARCH_SNAPSHOT_HEADER_BYTES;
  const edgeRecordsOffset =
    nodeRecordsOffset + nodeCount * SEARCH_SNAPSHOT_NODE_BYTES;
  const pendingRecordsOffset =
    edgeRecordsOffset + activeEdgeCount * SEARCH_SNAPSHOT_EDGE_BYTES;
  const nodes = new Array(nodeCount);

  for (let index = 0; index < nodeCount; index++) {
    const offset = nodeRecordsOffset + index * SEARCH_SNAPSHOT_NODE_BYTES;
    const node = Object.create(MCGSNode.prototype);
    node.hash = view.getFloat64(offset, true);
    node.blackToPlay = !!view.getUint8(offset + 14);
    node.lastPassed = !!(node.hash % 2);
    node.N = view.getFloat64(offset + 16, true);
    node.U = view.getFloat64(offset + 24, true);
    node.S = view.getFloat64(offset + 32, true);
    node.SS = view.getFloat64(offset + 40, true);
    node.transpositionContext = view.getUint32(offset + 64, true);
    node.legalMask = view.getUint32(offset + 68, true);
    node.nonAtariLegalMask = view.getUint32(offset + 72, true);
    node.priorWeight = view.getFloat32(offset + 76, true);
    node.DP = (view.getUint8(offset + 15) & 1)
      ? ["t", view.getFloat64(offset + 48, true), null, null, 1,
        view.getFloat64(offset + 56, true)]
      : null;
    const positionKey = positionKeyFromState5(node.hash);
    node.blackBits = Math.floor(positionKey / POSITION_KEY_STRIDE_5);
    node.whiteBits = positionKey - node.blackBits * POSITION_KEY_STRIDE_5;
    node.offlineBits = offlineBits;
    node.children = [];
    node.pendingChildren = null;
    node.nextWidenN = 0;
    node.isChance =
      node.blackToPlay !== SEARCH_PLAYER_IS_BLACK && opponent !== "No AI";
    node.opponentCode = node.isChance
      ? policyOpponentCode(opponent) + (SEARCH_PLAYER_IS_BLACK ? 0 : 8)
      : 0;
    node.updateCPUct();
    nodes[index] = node;
  }

  let pendingIndex = 0;
  for (let nodeIndexValue = 0; nodeIndexValue < nodeCount; nodeIndexValue++) {
    const nodeOffset = nodeRecordsOffset + nodeIndexValue * SEARCH_SNAPSHOT_NODE_BYTES;
    const firstEdge = view.getUint32(nodeOffset + 8, true);
    const activeEdges = view.getUint8(nodeOffset + 12);
    const pendingEdges = view.getUint8(nodeOffset + 13);
    const node = nodes[nodeIndexValue];
    const decodedPending = pendingEdges ? new Array(pendingEdges) : null;
    for (let localIndex = 0; localIndex < activeEdges; localIndex++) {
      const edgeOffset =
        edgeRecordsOffset + (firstEdge + localIndex) * SEARCH_SNAPSHOT_EDGE_BYTES;
      const childIndex = view.getInt16(edgeOffset + 12, true);
      const edge = new MCGSEdge(
        view.getFloat64(edgeOffset, true),
        view.getInt16(edgeOffset + 8, true),
        view.getInt16(edgeOffset + 10, true)
      );
      edge.visits = view.getFloat64(edgeOffset + 16, true);
      edge.nn = childIndex >= 0 ? nodes[childIndex] : null;
      edge.leafSum = view.getFloat64(edgeOffset + 24, true);
      edge.leafSquaredSum = view.getFloat64(edgeOffset + 32, true);
      edge.leafVisits = view.getFloat64(edgeOffset + 40, true);
      node.children.push(edge);
    }
    for (let localIndex = 0; localIndex < pendingEdges; localIndex++) {
      const pendingOffset =
        pendingRecordsOffset + pendingIndex++ * SEARCH_SNAPSHOT_PENDING_BYTES;
      decodedPending[localIndex] = new MCGSEdge(
        view.getFloat64(pendingOffset, true),
        view.getInt16(pendingOffset + 8, true),
        view.getInt16(pendingOffset + 10, true)
      );
    }
    node.pendingChildren = decodedPending
      ? new PendingEdgeStore(decodedPending)
      : null;
  }
  // Chance values depend on their relinked response edges, which are not
  // available during the first node-record pass.
  for (let index = nodes.length; index-- > 0;) {
    nodes[index].updateCPUct();
  }
  return nodes;
}

function createSearchSnapshot(
  board,
  size,
  opponent,
  lastPassed = false,
  playerIsBlack = isBlack,
  historyHashes = []
) {
  requireSupportedBoardSize(size);
  if (WORKER_SEARCH_STATE.boardSize !== size ||
    WORKER_SEARCH_STATE.opponent !== opponent ||
    WORKER_SEARCH_STATE.playerIsBlack !== playerIsBlack) {
    return null;
  }

  BOARD_SIZE = size;
  SEARCH_PLAYER_IS_BLACK = playerIsBlack;
  const linearBoard = linearizeBoard(board);
  const rootHash = stateKey5(
    zobristHashLinear(linearBoard, false),
    playerIsBlack,
    lastPassed
  );
  const map = WORKER_SEARCH_STATE.map;
  const rootHistory = new LayeredHistory(new ExactHistorySet5(historyHashes));
  rootHistory.add(positionKeyFromState5(rootHash));
  const retainedRoot = transpositionNodeForHistory(
    map,
    rootHash,
    rootHistory
  );
  if (!retainedRoot) {
    map.clear();
    return null;
  }
  const rootContext = retainedRoot.transpositionContext ?? 0;

  pruneSearchMapToRoot(map, rootHash, rootContext);
  trimSearchMapForRetention(
    map,
    null,
    rootHash,
    rootContext,
    PLAYOUTS
  );
  return encodeSearchSnapshot(map, size, opponent);
}

function createSearchSnapshotUpdate(
  board,
  size,
  opponent,
  lastPassed = false,
  allowDelta = true,
  playerIsBlack = isBlack,
  historyHashes = []
) {
  const snapshot = createSearchSnapshot(
    board,
    size,
    opponent,
    lastPassed,
    playerIsBlack,
    historyHashes
  );
  if (!snapshot) {
    WORKER_SHARED_SNAPSHOT = null;
    return {
      type: "reset",
      boardSize: size,
      opponent,
      buffer: new ArrayBuffer(0),
    };
  }
  const update = encodeSearchSnapshotUpdate(
    WORKER_SHARED_SNAPSHOT,
    snapshot,
    allowDelta
  );
  WORKER_SHARED_SNAPSHOT = update.type === "full"
    ? {
      boardSize: size,
      opponent,
      buffer: snapshot.buffer.slice(0),
    }
    : snapshot;
  return update;
}

function importSearchSnapshot(
  snapshot,
  size,
  opponent,
  playerIsBlack = isBlack
) {
  requireSupportedBoardSize(size);
  BOARD_SIZE = size;
  SEARCH_PLAYER_IS_BLACK = playerIsBlack;
  const map = WORKER_SEARCH_STATE.map;
  map.clear();
  WORKER_SEARCH_STATE.boardSize = size;
  WORKER_SEARCH_STATE.opponent = opponent;
  WORKER_SEARCH_STATE.playerIsBlack = playerIsBlack;
  const nodes = decodeSearchSnapshot(snapshot, size, opponent);
  if (!nodes) return 0;
  for (const node of nodes) map.set(node.hash, node);
  return map.size;
}

function importSearchSnapshotUpdate(
  update,
  size,
  opponent,
  playerIsBlack = isBlack
) {
  if (update?.type === "reset" &&
    update.boardSize === size &&
    update.opponent === opponent) {
    WORKER_SHARED_SNAPSHOT = null;
    WORKER_SEARCH_STATE.map.clear();
    WORKER_SEARCH_STATE.boardSize = size;
    WORKER_SEARCH_STATE.opponent = opponent;
    WORKER_SEARCH_STATE.playerIsBlack = playerIsBlack;
    SEARCH_PLAYER_IS_BLACK = playerIsBlack;
    return 0;
  }
  const snapshot = applySearchSnapshotUpdate(
    WORKER_SHARED_SNAPSHOT,
    update,
    size,
    opponent
  );
  if (!snapshot) {
    WORKER_SHARED_SNAPSHOT = null;
    return -1;
  }
  const imported = importSearchSnapshot(
    snapshot,
    size,
    opponent,
    playerIsBlack
  );
  if (!imported) {
    WORKER_SHARED_SNAPSHOT = null;
    return imported;
  }
  WORKER_SHARED_SNAPSHOT = snapshot;
  return imported;
}

function pruneSearchMapToRoot(map, rootHash, rootContext = 0) {
  const retainedRoot = map.get(rootHash, rootContext);
  if (!retainedRoot) {
    map.clear();
    return 0;
  }

  const keep = new Set();
  const stack = [retainedRoot];
  while (stack.length) {
    const node = stack.pop();
    if (keep.has(node)) continue;
    keep.add(node);

    for (const edge of node.children) {
      if (edge.nn && !keep.has(edge.nn)) stack.push(edge.nn);
    }
  }

  for (const node of [...map.values()]) {
    if (!keep.has(node)) {
      map.delete(node.hash, node.transpositionContext ?? 0);
    }
  }
  return keep.size;
}

function scaledSearchNodeLimit(baseLimit, minimum) {
  const points = BOARD_SIZE * BOARD_SIZE;
  return Math.max(minimum, Math.floor(baseLimit * 25 / points));
}

function updateChanceDecisionMoments(node) {
  let totalWeight = 0;
  let weightedValue = 0;
  let weightedSecondMoment = 0;
  for (const edge of node.children) {
    if (edge.weight <= 0) continue;
    let value = node.U;
    let secondMoment = node.U * node.U;
    if (edge.pos === -1 && node.lastPassed && node.DP) {
      value = node.DP[5];
      secondMoment = value * value;
    } else {
      const leafVisits = edge.leafVisits;
      const childVisits = edge.nn
        ? Math.max(0, edge.visits - leafVisits)
        : 0;
      const visits = leafVisits + childVisits;
      if (visits) {
        value = (
          edge.leafSum +
          (edge.nn ? childVisits * nodeDecisionValue(edge.nn) : 0)
        ) / visits;
        secondMoment = (
          edge.leafSquaredSum +
          (edge.nn
            ? childVisits * nodeDecisionSecondMoment(edge.nn)
            : 0)
        ) / visits;
      }
    }
    totalWeight += edge.weight;
    weightedValue += edge.weight * value;
    weightedSecondMoment += edge.weight * secondMoment;
  }
  if (!totalWeight) return null;
  const value = weightedValue / totalWeight;
  const secondMoment = weightedSecondMoment / totalWeight;
  node.decisionValue = value;
  node.decisionSecondMoment = secondMoment;
  return Math.max(0, secondMoment - value * value);
}

function effectiveChanceResponseWeight(
  edge,
  reducedWeights,
  reducedPass,
  laneMask = null,
  lanePass = true
) {
  if (edge.pos === -1 && !lanePass) return 0;
  if (edge.pos >= 0 && laneMask != null &&
    !(laneMask & (1 << edge.pos))) {
    return 0;
  }
  if (!reducedWeights) return edge.weight;
  if (edge.pos === -1) {
    return reducedPass ? reducedWeights[25] : 0;
  }
  return reducedWeights[edge.pos];
}

function getChanceLaneAssignments(node, laneQuotas) {
  const laneCount = laneQuotas?.length ?? 0;
  if (laneCount <= 1) return null;
  const edges = node.children
    .filter(edge => edge.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.pos - b.pos);
  if (edges.length < laneCount) return null;

  const masks = new Uint32Array(laneCount);
  const passes = new Uint8Array(laneCount);
  const weights = new Float64Array(laneCount);
  const quotaTotal = laneQuotas.reduce((sum, quota) => sum + quota, 0);
  const sourceTotal = edges.reduce((sum, edge) => sum + edge.weight, 0);
  const targets = laneQuotas.map(quota =>
    quotaTotal ? sourceTotal * quota / quotaTotal : 0
  );
  const laneOrder = Array.from(
    { length: laneCount },
    (_, lane) => lane
  ).sort((a, b) => targets[b] - targets[a] || a - b);

  for (let index = 0; index < edges.length; index++) {
    let lane;
    if (index < laneCount) {
      lane = laneOrder[index];
    } else {
      lane = 0;
      let largestDeficit = -Infinity;
      for (let candidate = 0; candidate < laneCount; candidate++) {
        const deficit = targets[candidate] - weights[candidate];
        if (deficit > largestDeficit) {
          lane = candidate;
          largestDeficit = deficit;
        }
      }
    }
    const edge = edges[index];
    weights[lane] += edge.weight;
    if (edge.pos === -1) passes[lane] = 1;
    else masks[lane] |= 1 << edge.pos;
  }
  return { masks, passes, weights, sourceTotal };
}

function getRootTaskChanceLane(node, task) {
  if (!task || task.laneCount <= 1) return null;
  const context = node.transpositionContext ?? 0;
  if (task.laneCacheHash !== node.hash ||
    task.laneCacheContext !== context) {
    task.laneCacheHash = node.hash;
    task.laneCacheContext = context;
    task.laneCache = getChanceLaneAssignments(node, task.laneQuotas);
  }
  const assignments = task.laneCache;
  if (!assignments) return null;
  return {
    mask: assignments.masks[task.laneIndex],
    pass: !!assignments.passes[task.laneIndex],
    sourceWeight: assignments.weights[task.laneIndex],
    sourceTotal: assignments.sourceTotal,
  };
}

function adaptiveChanceResponseMinimum(totalVisits, responseCount) {
  if (!responseCount || CHANCE_RESPONSE_MIN_VISITS <= 0) return 0;
  return Math.min(
    CHANCE_RESPONSE_MIN_VISITS,
    Math.max(
      1,
      Math.floor(
        totalVisits * CHANCE_RESPONSE_QUOTA_FRACTION / responseCount
      )
    )
  );
}

function selectStratifiedChanceResponse(
  node,
  sampleCount,
  seen,
  reducedWeights,
  reducedPass,
  lastPassed,
  laneMask = null,
  lanePass = true
) {
  let totalWeight = 0;
  let totalVisits = 0;
  let responseCount = 0;
  let passWeight = 0;

  if (lastPassed && node.children[0]?.pos === -1) {
    passWeight = effectiveChanceResponseWeight(
      node.children[0],
      reducedWeights,
      reducedPass,
      laneMask,
      lanePass
    );
    if (passWeight > 0) {
      const visits = node.DP?.[1] ?? 0;
      totalWeight += passWeight;
      totalVisits += visits;
      responseCount++;
    }
  }

  for (let index = 0; index < sampleCount; index++) {
    const edge = node.children[index];
    if (edge.pos === -1) {
      if (lastPassed) continue;
    } else if (seen.has(edge.positionKey)) {
      continue;
    }
    const weight = effectiveChanceResponseWeight(
      edge,
      reducedWeights,
      reducedPass,
      laneMask,
      lanePass
    );
    if (weight <= 0) continue;
    const visits = edge.visits;
    totalWeight += weight;
    totalVisits += visits;
    responseCount++;
  }

  if (totalWeight <= 0) return null;

  const quotaMinimum = adaptiveChanceResponseMinimum(
    totalVisits,
    responseCount
  );
  const targetVisits = totalVisits + 1;
  let quotaSelection = null;
  let quotaVisits = Infinity;
  let quotaWeight = -Infinity;
  let selection = null;
  let largestDeficit = -Infinity;
  if (passWeight > 0) {
    const visits = node.DP?.[1] ?? 0;
    if (visits < quotaMinimum) {
      quotaSelection = node.DP;
      quotaVisits = visits;
      quotaWeight = passWeight;
    }
    const deficit =
      passWeight / totalWeight * targetVisits - visits;
    selection = node.DP;
    largestDeficit = deficit;
  }
  for (let index = 0; index < sampleCount; index++) {
    const edge = node.children[index];
    if (edge.pos === -1) {
      if (lastPassed) continue;
    } else if (seen.has(edge.positionKey)) {
      continue;
    }
    const weight = effectiveChanceResponseWeight(
      edge,
      reducedWeights,
      reducedPass,
      laneMask,
      lanePass
    );
    if (weight <= 0) continue;
    const visits = edge.visits;
    if (visits < quotaMinimum &&
      (visits < quotaVisits ||
        (visits === quotaVisits && weight > quotaWeight))) {
      quotaSelection = edge;
      quotaVisits = visits;
      quotaWeight = weight;
    }
    const deficit = weight / totalWeight * targetVisits - visits;
    if (deficit > largestDeficit) {
      selection = edge;
      largestDeficit = deficit;
    }
  }
  return quotaSelection ?? selection;
}

function nodeDecisionValue(node) {
  // Cached by updateCPUct / ensureDoublePassOption. After a pass, the
  // player to move can end the game immediately: exploration may estimate
  // something better, but it cannot make that proven option worse.
  return node.decisionValue;
}

function nodeDecisionSecondMoment(node) {
  return node.decisionSecondMoment ??
    (node.SS / node.N);
}

function ensureDoublePassOption(node) {
  const terminalValue = scoreTerminalBits5(
    node.blackBits,
    node.whiteBits,
    node.offlineBits,
    true
  );
  if (node.DP) node.DP[5] = terminalValue;
  else node.DP = ['t', 0, null, null, 1, terminalValue];
  node.updateCPUct();
  return node.DP;
}

function writeEdgeContribution(edge, sums, squaredSums, index) {
  const leafSum = edge.leafSum;
  const leafSquaredSum = edge.leafSquaredSum;
  const leafVisits = edge.leafVisits;
  const childVisits = edge.nn ? Math.max(0, edge.visits - leafVisits) : 0;
  if (!edge.nn || !childVisits) {
    sums[index] = leafSum;
    squaredSums[index] = leafSquaredSum;
    return;
  }

  const child = edge.nn;
  sums[index] = leafSum + childVisits * nodeDecisionValue(child);
  squaredSums[index] = leafSquaredSum +
    childVisits * nodeDecisionSecondMoment(child);
}

function recalculateNodeFromEdges(node) {
  const priorWeight = node.priorWeight ?? 1;
  let visits = priorWeight;
  let sum = priorWeight * node.U;
  let squaredSum = priorWeight * node.U * node.U;

  for (const edge of node.children) {
    const leafSum = edge.leafSum;
    const leafSquaredSum = edge.leafSquaredSum;
    const leafVisits = edge.leafVisits;
    const childVisits = edge.nn ? Math.max(0, edge.visits - leafVisits) : 0;

    visits += childVisits + leafVisits;
    sum += leafSum;
    squaredSum += leafSquaredSum;
    if (edge.nn && childVisits) {
      sum += childVisits * nodeDecisionValue(edge.nn);
      squaredSum += childVisits * nodeDecisionSecondMoment(edge.nn);
    }
  }

  if (node.DP) {
    visits += node.DP[1];
    sum += node.DP[1] * node.DP[5];
    squaredSum += node.DP[1] * node.DP[5] * node.DP[5];
  }
  node.N = visits;
  node.S = sum;
  node.SS = squaredSum;
  node.updateCPUct();
}

function hydrateRootFromRetained(
  root,
  retainedRoot,
  map,
  freshRootMask = 0
) {
  if (!retainedRoot) return;
  RETAINED_ROOT_EDGE_SCRATCH.fill(null);
  for (const edge of retainedRoot.children) {
    RETAINED_ROOT_EDGE_SCRATCH[edge.pos + 1] = edge;
  }

  root.U = retainedRoot.U;
  root.priorWeight = retainedRoot.priorWeight ?? 1;
  root.DP = !(freshRootMask & 1) && retainedRoot.DP
    ? [...retainedRoot.DP]
    : null;
  for (const edge of root.children) {
    if (freshRootMask & (1 << (edge.pos + 1))) continue;
    const retained = RETAINED_ROOT_EDGE_SCRATCH[edge.pos + 1];
    if (!retained || retained.hash !== edge.hash) continue;
    edge.weight = retained.weight;
    edge.visits = retained.visits;
    edge.value = retained.value;
    edge.leafSum = retained.leafSum;
    edge.leafSquaredSum = retained.leafSquaredSum;
    edge.leafVisits = retained.leafVisits;
    edge.nn = retained.nn ?? null;
    enforceEdgeLeafEvidenceBound(edge, edge.nn);
  }
  recalculateNodeFromEdges(root);
}

function purgeProvenWorthlessNodes(map, requiredHash = null) {
  for (const node of map.values()) {
    if (
      node.hash === requiredHash ||
      !node.lastPassed ||
      !node.DP ||
      (!node.children.length && !node.pendingChildren?.length)
    ) {
      continue;
    }
    const terminalValue = node.DP[5];
    const isProvenWin = node.blackToPlay
      ? terminalValue > 0
      : terminalValue < 0;
    if (!isProvenWin) continue;
    if (node.isChance) {
      PROVEN_CHANCE_PURGE_SKIP_COUNT++;
      continue;
    }

    PROVEN_NODE_PURGE_COUNT++;
    PROVEN_NODE_PURGED_EDGE_COUNT +=
      node.children.length + (node.pendingChildren?.length ?? 0);
    node.children.length = 0;
    node.pendingChildren = null;
    recalculateNodeFromEdges(node);
  }
}

function boundRetainedEvidence(map, playoutBudget = PLAYOUTS) {
  const maximum = Math.max(
    LEAF_EVIDENCE_WINDOW,
    playoutBudget * RETAINED_EVIDENCE_MAX_FRACTION
  );
  for (const node of map.values()) {
    if (!(node.N > maximum)) continue;
    const before = node.N;
    const scale = maximum / before;
    node.priorWeight = (node.priorWeight ?? 1) * scale;
    for (const edge of node.children) {
      edge.visits *= scale;
      edge.leafVisits *= scale;
      edge.leafSum *= scale;
      edge.leafSquaredSum *= scale;
    }
    if (node.DP) node.DP[1] *= scale;
    node.N *= scale;
    node.S *= scale;
    node.SS *= scale;
    node.updateCPUct();
    RETAINED_EVIDENCE_SCALE_COUNT++;
    RETAINED_EVIDENCE_REMOVED += before - node.N;
  }
}

function enforceEdgeLeafEvidenceBound(edge, child) {
  let changed = false;
  if (edge.leafVisits > LEAF_EVIDENCE_WINDOW) {
    const scale = LEAF_EVIDENCE_WINDOW / edge.leafVisits;
    edge.leafSum *= scale;
    edge.leafSquaredSum *= scale;
    edge.leafVisits = LEAF_EVIDENCE_WINDOW;
    changed = true;
  }
  if (!child) {
    // Without a child node every visit was a leaf rollout; the edge's visit
    // count must match its (bounded) evidence or it distorts selection.
    const leafVisits = edge.leafVisits;
    if (edge.visits !== leafVisits) {
      edge.visits = leafVisits;
      edge.value = leafVisits ? edge.leafSum / leafVisits : 0;
      changed = true;
    }
  }
  return changed;
}

function enforceLeafEvidenceBounds(map) {
  let changed = false;
  for (const node of map.values()) {
    for (const edge of node.children) {
      const child = edge.nn;
      if (enforceEdgeLeafEvidenceBound(edge, child)) changed = true;
    }
  }
  return changed;
}

function rebuildRetainedStatistics(nodes) {
  // A single bottom-up pass can process a drifted child AFTER its parent
  // (the N-sort uses pre-rebuild counts), leaving the parent holding the
  // child's stale value; cycles rule out a perfect topological order, so
  // iterate the rebuild to a fixpoint with a small pass cap.
  for (let pass = 0; pass < 4; pass++) {
    let maxShift = 0;
    for (const node of nodes) {
      const before = node.decisionValue;
      recalculateNodeFromEdges(node);
      const shift = Math.abs(node.decisionValue - before);
      if (shift > maxShift) maxShift = shift;
    }
    if (maxShift < 1e-9) break;
  }
}

function retainedSearchNodeLimitForBudget(
  activeNodeLimit,
  playoutBudget,
  currentNodeCount,
  nodeCreations = playoutBudget,
  blockedExpansionCount = 0
) {
  const rootReserve = Math.min(
    activeNodeLimit,
    scaledSearchNodeLimit(RETAINED_ROOT_RESERVE_NODES, 1)
  );
  const targetFreshNodeBudget = Math.min(
    Math.max(0, Math.ceil(playoutBudget || 0)),
    Math.floor(activeNodeLimit * 0.5)
  );
  const refreshNodeBudget =
    currentNodeCount >= activeNodeLimit || blockedExpansionCount > 0
      ? targetFreshNodeBudget
      : Math.max(0, targetFreshNodeBudget - Math.max(0, nodeCreations));
  if (refreshNodeBudget <= 0) return activeNodeLimit;
  return Math.max(rootReserve, currentNodeCount - refreshNodeBudget);
}

function retainedFreshNodeBudgetForBudget(
  activeNodeLimit,
  playoutBudget,
  currentNodeCount,
  nodeCreations = playoutBudget,
  blockedExpansionCount = 0
) {
  return Math.max(
    0,
    currentNodeCount -
    retainedSearchNodeLimitForBudget(
      activeNodeLimit,
      playoutBudget,
      currentNodeCount,
      nodeCreations,
      blockedExpansionCount
    )
  );
}

function minimumPlayoutBudgetForSaturation(basePlayouts, rootTaskCount = 0) {
  const budget = Math.max(0, Math.ceil(basePlayouts || 0));
  if (budget <= 1) return budget;
  const fractionalFloor =
    Math.ceil(budget * SATURATED_PLAYOUT_MIN_FRACTION);
  const taskFloor = rootTaskCount > 0
    ? rootTaskCount * SATURATED_PLAYOUT_MIN_VISITS_PER_ROOT_TASK
    : 0;
  return Math.min(
    budget,
    Math.max(
      1,
      fractionalFloor,
      taskFloor,
      SATURATED_PLAYOUT_CHECK_INTERVAL
    )
  );
}

function saturatedPlayoutExtraBudget(basePlayouts) {
  const budget = Math.max(0, Math.ceil(basePlayouts || 0));
  return Math.max(
    SATURATED_PLAYOUT_EXTRA_LEAF_VISITS,
    Math.ceil(budget * SATURATED_PLAYOUT_EXTRA_FRACTION)
  );
}

function updateRootTaskSaturation(task, activeNodeLimit, currentNodeCount) {
  if (!SATURATED_PLAYOUT_REBALANCE_ENABLED || task.saturated) return;
  const quota = Math.max(0, Math.ceil(task.quota || 0));
  if (quota <= 1 || task.used < SATURATED_PLAYOUT_CHECK_INTERVAL) return;
  const minimumBudget = minimumPlayoutBudgetForSaturation(quota, 1);
  if (task.used < minimumBudget) return;

  const creationRate = task.nodeCreations / Math.max(1, task.used);
  const expansionBlocked =
    currentNodeCount >= activeNodeLimit || task.blockedExpansionCount > 0;
  if (!expansionBlocked &&
    creationRate > SATURATED_PLAYOUT_NEW_NODE_RATE) {
    task.saturationStopAt = 0;
    return;
  }

  if (!task.saturationStopAt) {
    task.saturationStopAt = Math.min(
      quota,
      Math.max(minimumBudget, task.used + saturatedPlayoutExtraBudget(quota))
    );
  }
  if (task.used >= task.saturationStopAt) {
    task.saturated = true;
  }
}

function selectActiveRootTask(rootTaskStates) {
  let activeQuotaTotal = 0;
  let activeUsedTotal = 1;
  for (const task of rootTaskStates) {
    if (task.saturated) continue;
    activeQuotaTotal += Math.max(1, task.quota);
    activeUsedTotal += task.used;
  }
  if (!activeQuotaTotal) return null;

  let selectedTask = null;
  let largestDeficit = -Infinity;
  for (const candidate of rootTaskStates) {
    if (candidate.saturated) continue;
    const deficit =
      Math.max(1, candidate.quota) / activeQuotaTotal * activeUsedTotal -
      candidate.used;
    if (deficit > largestDeficit) {
      selectedTask = candidate;
      largestDeficit = deficit;
    }
  }
  return selectedTask;
}

function trimSearchMapForRetention(
  map,
  limit = null,
  requiredHash = null,
  requiredContext = 0,
  playoutBudget = PLAYOUTS,
  nodeCreations = playoutBudget,
  blockedExpansionCount = 0
) {
  if (PURGE_PROVEN_WORTHLESS_NODES) {
    purgeProvenWorthlessNodes(map, requiredHash);
  }
  boundRetainedEvidence(map, playoutBudget);
  const activeNodeLimit =
    scaledSearchNodeLimit(MAX_ACTIVE_SEARCH_NODES_PER_WORKER, 100);
  limit ??= retainedSearchNodeLimitForBudget(
    activeNodeLimit,
    playoutBudget,
    map.size,
    nodeCreations,
    blockedExpansionCount
  );
  if (map.size <= limit) {
    enforceLeafEvidenceBounds(map);
    // Delta backprop only refreshes an edge's contribution when that edge
    // is selected, so transposition descents drift parent sums away from
    // their edges' current values. Rebuild every retained node at the turn
    // boundary unconditionally — drift compounded across turns past the
    // +/-25.3 utility bound in long games.
    rebuildRetainedStatistics(
      [...map.values()].sort((a, b) => a.N - b.N)
    );
    return map.size;
  }

  const retainedNodes = [...map.values()]
    .sort((a, b) => b.N - a.N)
    .slice(0, limit);
  const requiredNode = requiredHash == null
    ? null
    : map.get(requiredHash, requiredContext);
  if (requiredNode && !retainedNodes.includes(requiredNode)) {
    retainedNodes[retainedNodes.length - 1] = requiredNode;
  }
  const retainedNodeSet = new Set(retainedNodes);

  for (const node of retainedNodes) {
    for (const edge of node.children) {
      const child = edge.nn;
      if (child && retainedNodeSet.has(child)) {
        edge.nn = child;
      } else {
        const leafVisits = edge.leafVisits;
        edge.nn = null;
        edge.visits = leafVisits;
        edge.value = leafVisits ? edge.leafSum / leafVisits : 0;
      }
    }
  }
  for (const node of [...map.values()]) {
    if (!retainedNodeSet.has(node)) {
      map.delete(node.hash, node.transpositionContext ?? 0);
    }
  }
  enforceLeafEvidenceBounds(map);
  rebuildRetainedStatistics(retainedNodes.sort((a, b) => a.N - b.N));
  return map.size;
}

function effectiveChanceLegalMask(node, seen) {
  let mask = node.legalMask >>> 0;
  for (const edge of node.children) {
    if (edge.pos >= 0 && seen.has(edge.positionKey)) {
      mask &= ~(1 << edge.pos);
    }
  }
  return mask >>> 0;
}

function decisionContextFromMasks(legalMask, historyBarredMask) {
  if (!historyBarredMask) return 0;
  const effectiveLegalMask =
    (legalMask & ~historyBarredMask) >>> 0;
  return (DECISION_CONTEXT_TAG | effectiveLegalMask) >>> 0;
}

function effectiveDecisionContext(node, seen) {
  let historyBarredMask = 0;
  for (const edge of node.children) {
    if (edge.pos >= 0 && seen.has(edge.positionKey)) {
      historyBarredMask |= 1 << edge.pos;
    }
  }
  const pending = node.pendingChildren;
  if (pending) {
    for (let index = pending.cursor; index < pending.count; index++) {
      const positionKey = positionKeyFromState5(pending.hashes[index]);
      if (seen.has(positionKey)) {
        historyBarredMask |= 1 << pending.positions[index];
      }
    }
  }
  return decisionContextFromMasks(node.legalMask, historyBarredMask);
}

function transpositionNodeForHistory(map, hash, seen) {
  const template = map.get(hash, 0) ?? map.getAny(hash);
  if (!template) return null;
  const context = template.isChance
    ? effectiveChanceLegalMask(template, seen)
    : effectiveDecisionContext(template, seen);
  return map.get(hash, context) ?? null;
}

function refreshEdgeTransposition(
  edge,
  map,
  seen,
  targetIsChance,
  missGeneration,
  mapAtLimit
) {
  if (!targetIsChance) {
    const template = edge.nn && !edge.nn.isChance
      ? edge.nn
      : map.get(edge.hash, 0) ?? map.getAny(edge.hash);
    if (!template) {
      edge.nn = null;
      return null;
    }
    const context = effectiveDecisionContext(template, seen);
    if (edge.nn && !edge.nn.isChance &&
      edge.nn.transpositionContext === context) {
      return edge.nn;
    }
    if (edge.nn && !edge.nn.isChance) DECISION_CONTEXT_SPLIT_COUNT++;
    if (edge.nnMissGeneration === missGeneration &&
      edge.nnMissContext === context) {
      edge.nn = null;
      return null;
    }
    edge.nn = map.get(edge.hash, context) ?? null;
    if (edge.nn) {
      DECISION_CONTEXT_REUSE_COUNT++;
    } else if (mapAtLimit) {
      edge.nnMissGeneration = missGeneration;
      edge.nnMissContext = context;
    }
    return edge.nn;
  }

  const template = edge.nn?.isChance
    ? edge.nn
    : map.getAny(edge.hash);
  if (!template) {
    edge.nn = null;
    return null;
  }
  const context = effectiveChanceLegalMask(template, seen);
  if (edge.nn?.isChance &&
    edge.nn.transpositionContext === context) {
    return edge.nn;
  }
  if (edge.nn?.isChance) CHANCE_CONTEXT_SPLIT_COUNT++;
  if (edge.nnMissGeneration === missGeneration &&
    edge.nnMissContext === context) {
    edge.nn = null;
    return null;
  }
  edge.nn = map.get(edge.hash, context) ?? null;
  if (edge.nn) {
    CHANCE_CONTEXT_REUSE_COUNT++;
  } else if (mapAtLimit) {
    edge.nnMissGeneration = missGeneration;
    edge.nnMissContext = context;
  }
  return edge.nn;
}

/** 
 * @param {string[] | string[][]} board 
 * @param {boolean} lp
 * @param {number[]} seen_hashes
 */
function getMoves(
  board,
  lp,
  seen_hashes = [],
  rootTasks = null,
  opp,
  size,
  plays,
  firstTime,
  playerIsBlack = isBlack,
  workerIndex = 0,
  cheatAvailable = false,
  runtime = null
) {
  // Runtime settings forwarded by the host on every search. Workers are
  // separate script instances, so live host-side variable changes only reach
  // them through this object — adjustable mid-game without redeploying.
  if (runtime) {
    if (Number.isFinite(runtime.maxActiveNodesPerWorker) &&
      runtime.maxActiveNodesPerWorker > 0) {
      MAX_ACTIVE_SEARCH_NODES_PER_WORKER =
        Math.floor(runtime.maxActiveNodesPerWorker);
    }
    if (Number.isFinite(runtime.cheatCaptureMinStones) &&
      runtime.cheatCaptureMinStones > 0) {
      CHEAT_CAPTURE_MIN_STONES = Math.floor(runtime.cheatCaptureMinStones);
    }
    if (Number.isFinite(runtime.y19BlackNearRadius) &&
      runtime.y19BlackNearRadius > 0) {
      Y19_BLACK_NEAR_RADIUS = Math.floor(runtime.y19BlackNearRadius);
    }
    if (Number.isFinite(runtime.y19WhiteNearRadius) &&
      runtime.y19WhiteNearRadius > 0) {
      Y19_WHITE_NEAR_RADIUS = Math.floor(runtime.y19WhiteNearRadius);
    }
  }
  requireSupportedBoardSize(size);
  SEARCH_PLAYER_IS_BLACK = playerIsBlack;
  configureProgressiveWidening(opp);
  const resetSearch =
    firstTime ||
    WORKER_SEARCH_STATE.boardSize !== size ||
    WORKER_SEARCH_STATE.opponent !== opp ||
    WORKER_SEARCH_STATE.playerIsBlack !== playerIsBlack;
  if (resetSearch) {
    BOARD_SIZE = size;
    PLAYOUTS = plays;
    WORKER_SEARCH_STATE.map.clear();
    WORKER_SHARED_SNAPSHOT = null;
    WORKER_SEARCH_STATE.boardSize = size;
    WORKER_SEARCH_STATE.opponent = opp;
    WORKER_SEARCH_STATE.playerIsBlack = playerIsBlack;
  } else {
    PLAYOUTS = plays;
  }
  let b = linearizeBoard(board);
  const allowedRootPositions = rootTasks == null
    ? null
    : [...new Set(
      rootTasks
        .filter(task => task.pos >= 0 && task.quota > 0)
        .map(task => task.pos)
    )];
  const allowRootPass = rootTasks == null ||
    rootTasks.some(task => task.pos === -1 && task.quota > 0);
  let freshRootMask = 0;
  if (rootTasks) {
    for (const task of rootTasks) {
      if (!task.canonical && task.quota > 0) {
        freshRootMask |= 1 << (task.pos + 1);
      }
    }
  }
  const map = WORKER_SEARCH_STATE.map;
  const baseHistory = new ExactHistorySet5(seen_hashes);
  const seen = new LayeredHistory(baseHistory);
  const rootBoardHash = zobristHashLinear(b, false);
  const rootHash = stateKey5(rootBoardHash, playerIsBlack, lp);
  const searchSequence = ++WORKER_SEARCH_SEQUENCE;
  seedRolloutRng(
    mixExactKey5(rootHash) ^
    Math.imul(workerIndex + 1, 0x9E3779B1) ^
    Math.imul(searchSequence, 0x85EBCA6B)
  );
  seen.add(rootBoardHash);
  const retainedRoot = resetSearch
    ? null
    : transpositionNodeForHistory(map, rootHash, seen);
  if (!resetSearch) {
    if (retainedRoot) {
      pruneSearchMapToRoot(
        map,
        rootHash,
        retainedRoot.transpositionContext ?? 0
      );
    } else {
      map.clear();
    }
  }
  let root = new MCGSNode(
    b,
    playerIsBlack,
    map,
    seen,
    allowedRootPositions,
    opp,
    rootHash,
    false,
    lp
  );
  hydrateRootFromRetained(root, retainedRoot, map, freshRootMask);
  if (allowedRootPositions != null && !allowRootPass) {
    root.children = root.children.filter((edge) => edge.pos !== -1);
    recalculateNodeFromEdges(root);
  }
  seen.reset();
  const rootTaskStates = [];
  const rootTaskStateBySlot = new Array(26);
  let rootTaskQuotaTotal = 0;
  if (rootTasks) {
    for (const task of rootTasks) {
      if (!(task.quota > 0)) continue;
      let selection;
      if (task.pos === -1 && lp) {
        selection = ensureDoublePassOption(root);
      } else {
        selection = root.children.find(edge => edge.pos === task.pos);
      }
      if (!selection) continue;
      const state = {
        ...task,
        selection,
        used: 0,
        nodeCreations: 0,
        blockedExpansionCount: 0,
        saturationStopAt: 0,
        saturated: false,
      };
      rootTaskStates.push(state);
      rootTaskStateBySlot[task.pos + 1] = state;
      rootTaskQuotaTotal += task.quota;
    }
  }
  // Worker root with no legal assigned moves.
  // This can happen often on 5x5 with 20 workers after the board partially fills.
  // Return no moves instead of entering the search loop with root.children[0] undefined.
  if (!root.children.length) {
    return [0, 0, []];
  }
  const activeNodeLimit =
    scaledSearchNodeLimit(MAX_ACTIVE_SEARCH_NODES_PER_WORKER, 100);
  const searchScratch = getSearchPathScratch(activeNodeLimit + 1);
  const { path, selected, previousSum, previousSquaredSum } = searchScratch;
  const missGeneration = ++SEARCH_MISS_GENERATION;
  let nodeCreations = 0;
  let blockedExpansionCount = 0;
  const assignedPlayoutBudget = rootTaskStates.length
    ? rootTaskQuotaTotal
    : PLAYOUTS;
  const effectivePlayouts = (root.blackBits | root.whiteBits) === 0
    ? Math.min(assignedPlayoutBudget, EMPTY_BOARD_PLAYOUT_CAP)
    : assignedPlayoutBudget;
  let actualPlayouts = 0;
  for (let i = 0; i < effectivePlayouts; ++i) {
    let rootTask = null;
    let taskNodeCreationsBefore = nodeCreations;
    let taskBlockedBefore = blockedExpansionCount;
    if (rootTaskStates.length) {
      rootTask = selectActiveRootTask(rootTaskStates);
      if (!rootTask) break;
      const laneOrdinal =
        rootTask.laneIndex + rootTask.laneCount * rootTask.used;
      rootTask.used++;
      seedRolloutRng(
        mixExactKey5(rootHash) ^
        Math.imul(rootTask.pos + 2, 0x9E3779B1) ^
        Math.imul(laneOrdinal + 1, 0x85EBCA6B) ^
        Math.imul(searchSequence, 0xC2B2AE35)
      );
    }
    seen.reset();
    let lastPassed = lp;
    seen.add(rootBoardHash);
    let pathLength = 1;
    path[0] = root;

    while (true) {
      let ln = path[pathLength - 1];
      widenNode(ln);
      let bestScore = -Infinity;
      let nh = ln.children[0];

      if (pathLength === 1 && rootTask) {
        nh = rootTask.selection;
      } else if (ln.isChance) {
        // Grow each source reply to a budget-aware minimum, then balance
        // visits across all source-reachable replies.
        // Ko awareness: when the path bars a WEIGHTED reply (typically the
        // forced ko recapture, superko-illegal right now), re-resolve the
        // cascade for the reduced legal set — the real opponent redirects
        // to other generators, often to moves the unrestricted union never
        // contained. Cached per (hash, legalMask), so each ko shape costs
        // one resolution.
        let barredWeight = 0;
        let barredMask = 0;
        for (let c of ln.children) {
          if (c.pos !== -1 && seen.has(c.positionKey)) {
            barredMask |= 1 << c.pos;
            barredWeight += c.weight;
          }
        }
        let reducedWeights = null;
        let reducedPass = false;
        if (barredWeight > 0) {
          if (ln.legalMask === undefined) {
            // Decoded node: reconstruct the legal reply mask lazily.
            let mask = 0;
            for (let c of ln.children) {
              if (c.pos >= 0) mask |= 1 << c.pos;
            }
            ln.legalMask = mask;
            ln.opponentCode = policyOpponentCode(opp) +
              (SEARCH_PLAYER_IS_BLACK ? 0 : 8);
          }
          const reducedMask = ln.legalMask & ~barredMask;
          if (reducedMask) {
            let reduced = getCachedPolicy(
              ln.hash,
              reducedMask,
              ln.opponentCode
            );
            if (reduced === AI_POLICY_CACHE_MISS) {
              const reducedPositions = [];
              let bitsLeft = reducedMask;
              while (bitsLeft) {
                const bit = bitsLeft & -bitsLeft;
                bitsLeft ^= bit;
                reducedPositions.push(31 - Math.clz32(bit));
              }
              reduced = resolveSourcePolicy5(
                boardFromKey5(
                  positionKeyFromState5(ln.hash),
                  ln.offlineBits
                ),
                reducedPositions,
                SEARCH_PLAYER_IS_BLACK ? 2 : 1,
                opp,
                ln.lastPassed
              );
              setCachedPolicy(ln.hash, reducedMask, ln.opponentCode, reduced);
            }
            if (reduced) {
              reducedWeights = reduced.probabilityWeights ?? null;
              reducedPass = !!reduced.passPossible;
            }
          }
        }
        if (reducedWeights && reducedPass &&
          ln.children[0]?.pos !== -1) {
          // The reduced cascade can fall through to a pass the full-set
          // union never allowed: create the missing pass edge.
          ln.children.unshift(new MCGSEdge(
            stateKey5(
              positionKeyFromState5(ln.hash),
              !ln.blackToPlay,
              true
            ),
            -1,
            0
          ));
          if (ln.weightedEdgeCount !== undefined) ln.weightedEdgeCount++;
        }
        // Common path iterates only the weighted head; the zero-weight
        // tail matters solely under a reduced (ko-barred) distribution.
        const sampleCount = reducedWeights || ln.weightedEdgeCount === undefined
          ? ln.children.length
          : ln.weightedEdgeCount;
        if (lastPassed) {
          ensureDoublePassOption(ln);
        }
        const rootChanceLane = pathLength === 2
          ? getRootTaskChanceLane(ln, rootTask)
          : null;
        nh = selectStratifiedChanceResponse(
          ln,
          sampleCount,
          seen,
          reducedWeights,
          reducedPass,
          lastPassed,
          rootChanceLane?.mask ?? null,
          rootChanceLane?.pass ?? true
        );
        if (!nh) {
          // No eligible reply (every continuation repeats a position this
          // playout already saw): terminate with the double-pass terminal
          // instead of descending into a filtered child.
          ensureDoublePassOption(ln);
          nh = ln.DP;
        }
        if (nh !== ln.DP && nh && nh.pos !== undefined) {
          const previousResponseNode = nh.nn;
          refreshEdgeTransposition(
            nh,
            map,
            seen,
            false,
            missGeneration,
            map.size >= activeNodeLimit
          );
          if (nh.nn !== previousResponseNode) ln.updateCPUct();
        }
      } else {

        if (lastPassed) {
          ensureDoublePassOption(ln);
          let score = (ln.blackToPlay ? 1 : -1) * ln.DP[5];

          // no exploration factor because we know terminal nodes have no variance
          if (score > bestScore) {
            bestScore = score;
            nh = ln.DP;
          }
        }

        const playerSign = ln.blackToPlay ? 1 : -1;
        const parentQ = ln.S / ln.N;
        const explorationScale = EXPLORATION_PARAMETER * Math.sqrt(ln.N);
        const targetIsChance =
          opp !== "No AI" &&
          ln.blackToPlay === SEARCH_PLAYER_IS_BLACK;
        for (let c of ln.children) {
          if (c.pos != -1 && seen.has(c.positionKey)) {
            continue;
          }

          if (lastPassed && c.pos == -1) continue;

          // eagerly update cached child pointer; once the map is at its limit
          // membership is frozen for the rest of the search, so one miss can
          // be remembered instead of re-probing on every visit
          const child = refreshEdgeTransposition(
            c,
            map,
            seen,
            targetIsChance,
            missGeneration,
            map.size >= activeNodeLimit
          );

          const stddev = child ? child.getcPUCT() : BOARD_SIZE * BOARD_SIZE;
          const leafSum = c.leafSum;
          const leafVisits = c.leafVisits;
          const childVisits = child ? Math.max(0, c.visits - leafVisits) : 0;
          const sampledVisits = leafVisits + childVisits;
          const q = sampledVisits
            ? (leafSum + (child ? childVisits * nodeDecisionValue(child) : 0)) / sampledVisits
            : parentQ;
          const score = playerSign * q +
            explorationScale * stddev / (1 + c.visits);

          if (score > bestScore) {
            bestScore = score;
            nh = c;
          }
        }

        if (bestScore === -Infinity) {
          // No eligible child (all seen-filtered): terminate with the
          // double-pass terminal instead of descending into a filtered child.
          ensureDoublePassOption(ln);
          nh = ln.DP;
        }

      }

      const pathIndex = pathLength - 1;
      selected[pathIndex] = nh;
      if (nh === ln.DP) {
        previousSum[pathIndex] = ln.DP[1] * ln.DP[5];
        previousSquaredSum[pathIndex] = ln.DP[1] * ln.DP[5] * ln.DP[5];
      } else {
        writeEdgeContribution(
          nh,
          previousSum,
          previousSquaredSum,
          pathIndex
        );
      }

      // Update node statistics
      ln.N++;

      if (nh == ln.DP) {
        ln.DP[1]++;
        break;
      }

      nh.visits++;
      lastPassed = (nh.pos == -1);

      seen.add(nh.positionKey);

      if (nh.nn) {
        if (lastPassed) ensureDoublePassOption(nh.nn);
        if (SUPPRESS_TRANSPOSITION) {
          if (nh.visits <= nh.nn.N) {
            break;
          }
        }

        if (pathLength >= DESCENT_DEPTH_LIMIT) {
          // Depth guard: score this edge as a rollout leaf instead of
          // walking further into the retained graph.
          const guardHash = nh.positionKey;
          const guardBlack = Math.floor(guardHash / POSITION_KEY_STRIDE_5);
          const guardWhite = guardHash - guardBlack * POSITION_KEY_STRIDE_5;
          let guardUtility = fastPlayoutBits5(
            guardBlack,
            guardWhite,
            ln.offlineBits,
            !ln.blackToPlay,
            seen,
            guardHash
          );
          const guardTargetIsChance =
            opp !== "No AI" &&
            !ln.blackToPlay !== SEARCH_PLAYER_IS_BLACK;
          if (lastPassed && !guardTargetIsChance) {
            const guardTerminal = scoreTerminalBits5(
              guardBlack,
              guardWhite,
              ln.offlineBits,
              true
            );
            guardUtility = !ln.blackToPlay
              ? Math.max(guardUtility, guardTerminal)
              : Math.min(guardUtility, guardTerminal);
          }
          nh.leafSum += guardUtility;
          nh.leafSquaredSum += guardUtility * guardUtility;
          nh.leafVisits++;
          break;
        }

        path[pathLength++] = nh.nn;
      } else {
        if (map.size >= activeNodeLimit) {
          blockedExpansionCount++;
          const boardHash = nh.positionKey;
          const nextBlack = Math.floor(boardHash / POSITION_KEY_STRIDE_5);
          const nextWhite = boardHash - nextBlack * POSITION_KEY_STRIDE_5;
          let utility = fastPlayoutBits5(
            nextBlack,
            nextWhite,
            ln.offlineBits,
            !ln.blackToPlay,
            seen,
            boardHash
          );
          const rolloutTargetIsChance =
            opp !== "No AI" &&
            !ln.blackToPlay !== SEARCH_PLAYER_IS_BLACK;
          if (lastPassed && !rolloutTargetIsChance) {
            const terminalValue = scoreTerminalBits5(
              nextBlack,
              nextWhite,
              ln.offlineBits,
              true
            );
            utility = !ln.blackToPlay
              ? Math.max(utility, terminalValue)
              : Math.min(utility, terminalValue);
          }
          // Accumulate plainly here: node values are S/N with N counting
          // every playout, so live contributions must sum over playouts
          // (bounding them here washes all node values toward zero). The
          // repeated-rollout evidence bound is applied where statistics are
          // rebuilt consistently: trim and hydration (LEAF_EVIDENCE_WINDOW).
          nh.leafSum += utility;
          nh.leafSquaredSum += utility * utility;
          nh.leafVisits++;
          nh.value = nh.leafSum / nh.leafVisits;
          break;
        }

        // Descendants must be unrestricted. Only the root node is split by worker.
        nh.nn = new MCGSNode(
          boardFromKey5(nh.positionKey, ln.offlineBits),
          !ln.blackToPlay,
          map,
          seen,
          null,
          opp,
          nh.hash,
          true,
          lastPassed
        );
        nodeCreations++;
        if (lastPassed) ensureDoublePassOption(nh.nn);
        break;
      }
    }

    // Update only the contribution changed along this simulation path.
    for (let i = pathLength; i-- > 0;) {
      const node = path[i];
      const selection = selected[i];
      path[i] = null;
      selected[i] = null;
      const oldSum = previousSum[i];
      const oldSquaredSum = previousSquaredSum[i];
      if (selection === node.DP) {
        previousSum[i] = node.DP[1] * node.DP[5];
        previousSquaredSum[i] =
          node.DP[1] * node.DP[5] * node.DP[5];
      } else {
        writeEdgeContribution(
          selection,
          previousSum,
          previousSquaredSum,
          i
        );
      }
      node.S += previousSum[i] - oldSum;
      node.SS += previousSquaredSum[i] - oldSquaredSum;
      node.updateCPUct();
    }
    actualPlayouts = i + 1;
    if (rootTask) {
      rootTask.nodeCreations += nodeCreations - taskNodeCreationsBefore;
      rootTask.blockedExpansionCount +=
        blockedExpansionCount - taskBlockedBefore;
      updateRootTaskSaturation(rootTask, activeNodeLimit, map.size);
    }
  }
  const retentionPlayoutBudget = actualPlayouts || effectivePlayouts;
  const passEdge = root.children.find((edge) => edge.pos === -1);
  if (lp && passEdge && root.DP) {
    // white passed last move; DP replaces the pass edge
    passEdge.visits = root.DP[1];
    passEdge.value = root.DP[5];
  }

  let children = root.children.toSorted((x, y) => y.visits - x.visits);

  for (let c of children) {
    const leafSum = c.leafSum;
    const leafVisits = c.leafVisits;
    const childVisits = c.nn ? Math.max(0, c.visits - leafVisits) : 0;
    const sampledVisits = leafVisits + childVisits;
    if (sampledVisits) {
      c.value =
        (leafSum + (c.nn ? childVisits * nodeDecisionValue(c.nn) : 0)) /
        sampledVisits;
    }
    c.laneSummary = summarizeRootTaskLane(
      c,
      rootTaskStateBySlot[c.pos + 1]
    );
  }

  trimSearchMapForRetention(
    map,
    null,
    null,
    0,
    retentionPlayoutBudget,
    nodeCreations,
    blockedExpansionCount
  );
  return [nodeDecisionValue(root), root.getcPUCT(), children];
}

function edgeDecisionVariance(edge) {
  const leafSum = edge.leafSum;
  const leafSquaredSum = edge.leafSquaredSum;
  const leafVisits = edge.leafVisits;
  const childVisits = edge.nn ? Math.max(0, edge.visits - leafVisits) : 0;
  const visits = leafVisits + childVisits;
  if (!visits) return 0;
  const sum = leafSum +
    (edge.nn ? childVisits * nodeDecisionValue(edge.nn) : 0);
  const squaredSum = leafSquaredSum +
    (edge.nn ? childVisits * nodeDecisionSecondMoment(edge.nn) : 0);
  const mean = sum / visits;
  return Math.max(0, squaredSum / visits - mean * mean);
}

function summarizeRootTaskLane(rootEdge, task) {
  const chanceNode = rootEdge.nn;
  if (!chanceNode?.isChance || !task || task.laneCount <= 1) return null;
  const lane = getRootTaskChanceLane(chanceNode, task);
  if (!lane) return null;

  let weightedValue = 0;
  let weightedSecondMoment = 0;
  let visits = 0;
  let riskCoveredWeight = 0;
  let riskLosingWeight = 0;
  const terminalRiskTotalWeight = chanceNode.children.reduce(
    (sum, edge) => sum + (edge.terminalRiskWeight ?? 0),
    0
  );
  let terminalRiskCoveredWeight = 0;
  let terminalFailureWeight = 0;
  const positions = [];
  const treePositions = [];
  for (const edge of chanceNode.children) {
    if (edge.weight <= 0) continue;
    if (edge.pos === -1 ? !lane.pass : !(lane.mask & (1 << edge.pos))) {
      continue;
    }
    let value = chanceNode.U;
    let secondMoment = value * value;
    let edgeVisits = 0;
    if (edge.pos === -1 && chanceNode.lastPassed && chanceNode.DP) {
      edgeVisits = chanceNode.DP[1];
      value = chanceNode.DP[5];
      secondMoment = value * value;
    } else {
      const leafVisits = edge.leafVisits;
      const childVisits = edge.nn
        ? Math.max(0, edge.visits - leafVisits)
        : 0;
      edgeVisits = leafVisits + childVisits;
      if (edgeVisits) {
        value = (
          edge.leafSum +
          (edge.nn ? childVisits * nodeDecisionValue(edge.nn) : 0)
        ) / edgeVisits;
        secondMoment = (
          edge.leafSquaredSum +
          (edge.nn
            ? childVisits * nodeDecisionSecondMoment(edge.nn)
            : 0)
        ) / edgeVisits;
      }
    }
    positions.push(edge.pos);
    if (edge.nn) treePositions.push(edge.pos);
    visits += edgeVisits;
    weightedValue += edge.weight * value;
    weightedSecondMoment += edge.weight * secondMoment;
    if (edgeVisits > 0) {
      riskCoveredWeight += edge.weight;
      const playerValue = SEARCH_PLAYER_IS_BLACK ? value : -value;
      if (playerValue < 0) riskLosingWeight += edge.weight;
      const terminalRiskWeight = edge.terminalRiskWeight ?? 0;
      terminalRiskCoveredWeight += terminalRiskWeight;
      // Source likelihood is one-sided: only an all-losing terminal-utility
      // branch is penalized. Wins and nonterminal estimates stay unweighted.
      const standardError = Math.sqrt(
        Math.max(0, secondMoment - value * value) / edgeVisits
      );
      if (playerValue + ROOT_CONFIDENCE_Z * standardError <=
        -SEARCH_WIN_UTILITY) {
        terminalFailureWeight += terminalRiskWeight;
      }
    }
  }
  if (!(lane.sourceWeight > 0)) return null;
  return {
    partitioned: true,
    laneIndex: task.laneIndex,
    laneCount: task.laneCount,
    sourceWeight: lane.sourceWeight,
    sourceTotal: lane.sourceTotal,
    visits,
    riskCoveredWeight,
    riskLosingWeight,
    terminalRiskTotalWeight,
    terminalRiskCoveredWeight,
    terminalFailureWeight,
    value: weightedValue / lane.sourceWeight,
    secondMoment: weightedSecondMoment / lane.sourceWeight,
    positions,
    treePositions,
  };
}

function summarizeRootChanceRisk(rootEdge) {
  const chanceNode = rootEdge.nn;
  if (!chanceNode?.isChance) return null;
  let sourceWeight = 0;
  let coveredWeight = 0;
  let losingWeight = 0;
  let responseVisits = 0;
  let terminalRiskTotalWeight = 0;
  let terminalRiskCoveredWeight = 0;
  let terminalFailureWeight = 0;
  for (const edge of chanceNode.children) {
    if (edge.weight <= 0) continue;
    sourceWeight += edge.weight;
    terminalRiskTotalWeight += edge.terminalRiskWeight ?? 0;
    let visits = 0;
    let value = chanceNode.U;
    if (edge.pos === -1 && chanceNode.lastPassed && chanceNode.DP) {
      visits = chanceNode.DP[1];
      value = chanceNode.DP[5];
    } else {
      const leafVisits = edge.leafVisits;
      const childVisits = edge.nn
        ? Math.max(0, edge.visits - leafVisits)
        : 0;
      visits = leafVisits + childVisits;
      if (visits) {
        value = (
          edge.leafSum +
          (edge.nn ? childVisits * nodeDecisionValue(edge.nn) : 0)
        ) / visits;
      }
    }
    if (!(visits > 0)) continue;
    coveredWeight += edge.weight;
    responseVisits += visits;
    const playerValue = SEARCH_PLAYER_IS_BLACK ? value : -value;
    if (playerValue < 0) losingWeight += edge.weight;
    const terminalRiskWeight = edge.terminalRiskWeight ?? 0;
    terminalRiskCoveredWeight += terminalRiskWeight;
    const standardError = Math.sqrt(
      Math.max(0, edgeDecisionVariance(edge)) / visits
    );
    if (playerValue + ROOT_CONFIDENCE_Z * standardError <=
      -SEARCH_WIN_UTILITY) {
      terminalFailureWeight += terminalRiskWeight;
    }
  }
  return {
    sourceWeight,
    coveredWeight,
    losingWeight,
    responseVisits,
    terminalRiskTotalWeight,
    terminalRiskCoveredWeight,
    terminalFailureWeight,
  };
}

function y19Configure(size) {
  if (Y19_SIZE === size && Y19_NEIGH) return;
  y19ClearSemeaiAnalysisCache();
  Y19_SIZE = size;
  Y19_NN = size * size;
  Y19_NEIGH = new Int16Array(Y19_NN * 4).fill(-1);
  Y19_DIAG = new Int16Array(Y19_NN * 4).fill(-1);
  Y19_SOURCE_NEIGH = new Int16Array(Y19_NN * 4).fill(-1);
  Y19_ZOBRIST = new Uint32Array(Y19_NN * 4);
  Y19_ZOBRIST_SECOND = new Uint32Array(Y19_NN * 4);
  for (let p = 0; p < Y19_NN; p++) {
    const x = (p / size) | 0, y = p % size;
    let n = p * 4, d = p * 4;
    if (y > 0) Y19_NEIGH[n++] = p - 1;
    if (y < size - 1) Y19_NEIGH[n++] = p + 1;
    if (x > 0) Y19_NEIGH[n++] = p - size;
    if (x < size - 1) Y19_NEIGH[n++] = p + size;
    let s = p * 4;
    if (y < size - 1) Y19_SOURCE_NEIGH[s++] = p + 1;
    if (x < size - 1) Y19_SOURCE_NEIGH[s++] = p + size;
    if (y > 0) Y19_SOURCE_NEIGH[s++] = p - 1;
    if (x > 0) Y19_SOURCE_NEIGH[s++] = p - size;
    for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
        Y19_DIAG[d++] = nx * size + ny;
      }
    }
    for (let state = 0; state < 4; state++) {
      let value = Math.imul(p * 4 + state + 1, 0x9e3779b1) >>> 0;
      value ^= value >>> 16;
      value = Math.imul(value, 0x85ebca6b) >>> 0;
      value ^= value >>> 13;
      value = Math.imul(value, 0xc2b2ae35) >>> 0;
      Y19_ZOBRIST[p * 4 + state] = (value ^ (value >>> 16)) >>> 0;
      value = Math.imul(value ^ 0x27d4eb2d, 0x165667b1) >>> 0;
      value ^= value >>> 15;
      value = Math.imul(value, 0xd3a2646c) >>> 0;
      Y19_ZOBRIST_SECOND[p * 4 + state] =
        (value ^ (value >>> 16)) >>> 0;
    }
  }
  Y19_STACK = new Int32Array(Y19_NN);
  Y19_GROUP = new Int32Array(Y19_NN);
  Y19_MARK = new Int32Array(Y19_NN);
  Y19_LIBMARK = new Int32Array(Y19_NN);
  Y19_MARK_GEN = 0;
}

// Advance the flood-fill mark generation. Int32 scratch, so the counter must
// wrap before 2^31 (past that, marks can never re-equal it and every fill loops
// forever); wrapping clears the scratch so stale marks can't alias.
function y19NextGen() {
  if (Y19_MARK_GEN >= 2000000000) {
    Y19_MARK.fill(0);
    Y19_LIBMARK.fill(0);
    Y19_MARK_GEN = 0;
  }
  return ++Y19_MARK_GEN;
}

function y19CellsFromBoard(board) {
  const size = board.length;
  const cells = new Uint8Array(size * size);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const ch = board[x][y];
      cells[x * size + y] =
        ch === "X" ? Y19_BLACK :
          ch === "O" ? Y19_WHITE :
            ch === "#" ? Y19_WALL :
              Y19_EMPTY;
    }
  }
  return cells;
}

function y19GroupLibs(cells, p) {
  const color = cells[p];
  const gen = y19NextGen();
  let top = 0, len = 0, libs = 0;
  Y19_STACK[top++] = p;
  Y19_MARK[p] = gen;
  Y19_LAST_LIB = -1;
  while (top > 0) {
    const q = Y19_STACK[--top];
    Y19_GROUP[len++] = q;
    const base = q * 4;
    for (let k = 0; k < 4; k++) {
      const n = Y19_NEIGH[base + k];
      if (n < 0) break;
      const v = cells[n];
      if (v === Y19_EMPTY) {
        if (Y19_LIBMARK[n] !== gen) { Y19_LIBMARK[n] = gen; libs++; Y19_LAST_LIB = n; }
      } else if (v === color && Y19_MARK[n] !== gen) {
        Y19_MARK[n] = gen;
        Y19_STACK[top++] = n;
      }
    }
  }
  Y19_GROUP_LEN = len;
  return libs;
}

// Guaranteed playTwoMoves captures: enemy groups at exactly 2 liberties with
// >= CHEAT_CAPTURE_MIN_STONES stones — filling both liberties in one cheat turn
// removes them outright. Returns [{p1,p2,stones}], largest first. Superko
// unchecked (a two-stone placement + capture won't realistically repeat).
function y19CheatCapturePairs(cells, attacker = Y19_BLACK) {
  const pairs = [];
  const enemy = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const visited = y19NextGen();
  for (let p = 0; p < Y19_NN; p++) {
    if (cells[p] !== enemy || Y19_LIBMARK[p] === visited) continue;
    const libs = y19GroupLibs(cells, p);
    const stones = Y19_GROUP_LEN;
    if (libs === 2 && stones >= CHEAT_CAPTURE_MIN_STONES) {
      const libGen = y19NextGen();
      let lib1 = -1, lib2 = -1;
      for (let i = 0; i < stones; i++) {
        const base = Y19_GROUP[i] * 4;
        for (let k = 0; k < 4; k++) {
          const n = Y19_NEIGH[base + k];
          if (n < 0) break;
          if (cells[n] === Y19_EMPTY && Y19_LIBMARK[n] !== libGen) {
            Y19_LIBMARK[n] = libGen;
            if (lib1 < 0) lib1 = n;
            else lib2 = n;
          }
        }
      }
      if (lib1 >= 0 && lib2 >= 0) pairs.push({
        p1: lib1,
        p2: lib2,
        stones,
        targetStones: Array.from(Y19_GROUP.subarray(0, stones)),
      });
    }
    for (let i = 0; i < stones; i++) Y19_LIBMARK[Y19_GROUP[i]] = visited;
  }
  pairs.sort((a, b) => b.stones - a.stones);
  return pairs;
}

function y19Key(cells) {
  let s = "";
  for (let i = 0; i < cells.length; i++) s += cells[i];
  return s;
}

function y19FastHashCells(cells) {
  let hash = 0;
  for (let point = 0; point < cells.length; point++) {
    hash ^= Y19_ZOBRIST[point * 4 + cells[point]];
  }
  return hash >>> 0;
}

function y19FastHashCellsSecond(cells) {
  let hash = 0;
  for (let point = 0; point < cells.length; point++) {
    hash ^= Y19_ZOBRIST_SECOND[point * 4 + cells[point]];
  }
  return hash >>> 0;
}

function y19FastHashKey(key) {
  let hash = 0;
  for (let point = 0; point < key.length; point++) {
    hash ^= Y19_ZOBRIST[point * 4 + key.charCodeAt(point) - 48];
  }
  return hash >>> 0;
}

function y19FastHashKeySecond(key) {
  let hash = 0;
  for (let point = 0; point < key.length; point++) {
    hash ^= Y19_ZOBRIST_SECOND[
      point * 4 + key.charCodeAt(point) - 48
    ];
  }
  return hash >>> 0;
}

// Applies color at empty p in place, removing captured enemy groups.
// Returns stones captured, or -1 when the move is suicide (board restored).
function y19PlayInPlace(cells, p, color, removed = null) {
  cells[p] = color;
  const enemy = color === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  let captured = 0;
  const base = p * 4;
  const checkedGen = y19NextGen();
  for (let k = 0; k < 4; k++) {
    const n = Y19_NEIGH[base + k];
    if (n < 0) break;
    if (cells[n] !== enemy || Y19_LIBMARK[n] === checkedGen) continue;
    if (y19GroupLibs(cells, n) === 0) {
      for (let i = 0; i < Y19_GROUP_LEN; i++) {
        if (removed) removed.push(Y19_GROUP[i]);
        cells[Y19_GROUP[i]] = Y19_EMPTY;
      }
      captured += Y19_GROUP_LEN;
    } else {
      for (let i = 0; i < Y19_GROUP_LEN; i++) {
        Y19_LIBMARK[Y19_GROUP[i]] = checkedGen;
      }
    }
  }
  if (captured === 0 && y19GroupLibs(cells, p) === 0) {
    cells[p] = Y19_EMPTY;
    return -1;
  }
  return captured;
}

function y19TryPlay(cells, p, color) {
  if (cells[p] !== Y19_EMPTY) return null;
  const next = cells.slice();
  const captured = y19PlayInPlace(next, p, color);
  return captured < 0 ? null : { cells: next, captured };
}

// Generic source-faithful board analysis for the 19x19 opponent policy.
// This is separate from the stable 25-bit resolver used by 5x5 searches.
function y19SourceAnalysis(cells) {
  const board = new Int8Array(Y19_NN);
  for (let p = 0; p < Y19_NN; p++) {
    board[p] = cells[p] === Y19_WALL ? -1 : cells[p];
  }
  const groupAt = new Int16Array(Y19_NN);
  groupAt.fill(-1);
  const groups = [];
  for (let start = 0; start < Y19_NN; start++) {
    if (board[start] === -1 || groupAt[start] >= 0) continue;
    const color = board[start];
    const id = groups.length;
    const points = [start], stack = [start];
    groupAt[start] = id;
    while (stack.length) {
      const point = stack.pop(), base = point * 4;
      for (let k = 0; k < 4; k++) {
        const next = Y19_SOURCE_NEIGH[base + k];
        if (next < 0) break;
        if (board[next] !== color || groupAt[next] >= 0) continue;
        groupAt[next] = id;
        points.push(next);
        stack.push(next);
      }
    }
    groups.push({ id, color, points, liberties: null });
  }
  const seen = new Uint16Array(Y19_NN);
  let seenGeneration = 0;
  for (const group of groups) {
    seenGeneration++;
    const liberties = [];
    for (const point of group.points) {
      const base = point * 4;
      for (let k = 0; k < 4; k++) {
        const next = Y19_SOURCE_NEIGH[base + k];
        if (next < 0) break;
        if (seen[next] === seenGeneration) continue;
        seen[next] = seenGeneration;
        if (board[next] === 0) liberties.push(next);
      }
    }
    group.liberties = liberties;
  }
  return { board, groups, groupAt };
}

function y19ClearSemeaiAnalysisCache() {
  Y19_SEMEAI_ANALYSIS_CACHE.clear();
  Y19_SEMEAI_ANALYSIS_QUEUE.length = 0;
  Y19_SEMEAI_ANALYSIS_HEAD = 0;
  Y19_SEMEAI_ANALYSIS_SIZE = 0;
  Y19_SEMEAI_ANALYSIS_STAMP = 0;
}

function y19SemeaiAnalysisMatches(analysis, cells) {
  for (let point = 0; point < cells.length; point++) {
    const value = cells[point] === Y19_WALL ? -1 : cells[point];
    if (analysis.board[point] !== value) return false;
  }
  return true;
}

function y19RemoveSemeaiAnalysisEntry(entry) {
  const seconds = Y19_SEMEAI_ANALYSIS_CACHE.get(entry.hash);
  const entries = seconds?.get(entry.hash2);
  if (!entries) return;
  const index = entries.indexOf(entry);
  if (index < 0) return;
  entries.splice(index, 1);
  if (!entries.length) seconds.delete(entry.hash2);
  if (!seconds.size) Y19_SEMEAI_ANALYSIS_CACHE.delete(entry.hash);
  Y19_SEMEAI_ANALYSIS_SIZE--;
}

function y19EnforceSemeaiAnalysisCache(limit) {
  limit = Math.max(0, Math.floor(limit));
  while (Y19_SEMEAI_ANALYSIS_SIZE > limit) {
    const queued = Y19_SEMEAI_ANALYSIS_QUEUE[Y19_SEMEAI_ANALYSIS_HEAD++];
    if (!queued || queued.entry.stamp !== queued.stamp) continue;
    y19RemoveSemeaiAnalysisEntry(queued.entry);
  }
  if (Y19_SEMEAI_ANALYSIS_HEAD > 4096 &&
    Y19_SEMEAI_ANALYSIS_HEAD * 2 > Y19_SEMEAI_ANALYSIS_QUEUE.length) {
    Y19_SEMEAI_ANALYSIS_QUEUE = Y19_SEMEAI_ANALYSIS_QUEUE.slice(
      Y19_SEMEAI_ANALYSIS_HEAD
    );
    Y19_SEMEAI_ANALYSIS_HEAD = 0;
  }
}

function y19CachedSourceAnalysis(cells, budget, hash, hash2) {
  const limit = Math.max(0, Math.floor(budget.limit));
  y19EnforceSemeaiAnalysisCache(limit);
  const entries = Y19_SEMEAI_ANALYSIS_CACHE.get(hash)?.get(hash2);
  if (entries) {
    for (const entry of entries) {
      if (!y19SemeaiAnalysisMatches(entry.analysis, cells)) continue;
      entry.stamp = ++Y19_SEMEAI_ANALYSIS_STAMP;
      Y19_SEMEAI_ANALYSIS_QUEUE.push({ entry, stamp: entry.stamp });
      budget.analysisCacheHits++;
      return entry.analysis;
    }
  }
  budget.analysisCacheMisses++;
  const analysis = y19SourceAnalysis(cells);
  if (!limit) return analysis;
  while (Y19_SEMEAI_ANALYSIS_SIZE >= limit) {
    const queued = Y19_SEMEAI_ANALYSIS_QUEUE[Y19_SEMEAI_ANALYSIS_HEAD++];
    if (!queued || queued.entry.stamp !== queued.stamp) continue;
    y19RemoveSemeaiAnalysisEntry(queued.entry);
  }
  let seconds = Y19_SEMEAI_ANALYSIS_CACHE.get(hash);
  if (!seconds) {
    seconds = new Map();
    Y19_SEMEAI_ANALYSIS_CACHE.set(hash, seconds);
  }
  let bucket = seconds.get(hash2);
  if (!bucket) {
    bucket = [];
    seconds.set(hash2, bucket);
  }
  const entry = {
    hash,
    hash2,
    analysis,
    stamp: ++Y19_SEMEAI_ANALYSIS_STAMP,
  };
  bucket.push(entry);
  Y19_SEMEAI_ANALYSIS_QUEUE.push({ entry, stamp: entry.stamp });
  Y19_SEMEAI_ANALYSIS_SIZE++;
  return analysis;
}

function y19SourceOutsideNeighbors(analysis, group) {
  const inGroup = new Uint8Array(Y19_NN);
  const seen = new Uint8Array(Y19_NN);
  const result = [];
  for (const point of group.points) inGroup[point] = 1;
  for (const point of group.points) {
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_SOURCE_NEIGH[base + k];
      if (next < 0) break;
      if (inGroup[next] || seen[next]) continue;
      seen[next] = 1;
      result.push(next);
    }
  }
  return result;
}

function y19SourceNeighborGroups(analysis, group) {
  const seen = new Uint8Array(analysis.groups.length);
  const result = [];
  for (const point of y19SourceOutsideNeighbors(analysis, group)) {
    if (analysis.board[point] <= 0) continue;
    const id = analysis.groupAt[point];
    if (id < 0 || seen[id]) continue;
    seen[id] = 1;
    result.push(analysis.groups[id]);
  }
  return result;
}

function y19SourceSpread(points) {
  let north = -1, east = -1, south = Y19_SIZE, west = Y19_SIZE;
  for (const point of points) {
    const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
    north = Math.max(north, y);
    east = Math.max(east, x);
    south = Math.min(south, y);
    west = Math.min(west, x);
  }
  return { north, east, south, west };
}

function y19SourceGroupEncirclesEye(
  analysis,
  eyeGroup,
  neighbors,
  neighborIndex
) {
  const candidate = y19SourceSpread(eyeGroup.points);
  const neighbor = neighbors[neighborIndex];
  const spread = y19SourceSpread(neighbor.points);
  const edge = Y19_SIZE - 1;
  const wraps =
    (spread.north > candidate.north ||
      (candidate.north === edge && spread.north === edge)) &&
    (spread.east > candidate.east ||
      (candidate.east === edge && spread.east === edge)) &&
    (spread.south < candidate.south ||
      (candidate.south === 0 && spread.south === 0)) &&
    (spread.west < candidate.west ||
      (candidate.west === 0 && spread.west === 0));
  if (!wraps) return false;

  const cells = new Uint8Array(Y19_NN);
  for (let p = 0; p < Y19_NN; p++) {
    cells[p] = analysis.board[p] < 0 ? Y19_WALL : analysis.board[p];
  }
  for (let i = 0; i < neighbors.length; i++) {
    if (i === neighborIndex) continue;
    for (const point of neighbors[i].points) cells[point] = Y19_EMPTY;
  }
  const evaluation = y19SourceAnalysis(cells);
  const merged = evaluation.groups[
    evaluation.groupAt[eyeGroup.points[0]]
  ];
  if (!merged) return false;

  const neighborIds = new Set();
  const inMerged = new Uint8Array(Y19_NN);
  for (const point of merged.points) inMerged[point] = 1;
  for (const point of merged.points) {
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_SOURCE_NEIGH[base + k];
      if (next < 0) break;
      if (inMerged[next]) continue;
      if (analysis.board[next] > 0) {
        neighborIds.add(analysis.groupAt[next]);
      }
    }
  }
  return neighborIds.size === 1 && neighborIds.has(neighbor.id);
}

function y19SourcePotentialEyes(analysis, player, maxSize = null) {
  let liveNodes = 0;
  for (const value of analysis.board) if (value !== -1) liveNodes++;
  const maximum = maxSize ?? Math.min(liveNodes * 0.4, 11);
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const result = [];
  for (const group of analysis.groups) {
    if (group.color !== Y19_EMPTY ||
      group.points.length > maximum) continue;
    const neighbors = y19SourceNeighborGroups(analysis, group);
    if (neighbors.some(value => value.color === player) &&
      !neighbors.some(value => value.color === enemy)) {
      result.push({ group, neighbors });
    }
  }
  return result;
}

function y19SourceEyesByGroup(analysis, player) {
  const cacheName = player === Y19_BLACK ? "blackEyes" : "whiteEyes";
  if (analysis[cacheName]) return analysis[cacheName];
  const eyes = new Map();
  for (const candidate of y19SourcePotentialEyes(analysis, player)) {
    if (!candidate.neighbors.length) continue;
    if (candidate.neighbors.length === 1) {
      const id = candidate.neighbors[0].id;
      if (!eyes.has(id)) eyes.set(id, []);
      eyes.get(id).push(candidate.group.points);
      continue;
    }
    for (let i = 0; i < candidate.neighbors.length; i++) {
      if (!y19SourceGroupEncirclesEye(
        analysis,
        candidate.group,
        candidate.neighbors,
        i
      )) continue;
      const id = candidate.neighbors[i].id;
      if (!eyes.has(id)) eyes.set(id, []);
      eyes.get(id).push(candidate.group.points);
    }
  }
  analysis[cacheName] = eyes;
  return eyes;
}

function y19SourceAvailableMoves(cells, legal, player, analysis = null) {
  analysis ??= y19SourceAnalysis(cells);
  let available = legal.slice();

  const claimed = new Uint8Array(Y19_NN);
  for (const eyeSpaces of y19SourceEyesByGroup(analysis, player).values()) {
    if (eyeSpaces.length < 2) continue;
    for (const eye of eyeSpaces) {
      for (const point of eye) claimed[point] = 1;
    }
  }
  available = available.filter(point => !claimed[point]);

  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const insideEnemy = new Uint8Array(Y19_NN);
  const playableInside = new Uint8Array(Y19_NN);
  for (const space of y19SourcePotentialEyes(analysis, enemy)) {
    for (const point of space.group.points) insideEnemy[point] = 1;
    for (const chain of space.neighbors) {
      if (chain.liberties.length > 4) continue;
      if (!y19SourceNeighborGroups(analysis, chain)
        .some(group => group.color === player)) continue;
      const inside = chain.liberties.filter(point =>
        analysis.groupAt[point] === space.group.id
      );
      if (inside.length !== chain.liberties.length) continue;
      for (const point of inside) playableInside[point] = 1;
    }
  }
  available = available.filter(point =>
    !insideEnemy[point] || playableInside[point]
  );
  return { analysis, available };
}

function y19SourceEffectiveLiberties(analysis, move, player) {
  const all = [], base = move * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_SOURCE_NEIGH[base + k];
    if (next < 0) break;
    if (analysis.board[next] === 0) all.push(next);
  }
  for (let k = 0; k < 4; k++) {
    const next = Y19_SOURCE_NEIGH[base + k];
    if (next < 0) break;
    if (analysis.board[next] !== player) continue;
    const group = analysis.groups[analysis.groupAt[next]];
    if (group) all.push(...group.liberties);
  }
  const seen = new Uint8Array(Y19_NN);
  return all.filter(point => {
    if (point === move || seen[point]) return false;
    seen[point] = 1;
    return true;
  });
}

function y19SourceWeakestAdjacent(analysis, move, color) {
  const groups = [], seen = new Uint8Array(analysis.groups.length);
  const base = move * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_SOURCE_NEIGH[base + k];
    if (next < 0) break;
    if (analysis.board[next] !== color) continue;
    const id = analysis.groupAt[next];
    if (id < 0 || seen[id]) continue;
    seen[id] = 1;
    groups.push(analysis.groups[id]);
  }
  if (!groups.length) return null;
  let minimum = groups[0].liberties.length;
  for (const group of groups) minimum = Math.min(
    minimum,
    group.liberties.length
  );
  return groups.find(group => group.liberties.length === minimum) ?? null;
}


function y19SourceGrowthMoves(analysis, player, available) {
  const allowed = new Uint8Array(Y19_NN);
  for (const point of available) allowed[point] = 1;
  const result = [];
  for (const group of analysis.groups) {
    if (group.color !== player) continue;
    for (const move of group.liberties) {
      if (!allowed[move]) continue;
      const weakest = y19SourceWeakestAdjacent(analysis, move, player);
      const oldLibertyCount = weakest?.liberties.length ?? 99;
      const newLibertyCount =
        y19SourceEffectiveLiberties(analysis, move, player).length;
      if (newLibertyCount > 1 && newLibertyCount >= oldLibertyCount) {
        result.push({ pos: move, oldLibertyCount, newLibertyCount });
      }
    }
  }
  return result;
}

function y19SourceSurroundMove(analysis, player, available) {
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const allowed = new Uint8Array(Y19_NN);
  for (const point of available) allowed[point] = 1;
  const liberties = [];
  for (const group of analysis.groups) {
    if (group.color !== enemy) continue;
    for (const liberty of group.liberties) {
      if (allowed[liberty]) liberties.push(liberty);
    }
  }
  const capture = [], atari = [], surround = [];
  for (const move of liberties) {
    const newLibertyCount =
      y19SourceEffectiveLiberties(analysis, move, player).length;
    const weakest = y19SourceWeakestAdjacent(analysis, move, enemy);
    const weakestLength = weakest?.points.length ?? 99;
    const oldLibertyCount = weakest?.liberties.length ?? 99;
    const regions = new Set(
      (weakest?.liberties ?? []).map(point => analysis.groupAt[point])
    );
    if (newLibertyCount <= 2 && oldLibertyCount > 2) continue;
    const candidate = {
      pos: move,
      oldLibertyCount,
      newLibertyCount: oldLibertyCount - 1,
    };
    if (oldLibertyCount <= 1) capture.push(candidate);
    else if (oldLibertyCount === 2 &&
      (newLibertyCount >= 2 ||
        (regions.size === 1 && weakestLength > 3))) {
      atari.push(candidate);
    } else if (newLibertyCount >= 2) {
      surround.push(candidate);
    }
  }
  return capture[0] ?? atari[0] ?? surround[0] ?? null;
}

function y19SourceDisputedMoves(analysis, available, maxSize = 99) {
  const result = [];
  for (const point of available) {
    const empty = analysis.groups[analysis.groupAt[point]];
    if (!empty || empty.points.length > maxSize) continue;
    const neighbors = y19SourceNeighborGroups(analysis, empty)
      .filter(group => group.points.length <= maxSize);
    if (neighbors.some(group => group.color === Y19_BLACK) &&
      neighbors.some(group => group.color === Y19_WHITE)) {
      result.push(point);
    }
  }
  return result;
}

function y19SourceExpansionMoves(analysis, available) {
  const open = available.filter(point => {
    let count = 0;
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_SOURCE_NEIGH[base + k];
      if (next < 0) break;
      count++;
      if (analysis.board[next] !== Y19_EMPTY) return false;
    }
    return count === 4;
  });
  return open.length
    ? open
    : y19SourceDisputedMoves(analysis, available, 1);
}

function y19SourceCornerMove(board) {
  const edge = Y19_SIZE - 1, corner = edge - 2;
  const checks = [
    [corner, corner, corner, corner, edge, edge],
    [2, corner, 0, corner, 2, edge],
    [2, 2, 0, 0, 2, 2],
    [corner, 2, corner, 0, edge, 2],
  ];
  for (const [x, y, x1, y1, x2, y2] of checks) {
    let live = 0, occupied = 0;
    for (let xx = x1; xx <= x2; xx++) {
      for (let yy = y1; yy <= y2; yy++) {
        const value = board[xx * Y19_SIZE + yy];
        if (value === -1) continue;
        live++;
        if (value !== Y19_EMPTY) occupied++;
      }
    }
    const point = x * Y19_SIZE + y;
    if (live >= 7 && occupied === 0 && board[point] !== -1) return point;
  }
  return -1;
}

function y19SourceEvaluateMove(analysis, move, player) {
  const cells = new Uint8Array(Y19_NN);
  for (let p = 0; p < Y19_NN; p++) {
    cells[p] = analysis.board[p] < 0
      ? Y19_WALL
      : analysis.board[p];
  }
  const played = y19TryPlay(cells, move, player);
  return played ? y19SourceAnalysis(played.cells) : analysis;
}

function y19SourceEyeCreationMoves(
  analysis,
  player,
  available,
  maxLiberties = 99
) {
  const eyesByGroup = y19SourceEyesByGroup(analysis, player);
  const living = new Set(
    [...eyesByGroup.entries()]
      .filter(([, eyes]) => eyes.length >= 2)
      .map(([id]) => id)
  );
  const currentLiving = living.size;
  const currentEyes = [...eyesByGroup.values()]
    .filter(eyes => eyes.length).length;
  const allowed = new Uint8Array(Y19_NN);
  for (const point of available) allowed[point] = 1;
  const liberties = [];
  for (const group of analysis.groups) {
    if (group.color !== player ||
      group.points.length <= 1 ||
      group.liberties.length > maxLiberties ||
      living.has(group.id)) continue;
    for (const point of group.liberties) {
      if (!allowed[point]) continue;
      let count = 0, enclosed = 0, hasEmpty = false;
      const base = point * 4;
      for (let k = 0; k < 4; k++) {
        const next = Y19_SOURCE_NEIGH[base + k];
        if (next < 0) break;
        count++;
        const value = analysis.board[next];
        if (value === -1 || value === player) enclosed++;
        if (value === Y19_EMPTY) hasEmpty = true;
      }
      enclosed += 4 - count;
      if (enclosed >= 2 && hasEmpty) liberties.push(point);
    }
  }
  const result = [];
  for (const point of liberties) {
    const next = y19SourceEvaluateMove(analysis, point, player);
    const nextEyes = [...y19SourceEyesByGroup(next, player).values()];
    const nextLiving = nextEyes.filter(eyes => eyes.length >= 2).length;
    const nextEyeCount = nextEyes.filter(eyes => eyes.length).length;
    if (nextLiving > currentLiving ||
      (nextEyeCount > currentEyes && nextLiving === currentLiving)) {
      result.push({
        pos: point,
        createsLife: nextLiving > currentLiving,
      });
    }
  }
  return result.sort((a, b) => +b.createsLife - +a.createsLife);
}

function y19SourcePatternMoves(analysis, player, available) {
  const result = [];
  for (const point of available) {
    const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
    if (!isPatternMoveLinear(analysis.board, x, y, player)) continue;
    if (y19SourceEffectiveLiberties(analysis, point, player).length > 1) {
      result.push(point);
    }
  }
  return result;
}

function y19SourcePolicyOptions(
  cells,
  legal,
  player,
  lastPassed,
  sourceAnalysis = null
) {
  const { analysis, available } =
    y19SourceAvailableMoves(cells, legal, player, sourceAnalysis);
  const contested = y19SourceDisputedMoves(analysis, available);
  const endGameAvailable = !contested.length && lastPassed;
  const growthMoves = y19SourceGrowthMoves(analysis, player, available);
  const growthCandidates = sourceMaximumGrowthMoves5(growthMoves);
  const defendCandidates = sourceMaximumGrowthMoves5(growthMoves, true);
  const surround = y19SourceSurroundMove(analysis, player, available);
  const expansion = y19SourceExpansionMoves(analysis, available);
  const patterns = endGameAvailable
    ? []
    : y19SourcePatternMoves(analysis, player, available);
  const eyeMoves = endGameAvailable
    ? []
    : y19SourceEyeCreationMoves(analysis, player, available);
  let eyeBlock = -1;
  if (!endGameAvailable) {
    const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
    const enemyEyes = y19SourceEyeCreationMoves(
      analysis,
      enemy,
      available,
      5
    );
    const life = enemyEyes.filter(move => move.createsLife);
    const eye = enemyEyes.filter(move => !move.createsLife);
    if (life.length === 1) eyeBlock = life[0].pos;
    else if (!life.length && eye.length === 1) eyeBlock = eye[0].pos;
  }
  const jump = expansion.filter(point => {
    const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
    return [[x, y + 2], [x + 2, y], [x, y - 2], [x - 2, y]]
      .some(([xx, yy]) =>
        xx >= 0 && yy >= 0 &&
        xx < Y19_SIZE && yy < Y19_SIZE &&
        analysis.board[xx * Y19_SIZE + yy] === player
      );
  });
  return {
    available,
    contested,
    endGameAvailable,
    growthCandidates: endGameAvailable ? [] : growthCandidates,
    defendCandidates,
    surround,
    expansion,
    patterns,
    eyeMove: eyeMoves[0]?.pos ?? -1,
    eyeBlock,
    jump,
    corner: y19SourceCornerMove(analysis.board),
  };
}

function y19ResolveUnknownOpponentPolicy(
  cells,
  legal,
  player,
  lastPassed,
  analysis = null
) {
  analysis ??= y19SourceAnalysis(cells);
  const availableResult = y19SourceAvailableMoves(
    cells,
    legal,
    player,
    analysis
  );
  const available = availableResult.available;
  const contested = y19SourceDisputedMoves(analysis, available);
  const endGameAvailable = !contested.length && lastPassed;
  const growthMoves = y19SourceGrowthMoves(analysis, player, available);
  const growthCandidates = endGameAvailable
    ? []
    : sourceMaximumGrowthMoves5(growthMoves);
  const defendCandidates = sourceMaximumGrowthMoves5(growthMoves, true);
  const surround = y19SourceSurroundMove(analysis, player, available);
  const cascadePolicy = (positions) => {
    const values = [];
    for (const point of Array.isArray(positions) ? positions : [positions]) {
      if (point >= 0 && !values.includes(point)) values.push(point);
    }
    if (!values.length) return null;
    const forced = values.length === 1;
    return {
      cascadePositions: values,
      reachable: null,
      cascadeReachable: null,
      reachableCount: values.length,
      passPossible: false,
      forced,
      forcedPosition: forced ? values[0] : -1,
    };
  };

  // The mystery 19x19 opponent uses the Illuminati cascade. These priorities
  // are unconditional across every RNG branch, so lower policies cannot alter
  // the response once one is present.
  if (surround?.newLibertyCount === 0) {
    return cascadePolicy(surround.pos);
  }
  if (defendCandidates.length &&
    defendCandidates[0].oldLibertyCount === 1 &&
    defendCandidates[0].newLibertyCount > 1) {
    return cascadePolicy(defendCandidates.map(move => move.pos));
  }
  const eyeMoves = endGameAvailable
    ? []
    : y19SourceEyeCreationMoves(analysis, player, available);
  if (eyeMoves.length) return cascadePolicy(eyeMoves[0].pos);
  if (surround?.newLibertyCount <= 1) {
    return cascadePolicy(surround.pos);
  }
  let eyeBlock = -1;
  if (!endGameAvailable) {
    const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
    const enemyEyes = y19SourceEyeCreationMoves(
      analysis,
      enemy,
      available,
      5
    );
    const life = enemyEyes.filter(move => move.createsLife);
    const eye = enemyEyes.filter(move => !move.createsLife);
    if (life.length === 1) eyeBlock = life[0].pos;
    else if (!life.length && eye.length === 1) eyeBlock = eye[0].pos;
  }
  if (eyeBlock >= 0) return cascadePolicy(eyeBlock);
  const corner = y19SourceCornerMove(analysis.board);
  if (corner >= 0) return cascadePolicy(corner);

  const expansion = y19SourceExpansionMoves(analysis, available);
  const patterns = endGameAvailable
    ? []
    : y19SourcePatternMoves(analysis, player, available);
  const jump = expansion.filter(point => {
    const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
    return [[x, y + 2], [x + 2, y], [x, y - 2], [x - 2, y]]
      .some(([xx, yy]) =>
        xx >= 0 && yy >= 0 &&
        xx < Y19_SIZE && yy < Y19_SIZE &&
        analysis.board[xx * Y19_SIZE + yy] === player
      );
  });
  const options = {
    available,
    contested,
    endGameAvailable,
    growthCandidates,
    defendCandidates,
    surround,
    expansion,
    patterns,
    eyeMove: -1,
    eyeBlock: -1,
    jump,
    corner: -1,
  };
  const reachable = new Uint8Array(Y19_NN);
  const cascadeReachable = new Uint8Array(Y19_NN);
  let reachableCount = 0, passPossible = false;
  let allBranchesCascade = true;
  const optionCuts = sourceRngCutsForOptions5(options);
  const factionCuts = sourceFactionRngCuts5("????????????");
  const record = (result) => {
    if (!result?.cascade) allBranchesCascade = false;
    if (!result) {
      passPossible = true;
      return;
    }
    for (const point of result.positions) {
      if (result.cascade) cascadeReachable[point] = 1;
      if (!reachable[point]) {
        reachable[point] = 1;
        reachableCount++;
      }
    }
  };
  for (let oi = 0; oi < optionCuts.length - 1; oi++) {
    const optionRng = (optionCuts[oi] + optionCuts[oi + 1]) / 2;
    const choices = sourceChoicesAtRng5(options, optionRng);
    for (let fi = 0; fi < factionCuts.length - 1; fi++) {
      const factionRng = (factionCuts[fi] + factionCuts[fi + 1]) / 2;
      const priority = sourceFactionPriority5(
        "????????????",
        choices,
        factionRng
      );
      if (priority) {
        record(priority);
        continue;
      }
      const fallback = sourceFallbackResults5(choices);
      if (!fallback.length) record(null);
      else for (const result of fallback) record(result);
    }
  }
  const forced =
    allBranchesCascade && !passPossible && reachableCount === 1;
  return {
    reachable,
    cascadeReachable,
    reachableCount,
    passPossible,
    forced,
    forcedPosition: forced ? reachable.indexOf(1) : -1,
  };
}

function y19SourceReachableChildren(cells, history, player) {
  const legal = y19LegalChildren(cells, player, history);
  const policy = y19ResolveUnknownOpponentPolicy(
    cells,
    legal.map(child => child.point),
    player,
    false
  );
  const points = policy.forced
    ? [policy.forcedPosition]
    : policy.reachable
      ? legal
        .filter(child => policy.reachable[child.point])
        .map(child => child.point)
      : policy.cascadePositions ?? [];
  const byPoint = new Map(legal.map(child => [child.point, child]));
  return {
    children: points.map(point => byPoint.get(point)).filter(Boolean),
    passPossible: policy.passPossible,
  };
}


function y19CollectCurrentGroup(cells, originalStones, color) {
  const anchor = originalStones.find(point => cells[point] === color);
  if (anchor === undefined) return null;
  y19GroupLibs(cells, anchor);
  const stones = Array.from(Y19_GROUP.subarray(0, Y19_GROUP_LEN));
  const liberties = [];
  const generation = y19NextGen();
  for (const stone of stones) {
    const base = stone * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[base + k];
      if (next < 0) break;
      if (cells[next] !== Y19_EMPTY ||
        Y19_LIBMARK[next] === generation) continue;
      Y19_LIBMARK[next] = generation;
      liberties.push(next);
    }
  }
  return { stones, liberties };
}

function y19TargetPerimeterMask(stones) {
  const mask = new Uint8Array(Y19_NN);
  for (const point of stones) {
    const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 ||
          xx >= Y19_SIZE || yy >= Y19_SIZE) continue;
        mask[xx * Y19_SIZE + yy] = 1;
      }
    }
  }
  return mask;
}

function y19LegalChildren(
  cells,
  color,
  history,
  mask = null,
  baseHash = null,
  baseHash2 = null,
  fastHistory = null
) {
  const result = [];
  const scratch = cells.slice();
  const removed = [];
  const enemy = color === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  baseHash ??= y19FastHashCells(cells);
  baseHash2 ??= y19FastHashCellsSecond(cells);
  for (let point = 0; point < Y19_NN; point++) {
    if ((mask && !mask[point]) ||
      cells[point] !== Y19_EMPTY) continue;
    scratch.set(cells);
    removed.length = 0;
    const captured = y19PlayInPlace(scratch, point, color, removed);
    if (captured < 0) continue;
    let hash = baseHash ^
      Y19_ZOBRIST[point * 4 + Y19_EMPTY] ^
      Y19_ZOBRIST[point * 4 + color];
    let hash2 = baseHash2 ^
      Y19_ZOBRIST_SECOND[point * 4 + Y19_EMPTY] ^
      Y19_ZOBRIST_SECOND[point * 4 + color];
    for (const capturedPoint of removed) {
      hash ^=
        Y19_ZOBRIST[capturedPoint * 4 + enemy] ^
        Y19_ZOBRIST[capturedPoint * 4 + Y19_EMPTY];
      hash2 ^=
        Y19_ZOBRIST_SECOND[capturedPoint * 4 + enemy] ^
        Y19_ZOBRIST_SECOND[capturedPoint * 4 + Y19_EMPTY];
    }
    hash >>>= 0;
    hash2 >>>= 0;
    let key = null;
    if (!fastHistory ||
      y19HistoryHashPairHas(fastHistory, hash, hash2)) {
      key = y19Key(scratch);
      if (history.has(key)) continue;
    }
    result.push({
      point,
      cells: scratch.slice(),
      key,
      hash,
      hash2,
      captured,
    });
  }
  return result;
}

function y19FastHistoryCounts(history) {
  const counts = new Map();
  for (const key of history) {
    const first = y19FastHashKey(key);
    const second = y19FastHashKeySecond(key);
    let seconds = counts.get(first);
    if (!seconds) {
      seconds = new Map();
      counts.set(first, seconds);
    }
    seconds.set(second, (seconds.get(second) ?? 0) + 1);
  }
  return counts;
}

function y19HistoryHashPairHas(counts, first, second) {
  return counts.get(first)?.has(second) ?? false;
}

function y19SemeaiHistoryAdd(
  history,
  budget,
  key,
  cells,
  hash = null,
  hash2 = null
) {
  key ??= y19Key(cells);
  history.add(key);
  hash ??= y19FastHashCells(cells);
  hash2 ??= y19FastHashCellsSecond(cells);
  const counts = budget.historyHashes;
  let seconds = counts.get(hash);
  if (!seconds) {
    seconds = new Map();
    counts.set(hash, seconds);
  }
  seconds.set(hash2, (seconds.get(hash2) ?? 0) + 1);
  return key;
}

function y19SemeaiHistoryDelete(history, budget, key, hash, hash2) {
  history.delete(key);
  const counts = budget.historyHashes;
  const seconds = counts.get(hash);
  if (!seconds) return;
  const remaining = (seconds.get(hash2) ?? 1) - 1;
  if (remaining > 0) seconds.set(hash2, remaining);
  else seconds.delete(hash2);
  if (!seconds.size) counts.delete(hash);
}

function y19ForEachLegalScratch(
  cells,
  color,
  history,
  fastHistory,
  analysis,
  visit,
  capturedGroupIds = null,
  knownHash = null,
  knownHash2 = null,
  boardScratch = null
) {
  const scratch = boardScratch ?? cells.slice();
  if (boardScratch) scratch.set(cells);
  const baseHash = knownHash ?? y19FastHashCells(cells);
  const baseHash2 = knownHash2 ?? y19FastHashCellsSecond(cells);
  const enemy = color === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  capturedGroupIds ??= new Int16Array(4);
  analysis ??= y19SourceAnalysis(cells);
  for (let point = 0; point < Y19_NN; point++) {
    if (cells[point] !== Y19_EMPTY) continue;
    let hasLiberty = false, captured = 0, capturedGroupCount = 0;
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const neighbor = Y19_NEIGH[base + k];
      if (neighbor < 0) break;
      const neighborColor = analysis.board[neighbor];
      if (neighborColor === Y19_EMPTY) {
        hasLiberty = true;
      } else if (neighborColor === color) {
        if (analysis.groups[analysis.groupAt[neighbor]].liberties.length > 1) {
          hasLiberty = true;
        }
      } else if (neighborColor === enemy) {
        const group = analysis.groups[analysis.groupAt[neighbor]];
        let duplicate = false;
        for (let index = 0; index < capturedGroupCount; index++) {
          if (capturedGroupIds[index] === group.id) {
            duplicate = true;
            break;
          }
        }
        if (group.liberties.length === 1 && !duplicate) {
          capturedGroupIds[capturedGroupCount++] = group.id;
          captured += group.points.length;
        }
      }
    }
    if (!hasLiberty && !captured) continue;
    scratch[point] = color;
    for (let index = 0; index < capturedGroupCount; index++) {
      const groupId = capturedGroupIds[index];
      for (const capturedPoint of analysis.groups[groupId].points) {
        scratch[capturedPoint] = Y19_EMPTY;
      }
    }
    let hash = baseHash ^
      Y19_ZOBRIST[point * 4 + Y19_EMPTY] ^
      Y19_ZOBRIST[point * 4 + color];
    for (let index = 0; index < capturedGroupCount; index++) {
      const groupId = capturedGroupIds[index];
      for (const capturedPoint of analysis.groups[groupId].points) {
        hash ^=
          Y19_ZOBRIST[capturedPoint * 4 + enemy] ^
          Y19_ZOBRIST[capturedPoint * 4 + Y19_EMPTY];
      }
    }
    hash >>>= 0;
    let hash2 = baseHash2 ^
      Y19_ZOBRIST_SECOND[point * 4 + Y19_EMPTY] ^
      Y19_ZOBRIST_SECOND[point * 4 + color];
    for (let index = 0; index < capturedGroupCount; index++) {
      const groupId = capturedGroupIds[index];
      for (const capturedPoint of analysis.groups[groupId].points) {
        hash2 ^=
          Y19_ZOBRIST_SECOND[capturedPoint * 4 + enemy] ^
          Y19_ZOBRIST_SECOND[capturedPoint * 4 + Y19_EMPTY];
      }
    }
    hash2 >>>= 0;
    if (!y19HistoryHashPairHas(fastHistory, hash, hash2) ||
      !history.has(y19Key(scratch))) {
      visit(point, scratch, captured, hash, hash2);
    }
    scratch[point] = Y19_EMPTY;
    for (let index = 0; index < capturedGroupCount; index++) {
      const groupId = capturedGroupIds[index];
      for (const capturedPoint of analysis.groups[groupId].points) {
        scratch[capturedPoint] = enemy;
      }
    }
  }
}

function y19SemeaiScratchFrame(budget, depth) {
  let frame = budget.scratchFrames[depth];
  if (!frame) {
    frame = {
      raceMask: new Uint8Array(Y19_NN),
      criticalMask: new Uint8Array(Y19_NN),
      policyHashMask: new Uint8Array(Y19_NN),
      capturedGroupIds: new Int16Array(4),
      legalPositions: [],
      retained: new Array(Y19_NN),
      retainedPoints: [],
      responses: [],
      legalBoard: new Uint8Array(Y19_NN),
    };
    budget.scratchFrames[depth] = frame;
  }
  frame.raceMask.fill(0);
  frame.criticalMask.fill(0);
  frame.legalPositions.length = 0;
  frame.responses.length = 0;
  for (const point of frame.retainedPoints) frame.retained[point] = null;
  frame.retainedPoints.length = 0;
  return frame;
}

function y19LegalPointsScratch(
  cells,
  color,
  history,
  fastHistory,
  analysis = null
) {
  const points = [];
  y19ForEachLegalScratch(
    cells,
    color,
    history,
    fastHistory,
    analysis,
    point => points.push(point)
  );
  return points;
}

function y19TargetEyeCount(cells, target, color, analysis = null) {
  analysis ??= y19SourceAnalysis(cells);
  const id = analysis.groupAt[target.stones[0]];
  return id < 0
    ? 0
    : (y19SourceEyesByGroup(analysis, color).get(id)?.length ?? 0);
}

function y19CaptureResult(
  status,
  line = [],
  policy = [],
  proofNumber = null,
  disproofNumber = null
) {
  if (proofNumber == null) {
    proofNumber = status === Y19_CAPTURE_PROVEN
      ? 0
      : status === Y19_CAPTURE_REFUTED ? Infinity : 1;
  }
  if (disproofNumber == null) {
    disproofNumber = status === Y19_CAPTURE_REFUTED
      ? 0
      : status === Y19_CAPTURE_PROVEN ? Infinity : 1;
  }
  return { status, line, policy, proofNumber, disproofNumber };
}

function y19SemeaiDeadlineExceeded(budget) {
  if (budget.deadlineCheckCountdown > 0) {
    budget.deadlineCheckCountdown--;
    return false;
  }
  budget.deadlineCheckCountdown = Y19_SEMEAI_DEADLINE_CHECK_NODES - 1;
  budget.deadlineChecks++;
  return performance.now() >= budget.deadline;
}

function y19CombineProofNumbers(mode, results) {
  if (!results.length) return [1, 1];
  if (mode === "and") {
    return [
      results.reduce((sum, result) => sum + result.proofNumber, 0),
      results.reduce(
        (minimum, result) => Math.min(minimum, result.disproofNumber),
        Infinity
      ),
    ];
  }
  return [
    results.reduce(
      (minimum, result) => Math.min(minimum, result.proofNumber),
      Infinity
    ),
    results.reduce((sum, result) => sum + result.disproofNumber, 0),
  ];
}

function y19SemeaiLeafProofNumbers(cells, context) {
  const state = y19CurrentSemeai(cells, context);
  if (!state.own) return [Infinity, 0];
  if (!state.target) return [0, Infinity];
  return [
    Math.max(1, state.target.liberties.length),
    Math.max(1, state.own.liberties.length),
  ];
}

function y19ConservativeLibertyRaceBounds(
  cells,
  state,
  context,
  analysis,
  legalChildren = null
) {
  const targetLiberties = state.target?.liberties ?? [];
  const ownLiberties = state.own?.liberties ?? [];
  let sharedLiberties = 0;
  for (const liberty of targetLiberties) {
    if (ownLiberties.includes(liberty)) sharedLiberties++;
  }
  const targetEyes = state.target
    ? y19TargetEyeCount(cells, state.target, context.defender, analysis)
    : 0;
  // Own eyes are only an ordering input. Do not build a second eye map just
  // for the bound; use it when another source-policy step already populated
  // the cached analysis. Target eyes remain mandatory for safe rejection.
  const ownEyeCache = analysis[
    context.attacker === Y19_BLACK ? "blackEyes" : "whiteEyes"
  ];
  const ownGroupId = state.own
    ? analysis.groupAt[state.own.stones[0]]
    : -1;
  const ownEyes = ownEyeCache && ownGroupId >= 0
    ? (ownEyeCache.get(ownGroupId)?.length ?? 0)
    : -1;
  const bounds = {
    sharedLiberties,
    targetExclusiveLiberties: targetLiberties.length - sharedLiberties,
    ownExclusiveLiberties: ownLiberties.length - sharedLiberties,
    targetApproachCosts: 0,
    ownApproachCosts: 0,
    targetEyes,
    ownEyes,
    unavoidableCaptures: 0,
    // This is an ordering bound only. Extensions, mergers, captures, and ko
    // may change it, so it is never used alone to declare a result.
    targetPlacementLowerBound: Math.max(0, targetLiberties.length - 1),
    ownPlacementLowerBound: Math.max(0, ownLiberties.length - 1),
  };
  if (!legalChildren) return bounds;
  y19CompleteLibertyRaceBounds(bounds, targetLiberties, legalChildren);
  return bounds;
}

function y19CompleteLibertyRaceBounds(
  bounds,
  targetLiberties,
  legalChildren
) {
  let minimumCapture = Infinity, legalTargetFills = 0;
  for (const liberty of targetLiberties) {
    const child = legalChildren.find(candidate => candidate.point === liberty);
    if (!child) {
      bounds.targetApproachCosts++;
      continue;
    }
    legalTargetFills++;
    minimumCapture = Math.min(minimumCapture, child.captured);
  }
  // A positive value means every currently legal direct liberty fill obtains
  // at least this capture. It improves ordering only; it is not a proof.
  if (legalTargetFills) bounds.unavoidableCaptures = minimumCapture;
}

function y19RecordLibertyRaceBounds(budget, bounds) {
  budget.raceBoundsEvaluated++;
  budget.raceSharedLiberties += bounds.sharedLiberties;
  budget.raceTargetExclusiveLiberties += bounds.targetExclusiveLiberties;
  budget.raceOwnExclusiveLiberties += bounds.ownExclusiveLiberties;
  budget.raceApproachCosts +=
    bounds.targetApproachCosts + bounds.ownApproachCosts;
  budget.raceUnavoidableCaptures += bounds.unavoidableCaptures;
}

function y19FrontierPathKeys(history, baseHistory, extraKey = null) {
  const keys = [];
  for (const key of history) {
    if (!baseHistory.has(key)) keys.push(key);
  }
  if (extraKey && !history.has(extraKey)) keys.push(extraKey);
  return keys;
}

function y19FrontierBranch(
  cells,
  toPlay,
  movesRemaining,
  context,
  history,
  budget,
  attackerJustMoved,
  move,
  child = null,
  policy = []
) {
  if (child) child.key ??= y19Key(child.cells);
  const frontierCells = child?.cells ?? cells;
  const [proofNumber, disproofNumber] = y19SemeaiLeafProofNumbers(
    frontierCells,
    context
  );
  return {
    frontierCells: frontierCells.slice(),
    frontierHash: child?.hash ?? y19FastHashCells(cells),
    frontierHash2: child?.hash2 ?? y19FastHashCellsSecond(cells),
    frontierToPlay: toPlay,
    frontierMovesRemaining: movesRemaining,
    frontierContext: context,
    frontierPathKeys: y19FrontierPathKeys(
      history,
      budget.baseHistory,
      child?.key ?? null
    ),
    frontierAttackerJustMoved: attackerJustMoved,
    prefixLine: [move],
    prefixPolicy: policy.slice(),
    // Heuristic leaf initialization for distributed proof-number selection.
    // Exact 0/Infinity values are supplied by completed worker reads.
    proofNumber,
    disproofNumber,
    targetLiberties: Number.isFinite(proofNumber) ? proofNumber : 0,
    ownLiberties: Number.isFinite(disproofNumber) ? disproofNumber : 0,
  };
}

function y19FrontierResult(mode, branches) {
  const result = y19CaptureResult(Y19_CAPTURE_UNKNOWN);
  result.frontier = { mode, branches };
  return result;
}

function y19PrependFrontier(result, move, policy = null) {
  if (!result.frontier) return result;
  for (const branch of result.frontier.branches) {
    branch.prefixLine.unshift(move);
    if (policy) branch.prefixPolicy.push(...policy);
  }
  return result;
}

// Compact 64-bit-equivalent key for transferring a proven capture policy.
// The host still validates the selected move and superko before playing it.
function y19CapturePolicyHash(cells, target = null) {
  let first = 0x811c9dc5, second = 0x9e3779b9;
  const mask = target ? y19TargetPerimeterMask(target.stones) : null;
  for (let index = 0; index < cells.length; index++) {
    if (mask && !mask[index]) continue;
    const value = cells[index] + 1;
    first = Math.imul(first ^ value, 0x01000193);
    second = Math.imul(
      second ^ (value + Math.imul(index + 1, 0x85ebca6b)),
      0xc2b2ae35
    );
  }
  return [first >>> 0, second >>> 0];
}

function y19SemeaiPolicyMask(target, own, mask = null) {
  mask ??= new Uint8Array(Y19_NN);
  mask.fill(0);
  const add = group => {
    for (const point of group?.stones ?? []) {
      const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= Y19_SIZE || yy >= Y19_SIZE) {
            continue;
          }
          mask[xx * Y19_SIZE + yy] = 1;
        }
      }
    }
  };
  add(target);
  add(own);
  return mask;
}

function y19SemeaiPolicyHash(cells, target, own, mask = null) {
  mask = y19SemeaiPolicyMask(target, own, mask);
  let first = 0x811c9dc5, second = 0x9e3779b9;
  for (let index = 0; index < cells.length; index++) {
    if (!mask[index]) continue;
    const value = cells[index] + 1;
    first = Math.imul(first ^ value, 0x01000193);
    second = Math.imul(
      second ^ (value + Math.imul(index + 1, 0x85ebca6b)),
      0xc2b2ae35
    );
  }
  return [first >>> 0, second >>> 0];
}

function y19SemeaiPolicyContainsPoint(point, target, own) {
  const x = (point / Y19_SIZE) | 0, y = point % Y19_SIZE;
  for (const group of [target, own]) {
    for (const stone of group?.stones ?? []) {
      const sx = (stone / Y19_SIZE) | 0, sy = stone % Y19_SIZE;
      if (Math.abs(x - sx) <= 2 && Math.abs(y - sy) <= 2) return true;
    }
  }
  return false;
}

function y19AppendCapturePolicy(target, source) {
  for (let index = 0; index < source.length; index++) {
    target.push(source[index]);
  }
}

function y19CanonicalCapturePolicy(flatPolicy) {
  const moves = new Map();
  for (let index = 0; index + 2 < flatPolicy.length; index += 3) {
    const key = flatPolicy[index] + ":" + flatPolicy[index + 1];
    const move = flatPolicy[index + 2];
    const previous = moves.get(key);
    if (previous !== undefined && previous !== move) {
      return null;
    }
    moves.set(key, move);
  }
  const canonical = [];
  for (const [key, move] of moves) {
    const separator = key.indexOf(":");
    canonical.push(
      Number(key.slice(0, separator)),
      Number(key.slice(separator + 1)),
      move
    );
  }
  return canonical;
}

function y19TargetIsEffectivelyDead(cells, target, defender, history) {
  if (target.liberties.length !== 1) return false;
  const extension = y19TryPlay(cells, target.liberties[0], defender);
  if (!extension || history.has(y19Key(extension.cells))) return true;
  // Capturing an attacking stone reverses the race; it is not a dead extension.
  if (extension.captured > 0) return false;
  const extended = y19CollectCurrentGroup(
    extension.cells,
    target.stones,
    defender
  );
  return !extended || extended.liberties.length === 1;
}

function y19ControlledOwners(analysis) {
  const owners = new Int8Array(Y19_NN);
  owners.fill(-1);
  for (const group of analysis.groups) {
    if (group.color !== Y19_EMPTY) continue;
    const neighbors = y19SourceNeighborGroups(analysis, group);
    const black = neighbors.some(value => value.color === Y19_BLACK);
    const white = neighbors.some(value => value.color === Y19_WHITE);
    const owner = black && !white
      ? Y19_BLACK
      : white && !black
        ? Y19_WHITE
        : 0;
    for (const point of group.points) owners[point] = owner;
  }
  return owners;
}

function y19CascadeSurroundLibs(analysis, point, player) {
  let result = 0;
  const base = point * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_NEIGH[base + k];
    if (next < 0) break;
    const value = analysis.board[next];
    if (value === Y19_EMPTY) result++;
    else if (value === player) {
      const group = analysis.groups[analysis.groupAt[next]];
      result += (group?.liberties.length ?? 1) - 1;
    }
  }
  return result;
}

function y19CascadeEyeValue(analysis, owners, point, player) {
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const seen = new Uint8Array(Y19_NN);
  const queue = [];
  const base = point * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_NEIGH[base + k];
    if (next < 0) break;
    if (!seen[next]) {
      seen[next] = 1;
      queue.push(next);
    }
  }
  let result = 0;
  for (let index = 0; index < queue.length; index++) {
    const current = queue[index];
    if (analysis.board[current] === -1 ||
      analysis.board[current] === enemy ||
      owners[current] === 0) continue;
    if (owners[current] === player) result++;
    const nextBase = current * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[nextBase + k];
      if (next < 0) break;
      if (!seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return result;
}

function y19CascadeChainValue(
  analysis,
  owners,
  start,
  player,
  isolated = false
) {
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  if (analysis.board[start] === -1 ||
    analysis.board[start] === enemy || owners[start] === 0) return 0;
  const seen = new Uint8Array(Y19_NN);
  const queue = [];
  const base = start * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_NEIGH[base + k];
    if (next < 0) break;
    if (!seen[next]) {
      seen[next] = 1;
      queue.push(next);
    }
  }
  let count = 1;
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (analysis.board[point] === -1 ||
      analysis.board[point] === enemy ||
      owners[point] === 0 ||
      (isolated && analysis.board[point] === Y19_EMPTY)) continue;
    count++;
    const nextBase = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[nextBase + k];
      if (next < 0) break;
      if (!seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return count;
}

function y19CascadeCreatesLiberty(analysis, point, player) {
  const base = point * 4;
  for (let k = 0; k < 4; k++) {
    const next = Y19_NEIGH[base + k];
    if (next < 0) break;
    if (analysis.board[next] !== player) continue;
    const group = analysis.groups[analysis.groupAt[next]];
    if (group?.liberties.length > 2) return false;
  }
  for (let k = 0; k < 4; k++) {
    const next = Y19_NEIGH[base + k];
    if (next < 0) break;
    if (analysis.board[next] !== player) continue;
    const group = analysis.groups[analysis.groupAt[next]];
    if (group?.liberties.length === 2 &&
      y19CascadeSurroundLibs(analysis, next, player) === 1) {
      return true;
    }
  }
  return false;
}

function y19OwnCounterLibMove(cells, history, player, analysis = null) {
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  analysis ??= y19SourceAnalysis(cells);
  const endangered = analysis.groups
    .filter(group =>
      group.color === player && group.liberties.length === 1
    )
    .sort((a, b) => b.points.length - a.points.length);
  for (const group of endangered) {
    const ownLiberty = group.liberties[0];
    const extension = y19TryPlay(cells, ownLiberty, player);
    if (extension &&
      !history.has(y19Key(extension.cells)) &&
      extension.captured === 0) {
      const extended = y19CollectCurrentGroup(
        extension.cells,
        group.points,
        player
      );
      if (extended && y19RescueSurvivesLadder(
        extension.cells,
        extended.stones[0],
        player
      )) continue;
    }

    const enemyGroups = [];
    const seen = new Uint8Array(analysis.groups.length);
    for (const stone of group.points) {
      const base = stone * 4;
      for (let k = 0; k < 4; k++) {
        const next = Y19_NEIGH[base + k];
        if (next < 0) break;
        if (analysis.board[next] !== enemy) continue;
        const id = analysis.groupAt[next];
        const candidate = analysis.groups[id];
        if (seen[id] || candidate.liberties.length !== 1) continue;
        seen[id] = 1;
        enemyGroups.push(candidate);
      }
    }
    for (const candidate of enemyGroups) {
      const killPoint = candidate.liberties[0];
      const enemyExtension = y19TryPlay(cells, killPoint, enemy);
      if (enemyExtension) {
        const racesOurGroup =
          !group.points.some(point => enemyExtension.cells[point] === player);
        const escaped = y19CollectCurrentGroup(
          enemyExtension.cells,
          candidate.points,
          enemy
        );
        if (!racesOurGroup && escaped &&
          escaped.liberties.length >= 2) continue;
      }
      const kills = y19TryPlay(cells, killPoint, player);
      if (!kills || history.has(y19Key(kills.cells)) ||
        kills.captured === 0) continue;
      const saved = y19CollectCurrentGroup(
        kills.cells,
        group.points,
        player
      );
      if (saved && y19RescueSurvivesLadder(
        kills.cells,
        saved.stones[0],
        player
      )) return killPoint;
    }

    if (extension &&
      !history.has(y19Key(extension.cells)) &&
      extension.captured > 0) {
      const saved = y19CollectCurrentGroup(
        extension.cells,
        group.points,
        player
      );
      if (saved && y19RescueSurvivesLadder(
        extension.cells,
        saved.stones[0],
        player
      )) return ownLiberty;
    }
  }
  return -1;
}

function y19OwnLargeLibAttackMoves(
  cells,
  history,
  player,
  minimumKilled = 88,
  ignore = 0,
  analysis = null,
  owners = null,
  legalPoints = null
) {
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  analysis ??= y19SourceAnalysis(cells);
  owners ??= y19ControlledOwners(analysis);
  legalPoints ??= y19LegalPointsScratch(
    cells,
    player,
    history,
    y19FastHistoryCounts(history),
    analysis
  );
  const candidates = [];
  let highValue = 1;
  for (const point of legalPoints) {
    if (owners[point] === player) continue;
    let count = 0, chains = 0;
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[base + k];
      if (next < 0) break;
      if (analysis.board[next] !== enemy) continue;
      const group = analysis.groups[analysis.groupAt[next]];
      if (group.liberties.length !== 1) continue;
      count++;
      chains += y19CascadeChainValue(
        analysis,
        owners,
        next,
        enemy
      );
    }
    const enemyLiberties =
      y19CascadeSurroundLibs(analysis, point, enemy);
    if (!count ||
      chains <= ignore ||
      (chains < minimumKilled && enemyLiberties <= 1)) continue;
    const value = count * chains;
    if (value > highValue) {
      candidates.length = 0;
      candidates.push(point);
      highValue = value;
    } else if (value === highValue) {
      candidates.push(point);
    }
  }
  return candidates;
}

function y19LegalAtariLiberties(
  cells,
  history,
  player,
  groupColor,
  analysis
) {
  const points = [];
  for (const group of analysis.groups) {
    if (group.color !== groupColor || group.liberties.length !== 1) continue;
    const point = group.liberties[0];
    if (!points.includes(point)) points.push(point);
  }
  points.sort((a, b) => a - b);
  let write = 0;
  for (const point of points) {
    const played = y19TryPlay(cells, point, player);
    if (!played || history.has(y19Key(played.cells))) continue;
    points[write++] = point;
  }
  points.length = write;
  return points;
}
//Collect up to `cap` distinct liberty points of the chain at `anchor`.
function y19ChainLibertyPoints(cells, anchor, cap = 4) {
  y19GroupLibs(cells, anchor);
  const stones = [];
  for (let i = 0; i < Y19_GROUP_LEN; i++) stones.push(Y19_GROUP[i]);
  const gen = y19NextGen();
  const libs = [];
  for (const s of stones) {
    const base = s * 4;
    for (let k = 0; k < 4; k++) {
      const n = Y19_NEIGH[base + k];
      if (n < 0) break;
      if (cells[n] === Y19_EMPTY && Y19_MARK[n] !== gen) {
        Y19_MARK[n] = gen;
        libs.push(n);
        if (libs.length >= cap) return libs;
      }
    }
  }
  return libs;
}
// Ladder read (opponent to move): is the chain at `anchor` doomed in the
// liberty chase? Attacker fills a liberty; we answer by capturing an adjacent
// atari'd enemy chain (breakers) or extending. 3+ libs = escaped. Tri-state:
// true = proven kill, false = proven escape, null = budget exhausted.
function y19LadderDoomedProof(
  cells,
  anchor,
  depth,
  budget,
  defender = cells[anchor],
  history = null
) {
  if (depth <= 0 || --budget.nodes <= 0) return null;
  if (cells[anchor] !== defender) return true;
  const attacker = defender === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const libPts = y19ChainLibertyPoints(cells, anchor, 3);
  if (libPts.length >= 3) return false; //escaped
  if (libPts.length === 0) return true;  //dead already
  let attackUnknown = false;
  for (const chase of libPts) {
    const chased = y19TryPlay(cells, chase, attacker);
    if (!chased) continue; //illegal chase point
    const chasedKey = history ? y19Key(chased.cells) : null;
    if (history?.has(chasedKey)) continue;
    if (history) history.add(chasedKey);
    if (chased.cells[anchor] !== defender) {
      if (history) history.delete(chasedKey);
      return true; //that was our last liberty
    }
    let survives = false;
    let defenseUnknown = false;
    //(a) capture an adjacent enemy chain in atari — ladder breakers
    y19GroupLibs(chased.cells, anchor);
    const ourStones = [];
    for (let i = 0; i < Y19_GROUP_LEN; i++) ourStones.push(Y19_GROUP[i]);
    const seenGen = y19NextGen();
    for (const s of ourStones) {
      if (survives) break;
      const base = s * 4;
      for (let k = 0; k < 4; k++) {
        const n = Y19_NEIGH[base + k];
        if (n < 0) break;
        if (chased.cells[n] !== attacker || Y19_LIBMARK[n] === seenGen) continue;
        const enemyLibs = y19GroupLibs(chased.cells, n);
        for (let i = 0; i < Y19_GROUP_LEN; i++) Y19_LIBMARK[Y19_GROUP[i]] = seenGen;
        if (enemyLibs !== 1) continue;
        const capPoint = Y19_LAST_LIB;
        const captured = y19TryPlay(chased.cells, capPoint, defender);
        if (!captured || captured.captured === 0) continue;
        const capturedKey = history ? y19Key(captured.cells) : null;
        if (history?.has(capturedKey)) continue;
        if (history) history.add(capturedKey);
        const outcome = y19LadderDoomedProof(
          captured.cells,
          anchor,
          depth - 1,
          budget,
          defender,
          history
        );
        if (history) history.delete(capturedKey);
        if (outcome === false) {
          survives = true;
          break;
        }
        if (outcome == null) defenseUnknown = true;
      }
    }
    //(b) extend at the remaining liberty
    if (!survives) {
      const remaining = y19ChainLibertyPoints(chased.cells, anchor, 2);
      for (const ext of remaining) {
        const extended = y19TryPlay(chased.cells, ext, defender);
        if (!extended) continue;
        const extendedKey = history ? y19Key(extended.cells) : null;
        if (history?.has(extendedKey)) continue;
        if (history) history.add(extendedKey);
        const outcome = y19LadderDoomedProof(
          extended.cells,
          anchor,
          depth - 1,
          budget,
          defender,
          history
        );
        if (history) history.delete(extendedKey);
        if (outcome === false) {
          survives = true;
          break;
        }
        if (outcome == null) defenseUnknown = true;
      }
    }
    if (!survives) {
      if (!defenseUnknown) {
        if (history) history.delete(chasedKey);
        return true; //this chase line kills the chain
      }
      attackUnknown = true;
    }
    if (history) history.delete(chasedKey);
  }
  return attackUnknown ? null : false;
}

function y19DefensiveLadderDoomed(
  cells,
  anchor,
  depth,
  budget,
  defender = cells[anchor]
) {
  if (depth <= 0 || --budget.nodes <= 0) return false;
  if (cells[anchor] !== defender) return true;
  const attacker = defender === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const liberties = y19ChainLibertyPoints(cells, anchor, 3);
  if (liberties.length >= 3) return false;
  if (!liberties.length) return true;
  for (const chasePoint of liberties) {
    const chased = y19TryPlay(cells, chasePoint, attacker);
    if (!chased) continue;
    if (chased.cells[anchor] !== defender) return true;
    let survives = false;
    y19GroupLibs(chased.cells, anchor);
    const ownStones = Array.from(Y19_GROUP.subarray(0, Y19_GROUP_LEN));
    const seen = y19NextGen();
    for (const stone of ownStones) {
      if (survives) break;
      const base = stone * 4;
      for (let k = 0; k < 4; k++) {
        const next = Y19_NEIGH[base + k];
        if (next < 0) break;
        if (chased.cells[next] !== attacker ||
          Y19_LIBMARK[next] === seen) continue;
        const enemyLiberties = y19GroupLibs(chased.cells, next);
        for (let index = 0; index < Y19_GROUP_LEN; index++) {
          Y19_LIBMARK[Y19_GROUP[index]] = seen;
        }
        if (enemyLiberties !== 1) continue;
        const captured = y19TryPlay(
          chased.cells,
          Y19_LAST_LIB,
          defender
        );
        if (captured?.captured > 0 && !y19DefensiveLadderDoomed(
          captured.cells,
          anchor,
          depth - 1,
          budget,
          defender
        )) {
          survives = true;
          break;
        }
      }
    }
    if (!survives) {
      for (const extension of y19ChainLibertyPoints(
        chased.cells,
        anchor,
        2
      )) {
        const extended = y19TryPlay(chased.cells, extension, defender);
        if (extended && !y19DefensiveLadderDoomed(
          extended.cells,
          anchor,
          depth - 1,
          budget,
          defender
        )) {
          survives = true;
          break;
        }
      }
    }
    if (!survives) return true;
  }
  return false;
}

function y19RescueLadderProofStatus(
  cells,
  anchor,
  defender = cells[anchor],
  history = null
) {
  if (cells[anchor] !== defender) return false;
  const liberties = y19GroupLibs(cells, anchor);
  if (liberties <= 1) return false;
  if (liberties >= 3) return true;
  if (history) {
    const outcome = y19LadderDoomedProof(
      cells,
      anchor,
      Y19_SIZE * 2,
      { nodes: 4 * Y19_NN },
      defender,
      history
    );
    return outcome == null ? null : !outcome;
  }
  const hash = y19CapturePolicyHash(cells);
  const cacheKey = hash[0] + ":" + hash[1] + ":" + anchor + ":" +
    defender + ":proof";
  let outcome = y19RescueLadderCache.get(cacheKey);
  if (!y19RescueLadderCache.has(cacheKey)) {
    outcome = y19LadderDoomedProof(
      cells,
      anchor,
      Y19_SIZE * 2,
      { nodes: 4 * Y19_NN },
      defender
    );
    if (y19RescueLadderCache.size >= Y19_RESCUE_LADDER_CACHE_LIMIT) {
      y19RescueLadderCache.clear();
    }
    y19RescueLadderCache.set(cacheKey, outcome);
  }
  return outcome == null ? null : !outcome;
}

function y19RescueSurvivesLadder(
  cells,
  anchor,
  defender = cells[anchor],
  requireProof = false,
  history = null
) {
  // Defensive callers must not reject a rescue merely because the bounded
  // reader ran out of proof budget. Offensive ladder certification passes
  // requireProof=true and rejects that same unknown result.
  if (requireProof) {
    return y19RescueLadderProofStatus(
      cells,
      anchor,
      defender,
      history
    ) === true;
  }
  if (cells[anchor] !== defender) return false;
  const liberties = y19GroupLibs(cells, anchor);
  if (liberties <= 1) return false;
  if (liberties >= 3) return true;
  const hash = y19CapturePolicyHash(cells);
  const cacheKey = hash[0] + ":" + hash[1] + ":" + anchor + ":" +
    defender + ":defense";
  if (y19RescueLadderCache.has(cacheKey)) {
    const outcome = y19RescueLadderCache.get(cacheKey);
    return !outcome;
  }
  const outcome = y19DefensiveLadderDoomed(
    cells,
    anchor,
    Y19_SIZE * 2,
    { nodes: 4 * Y19_NN },
    defender
  );
  if (y19RescueLadderCache.size >= Y19_RESCUE_LADDER_CACHE_LIMIT) {
    y19RescueLadderCache.clear();
  }
  y19RescueLadderCache.set(cacheKey, outcome);
  return !outcome;
}

function y19OwnLibDefendMoves(
  cells,
  history,
  player,
  savedMin = 1,
  analysis = null,
  owners = null,
  legalPoints = null
) {
  analysis ??= y19SourceAnalysis(cells);
  owners ??= y19ControlledOwners(analysis);
  legalPoints ??= y19LegalPointsScratch(
    cells,
    player,
    history,
    y19FastHistoryCounts(history),
    analysis
  );
  const candidates = [];
  let highValue = 0;
  for (const point of legalPoints) {
    const surround =
      y19CascadeSurroundLibs(analysis, point, player);
    const eyes =
      y19CascadeEyeValue(analysis, owners, point, player);
    if (surround + eyes < 2 ||
      y19CascadeCreatesLiberty(analysis, point, player)) continue;
    let saved = 0;
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[base + k];
      if (next < 0) break;
      if (analysis.board[next] !== player) continue;
      const group = analysis.groups[analysis.groupAt[next]];
      if (group.liberties.length === 1) {
        saved += y19CascadeChainValue(
          analysis,
          owners,
          next,
          player
        );
      }
    }
    if (!saved || saved < savedMin) continue;
    const played = y19TryPlay(cells, point, player);
    if (!played ||
      !y19RescueSurvivesLadder(played.cells, point, player)) continue;
    const value = saved * surround;
    if (value > highValue) {
      candidates.length = 0;
      candidates.push(point);
      highValue = value;
    } else if (value === highValue) {
      candidates.push(point);
    }
  }
  return candidates;
}

function y19ResolveOwnForcedMoves(
  cells,
  history,
  player,
  forcedPrefix = Y19_OWN_FORCED_PREFIX,
  analysis = null,
  budget = null
) {
  // Mirrors the cascade steps above the semeai continuation slot. Only
  // those interrupt the capturing race when the read projects our own
  //future turns (Y19_OWN_FORCED_PREFIX; forwarded per request in-game).
  if (forcedPrefix <= 0) return null;
  analysis ??= y19SourceAnalysis(cells);
  const counter = y19OwnCounterLibMove(cells, history, player, analysis);
  if (counter >= 0) return { type: "counterLib", positions: [counter] };
  if (forcedPrefix <= 1) return null;
  const owners = y19ControlledOwners(analysis);
  const enemy = player === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const legalPoints = Y19_LOCAL_OWN_FORCED_CANDIDATES
    ? null
    : y19LegalPointsScratch(
      cells,
      player,
      history,
      budget?.historyHashes ?? y19FastHistoryCounts(history),
      analysis
    );
  const attackPoints = legalPoints ?? y19LegalAtariLiberties(
    cells,
    history,
    player,
    enemy,
    analysis
  );
  const attack = y19OwnLargeLibAttackMoves(
    cells,
    history,
    player,
    88,
    1,
    analysis,
    owners,
    attackPoints
  );
  if (attack.length) return { type: "libAttack88", positions: attack };
  if (forcedPrefix <= 2) return null;
  const defendPoints = legalPoints ?? y19LegalAtariLiberties(
    cells,
    history,
    player,
    player,
    analysis
  );
  const defend = y19OwnLibDefendMoves(
    cells,
    history,
    player,
    1,
    analysis,
    owners,
    defendPoints
  );
  if (defend.length) return { type: "libDefend", positions: defend };
  return null;
}


function y19SemeaiGroupsRelated(analysis, ownGroup, targetGroup) {
  const ownLiberties = new Uint8Array(Y19_NN);
  for (const liberty of ownGroup.liberties) ownLiberties[liberty] = 1;
  for (const liberty of targetGroup.liberties) {
    if (ownLiberties[liberty]) return true;
  }
  for (const point of targetGroup.points) {
    const base = point * 4;
    for (let k = 0; k < 4; k++) {
      const next = Y19_NEIGH[base + k];
      if (next < 0) break;
      if (analysis.groupAt[next] === ownGroup.id) return true;
    }
  }
  return false;
}

function y19CurrentSemeai(cells, context) {
  return {
    target: y19CollectCurrentGroup(
      cells,
      context.targetStones,
      context.defender
    ),
    own: y19CollectCurrentGroup(
      cells,
      context.ownStones,
      context.attacker
    ),
  };
}

function y19SemeaiContextAfterAttackerMove(context, point) {
  if (point < 0 || context.committedStones?.includes(point)) return context;
  return {
    ...context,
    committedStones: [...(context.committedStones ?? []), point],
  };
}

function y19SemeaiCommittedAttackIsStable(cells, context, history) {
  const committed = context.committedStones ?? [];
  return !committed.length || y19LadderAttackIsStable(
    cells,
    committed,
    context.attacker,
    history
  );
}

function y19AddSemeaiApproaches(cells, liberties, attacker, mask) {
  for (const liberty of liberties) {
    const direct = y19TryPlay(cells, liberty, attacker);
    const directGroup = direct
      ? y19CollectCurrentGroup(direct.cells, [liberty], attacker)
      : null;
    if (directGroup && (direct.captured > 0 ||
      directGroup.liberties.length >= 2)) continue;
    const base = liberty * 4;
    for (let k = 0; k < 4; k++) {
      const supportPoint = Y19_NEIGH[base + k];
      if (supportPoint < 0) break;
      if (cells[supportPoint] !== Y19_EMPTY) continue;
      const support = y19TryPlay(cells, supportPoint, attacker);
      if (!support) continue;
      const fill = y19TryPlay(support.cells, liberty, attacker);
      if (!fill) continue;
      const fillGroup = y19CollectCurrentGroup(
        fill.cells,
        [liberty],
        attacker
      );
      if (fillGroup && (fill.captured > 0 ||
        fillGroup.liberties.length >= 2)) {
        mask[supportPoint] = 1;
      }
    }
  }
}

function y19SemeaiMoveMask(cells, state, attacker, defender, mask = null) {
  mask ??= new Uint8Array(Y19_NN);
  mask.fill(0);
  if (state.target) {
    for (const liberty of state.target.liberties) {
      mask[liberty] = 1;
    }
    y19AddSemeaiApproaches(
      cells,
      state.target.liberties,
      attacker,
      mask
    );
  }
  if (state.own) {
    for (const liberty of state.own.liberties) mask[liberty] = 1;
    y19AddSemeaiApproaches(
      cells,
      state.own.liberties,
      defender,
      mask
    );
  }
  return mask;
}

function y19SemeaiCriticalReplyMask(
  cells,
  attacker,
  analysis = null,
  mask = null
) {
  analysis ??= y19SourceAnalysis(cells);
  mask ??= new Uint8Array(Y19_NN);
  mask.fill(0);
  for (const group of analysis.groups) {
    if (group.color !== attacker || group.liberties.length > 2) continue;
    for (const liberty of group.liberties) mask[liberty] = 1;
  }
  return mask;
}

function y19SemeaiOpponentResponses(
  cells,
  history,
  context,
  state,
  raceMask,
  budget,
  analysis = null,
  scratch = null,
  boardHash = null,
  boardHash2 = null
) {
  scratch ??= {
    criticalMask: new Uint8Array(Y19_NN),
    capturedGroupIds: new Int16Array(4),
    legalPositions: [],
    retained: new Array(Y19_NN),
    retainedPoints: [],
    responses: [],
  };
  const legalPositions = scratch.legalPositions;
  legalPositions.length = 0;
  const retained = scratch.retained;
  for (const point of scratch.retainedPoints) retained[point] = null;
  scratch.retainedPoints.length = 0;
  analysis ??= y19SourceAnalysis(cells);
  const critical = y19SemeaiCriticalReplyMask(
    cells,
    context.attacker,
    analysis,
    scratch.criticalMask
  );
  y19ForEachLegalScratch(
    cells,
    context.defender,
    history,
    budget.historyHashes,
    analysis,
    (point, next, captured, hash, hash2) => {
      legalPositions.push(point);
      if (raceMask[point] || critical[point] || captured > 0) {
        retained[point] = {
          point,
          cells: Y19_DEFER_SEMEAI_REPLY_BOARDS ? null : next.slice(),
          key: null,
          hash,
          hash2,
          captured,
        };
        if (!Y19_DEFER_SEMEAI_REPLY_BOARDS) {
          budget.materializedReplies++;
        }
        scratch.retainedPoints.push(point);
      }
    },
    scratch.capturedGroupIds,
    boardHash,
    boardHash2,
    scratch.legalBoard
  );
  const policy = y19ResolveUnknownOpponentPolicy(
    cells,
    legalPositions,
    context.defender,
    false,
    analysis
  );
  const materialize = (point) => {
    const metadata = retained[point];
    if (metadata?.cells) return metadata;
    const played = y19TryPlay(cells, point, context.defender);
    if (!played) return null;
    const key = y19Key(played.cells);
    if (history.has(key)) return null;
    budget.materializedReplies++;
    return {
      point,
      cells: played.cells,
      key,
      hash: metadata?.hash ?? y19FastHashCells(played.cells),
      hash2: metadata?.hash2 ?? y19FastHashCellsSecond(played.cells),
      captured: played.captured,
    };
  };
  if (policy.forced) {
    const child = materialize(policy.forcedPosition);
    budget.policyScans++;
    budget.legalReplies += legalPositions.length;
    budget.expandedReplies += child ? 1 : 0;
    return {
      forced: true,
      responses: child ? [child] : [],
      tenuki: false,
    };
  }

  const responses = scratch.responses;
  responses.length = 0;
  if (policy.cascadePositions) {
    for (const point of policy.cascadePositions) {
      const child = materialize(point);
      if (child) responses.push(child);
    }
    budget.policyScans++;
    budget.legalReplies += legalPositions.length;
    budget.expandedReplies += responses.length;
    return { forced: false, responses, tenuki: false };
  }
  let tenuki = policy.passPossible;
  let quietReplies = 0;
  for (const point of legalPositions) {
    if (!policy.reachable[point]) continue;
    const policyLocal = !retained[point] &&
      y19SemeaiPolicyContainsPoint(point, state.target, state.own);
    if (policyLocal) budget.policyLocalReplies++;
    const child = policy.cascadeReachable[point] ||
      retained[point] || policyLocal
      ? materialize(point)
      : null;
    if (child) responses.push(child);
    else {
      tenuki = true;
      quietReplies++;
    }
  }
  budget.policyScans++;
  budget.legalReplies += legalPositions.length;
  budget.expandedReplies += responses.length + +tenuki;
  budget.collapsedReplies += Math.max(0, quietReplies - 1);
  return { forced: false, responses, tenuki };
}

function y19PartitionSemeaiChoices(choices, partition, mode) {
  if (!partition || choices.length <= 1) {
    return { choices, nextPartition: partition, split: false };
  }
  partition.mode = mode;
  return {
    choices: choices.filter(
      (_, index) => index % partition.count === partition.index
    ),
    nextPartition: null,
    split: true,
  };
}

function y19SemeaiOwnStability(cells, own, attacker, history = null) {
  if (!own || own.liberties.length < 2) return false;
  return own.liberties.length >= 3 ? true : y19RescueLadderProofStatus(
    cells,
    own.stones[0],
    attacker,
    history
  );
}

function y19SemeaiOwnIsStable(cells, own, attacker, history = null) {
  return y19SemeaiOwnStability(cells, own, attacker, history) === true;
}

function y19SemeaiTerminalSurvivesSourceReply(
  cells,
  history,
  attacker,
  defender,
  targetStones,
  ownStones,
  committedStones = ownStones
) {
  const own = y19CollectCurrentGroup(cells, ownStones, attacker);
  const target = y19CollectCurrentGroup(cells, targetStones, defender);
  if (!y19SemeaiOwnIsStable(cells, own, attacker, history) ||
    !y19LadderAttackIsStable(
      cells,
      committedStones,
      attacker,
      history
    ) ||
    (target && !y19TargetIsEffectivelyDead(
      cells,
      target,
      defender,
      history
    ))) return false;
  // The modeled policy misses the opponent's ~10% random fallback — an
  // unmodeled reply that reduces our own group or a committed stone and turns
  // the won race. When terminal safety is on, validate against EVERY legal
  // defender reply, not just the modeled-reachable subset.
  const replies = Y19_SEMEAI_TERMINAL_SAFETY
    ? y19LegalChildren(cells, defender, history)
    : y19SourceReachableChildren(cells, history, defender).children;
  for (const child of replies) {
    child.key ??= y19Key(child.cells);
    history.add(child.key);
    const nextOwn = y19CollectCurrentGroup(
      child.cells,
      ownStones,
      attacker
    );
    const nextTarget = y19CollectCurrentGroup(
      child.cells,
      targetStones,
      defender
    );
    const targetStillDead = !nextTarget || y19TargetIsEffectivelyDead(
      child.cells,
      nextTarget,
      defender,
      history
    );
    const ownSafe = y19SemeaiOwnIsStable(
      child.cells,
      nextOwn,
      attacker,
      history
    ) && y19LadderAttackIsStable(
      child.cells,
      committedStones,
      attacker,
      history
    );
    history.delete(child.key);
    if (!targetStillDead || !ownSafe) return false;
  }
  // Optional commit safety margin: every committed attacking group must keep a
  // spare liberty (>=3), so an UNMODELED opponent reply cannot immediately
  // start reducing it toward the delayed captures seen in the logs.
  if (Y19_SEMEAI_COMMIT_SAFETY) {
    const seen = new Set();
    for (const point of committedStones) {
      if (cells[point] !== attacker || seen.has(point)) continue;
      const grp = y19CollectCurrentGroup(cells, [point], attacker);
      if (!grp) continue;
      for (const stone of grp.stones) seen.add(stone);
      if (grp.liberties.length < 3) return false;
    }
  }
  return true;
}

function y19ValidateSemeaiTerminal(
  cells,
  state,
  context,
  history,
  budget,
  partition,
  analysis,
  scratch,
  boardHash,
  boardHash2
) {
  const initialStability = y19SemeaiOwnStability(
    cells,
    state.own,
    context.attacker,
    history
  );
  if (initialStability == null) {
    return y19CaptureResult(Y19_CAPTURE_UNKNOWN);
  }
  if (!initialStability) {
    return y19CaptureResult(Y19_CAPTURE_REFUTED);
  }
  if (!y19SemeaiCommittedAttackIsStable(cells, context, history)) {
    return y19CaptureResult(Y19_CAPTURE_REFUTED);
  }
  const raceMask = y19SemeaiMoveMask(
    cells,
    state,
    context.attacker,
    context.defender,
    scratch.raceMask
  );
  const opponent = y19SemeaiOpponentResponses(
    cells,
    history,
    context,
    state,
    raceMask,
    budget,
    analysis,
    scratch,
    boardHash,
    boardHash2
  );
  let ownApproachCosts = 0, defenderMinimumCapture = Infinity;
  let legalOwnFills = 0;
  for (const liberty of state.own.liberties) {
    const child = opponent.responses.find(candidate =>
      candidate.point === liberty
    );
    if (!child) {
      ownApproachCosts++;
      continue;
    }
    legalOwnFills++;
    defenderMinimumCapture = Math.min(
      defenderMinimumCapture,
      child.captured
    );
  }
  budget.raceApproachCosts += ownApproachCosts;
  if (legalOwnFills) {
    budget.raceUnavoidableCaptures += defenderMinimumCapture;
  }
  if (opponent.forced && !opponent.responses.length) {
    return y19CaptureResult(Y19_CAPTURE_UNKNOWN);
  }
  const branches = opponent.responses.map(child => ({ child }));
  if (opponent.tenuki || !opponent.responses.length) {
    branches.push({ child: null });
  }
  const selected = y19PartitionSemeaiChoices(
    branches,
    partition,
    "and"
  );
  let unresolved = false;
  for (const branch of selected.choices) {
    const child = branch.child;
    if (child) {
      child.key ??= y19Key(child.cells);
      y19SemeaiHistoryAdd(
        history,
        budget,
        child.key,
        child.cells,
        child.hash,
        child.hash2
      );
    }
    const nextCells = child?.cells ?? cells;
    const next = y19CurrentSemeai(nextCells, context);
    const targetStillDead = !next.target || y19TargetIsEffectivelyDead(
      nextCells,
      next.target,
      context.defender,
      history
    );
    const ownStability = y19SemeaiOwnStability(
      nextCells,
      next.own,
      context.attacker,
      history
    );
    const committedStable = y19SemeaiCommittedAttackIsStable(
      nextCells,
      context,
      history
    );
    if (child) {
      y19SemeaiHistoryDelete(
        history,
        budget,
        child.key,
        child.hash,
        child.hash2
      );
    }
    if (!targetStillDead || ownStability === false || !committedStable) {
      return y19CaptureResult(Y19_CAPTURE_REFUTED);
    }
    if (ownStability == null) unresolved = true;
  }
  return y19CaptureResult(
    unresolved ? Y19_CAPTURE_UNKNOWN : Y19_CAPTURE_PROVEN
  );
}

function y19EvaluateImmediateRaceBounds(
  cells,
  state,
  context,
  history,
  budget,
  partition,
  children,
  depth,
  policyHashMask
) {
  for (const child of children) {
    child.key ??= y19Key(child.cells);
    y19SemeaiHistoryAdd(
      history,
      budget,
      child.key,
      child.cells,
      child.hash,
      child.hash2
    );
    const childContext = y19SemeaiContextAfterAttackerMove(
      context,
      child.point
    );
    const childState = y19CurrentSemeai(child.cells, childContext);
    const terminal = !childState.target || y19TargetIsEffectivelyDead(
      child.cells,
      childState.target,
      context.defender,
      history
    );
    if (terminal && childState.own &&
      budget.used < budget.limit && !y19SemeaiDeadlineExceeded(budget)) {
      budget.used++;
      const childAnalysis = y19CachedSourceAnalysis(
        child.cells,
        budget,
        child.hash,
        child.hash2
      );
      const result = y19ValidateSemeaiTerminal(
        child.cells,
        childState,
        childContext,
        history,
        budget,
        partition,
        childAnalysis,
        y19SemeaiScratchFrame(budget, depth + 1),
        child.hash,
        child.hash2
      );
      child.raceBoundResult = result;
      if (result.status === Y19_CAPTURE_REFUTED) {
        budget.raceBoundBranchesPruned++;
      } else if (result.status === Y19_CAPTURE_PROVEN) {
        const hash = y19SemeaiPolicyHash(
          cells,
          state.target,
          state.own,
          policyHashMask
        );
        result.policy.push(hash[0], hash[1], child.point);
        result.line.unshift(child.point);
        budget.raceBoundsProven++;
        y19SemeaiHistoryDelete(
          history,
          budget,
          child.key,
          child.hash,
          child.hash2
        );
        return result;
      }
    }
    y19SemeaiHistoryDelete(
      history,
      budget,
      child.key,
      child.hash,
      child.hash2
    );
  }
  return null;
}

function y19ReadSemeaiNode(
  cells,
  toPlay,
  movesRemaining,
  context,
  history,
  budget,
  attackerJustMoved,
  partition = null,
  depth = 0,
  boardHash = null,
  boardHash2 = null
) {
  if (budget.used >= budget.limit || y19SemeaiDeadlineExceeded(budget)) {
    return y19CaptureResult(Y19_CAPTURE_UNKNOWN);
  }
  budget.used++;

  boardHash ??= y19FastHashCells(cells);
  boardHash2 ??= y19FastHashCellsSecond(cells);
  const scratch = y19SemeaiScratchFrame(budget, depth);
  const analysis = y19CachedSourceAnalysis(
    cells,
    budget,
    boardHash,
    boardHash2
  );
  const state = y19CurrentSemeai(cells, context);
  if (!state.own) return y19CaptureResult(Y19_CAPTURE_REFUTED);
  if (!state.target) {
    return attackerJustMoved
      ? y19ValidateSemeaiTerminal(
        cells,
        state,
        context,
        history,
        budget,
        partition,
        analysis,
        scratch,
        boardHash,
        boardHash2
      )
      : y19CaptureResult(Y19_CAPTURE_REFUTED);
  }
  const terminal = y19TargetIsEffectivelyDead(
    cells,
    state.target,
    context.defender,
    history
  );
  // A line completes only after our move creates the dead extension shape.
  if (terminal && attackerJustMoved) {
    return y19ValidateSemeaiTerminal(
      cells,
      state,
      context,
      history,
      budget,
      partition,
      analysis,
      scratch,
      boardHash,
      boardHash2
    );
  }
  const raceBounds = y19ConservativeLibertyRaceBounds(
    cells,
    state,
    context,
    analysis
  );
  y19RecordLibertyRaceBounds(budget, raceBounds);
  if (movesRemaining <= 0 || raceBounds.targetEyes >= 2) {
    budget.raceBoundsRefuted++;
    return y19CaptureResult(Y19_CAPTURE_REFUTED);
  }

  const raceMask = y19SemeaiMoveMask(
    cells,
    state,
    context.attacker,
    context.defender,
    scratch.raceMask
  );
  if (toPlay === context.attacker) {
    const forced = y19ResolveOwnForcedMoves(
      cells,
      history,
      context.attacker,
      context.ownForcedPrefix,
      analysis,
      budget
    );
    if (forced) {
      const forcedMask = new Uint8Array(Y19_NN);
      for (const point of forced.positions) forcedMask[point] = 1;
      const forcedChildren = y19LegalChildren(
        cells,
        context.attacker,
        history,
        forcedMask,
        boardHash,
        boardHash2,
        budget.historyHashes
      );
      if (forcedChildren.length !== forced.positions.length) {
        return y19CaptureResult(Y19_CAPTURE_UNKNOWN);
      }
      if (budget.frontierOnly && forcedChildren.length > 1) {
        return y19FrontierResult(
          "and",
          forcedChildren.map(child => y19FrontierBranch(
            cells,
            context.defender,
            movesRemaining - 1,
            y19SemeaiContextAfterAttackerMove(context, child.point),
            history,
            budget,
            true,
            child.point,
            child
          ))
        );
      }
      for (const child of forcedChildren) {
        const [proofNumber, disproofNumber] = y19SemeaiLeafProofNumbers(
          child.cells,
          context
        );
        child.proofNumber = proofNumber;
        child.disproofNumber = disproofNumber;
      }
      forcedChildren.sort((a, b) =>
        a.disproofNumber - b.disproofNumber ||
        a.proofNumber - b.proofNumber ||
        a.point - b.point
      );
      const selected = y19PartitionSemeaiChoices(
        forcedChildren,
        partition,
        "and"
      );
      let sawUnknown = false;
      let worstLine = [];
      const semeaiPolicy = [];
      const proofChildren = [];
      for (const child of selected.choices) {
        const childContext = y19SemeaiContextAfterAttackerMove(
          context,
          child.point
        );
        child.key ??= y19Key(child.cells);
        y19SemeaiHistoryAdd(
          history,
          budget,
          child.key,
          child.cells,
          child.hash,
          child.hash2
        );
        const result = y19ReadSemeaiNode(
          child.cells,
          context.defender,
          movesRemaining - 1,
          childContext,
          history,
          budget,
          true,
          selected.nextPartition,
          depth + 1,
          child.hash,
          child.hash2
        );
        proofChildren.push(result);
        if (result.frontier) {
          y19SemeaiHistoryDelete(
            history,
            budget,
            child.key,
            child.hash,
            child.hash2
          );
          return y19PrependFrontier(result, child.point);
        }
        y19SemeaiHistoryDelete(
          history,
          budget,
          child.key,
          child.hash,
          child.hash2
        );
        if (result.status === Y19_CAPTURE_REFUTED) return result;
        if (result.status === Y19_CAPTURE_UNKNOWN) {
          sawUnknown = true;
        } else {
          y19AppendCapturePolicy(semeaiPolicy, result.policy);
          result.line.unshift(child.point);
          if (result.line.length > worstLine.length) worstLine = result.line;
        }
      }
      if (!sawUnknown) {
        return y19CaptureResult(
          Y19_CAPTURE_PROVEN,
          worstLine,
          semeaiPolicy
        );
      }
      const [proofNumber, disproofNumber] = y19CombineProofNumbers(
        "and",
        proofChildren
      );
      return y19CaptureResult(
        Y19_CAPTURE_UNKNOWN,
        worstLine,
        semeaiPolicy,
        proofNumber,
        disproofNumber
      );
    }

    const children = y19LegalChildren(
      cells,
      context.attacker,
      history,
      raceMask,
      boardHash,
      boardHash2,
      budget.historyHashes
    );
    y19CompleteLibertyRaceBounds(
      raceBounds,
      state.target.liberties,
      children
    );
    budget.raceApproachCosts += raceBounds.targetApproachCosts;
    budget.raceUnavoidableCaptures += raceBounds.unavoidableCaptures;
    for (const child of children) {
      const childState = y19CurrentSemeai(child.cells, context);
      child.semeaiTargetLiberties =
        childState.target?.liberties.length ?? -1;
      child.semeaiOwnLiberties = childState.own?.liberties.length ?? -1;
      child.semeaiOwnAlive = childState.own ? 1 : 0;
      [child.proofNumber, child.disproofNumber] =
        y19SemeaiLeafProofNumbers(child.cells, context);
    }
    children.sort((a, b) =>
      a.proofNumber - b.proofNumber ||
      b.disproofNumber - a.disproofNumber ||
      a.semeaiTargetLiberties - b.semeaiTargetLiberties ||
      b.semeaiOwnLiberties - a.semeaiOwnLiberties ||
      b.captured - a.captured
    );
    let viableChildren = children.filter(child => child.semeaiOwnAlive);
    // A split lane must not duplicate the same exact terminal validation in
    // every worker. The coordinator or an unsplit worker performs this bound;
    // partitioned workers retain their disjoint recursive work.
    const boundedProof = partition ||
      (budget.frontierOnly && viableChildren.length > 1)
      ? null
      : y19EvaluateImmediateRaceBounds(
        cells,
        state,
        context,
        history,
        budget,
        partition,
        viableChildren,
        depth,
        scratch.policyHashMask
      );
    if (boundedProof) return boundedProof;
    viableChildren = viableChildren.filter(child =>
      child.raceBoundResult?.status !== Y19_CAPTURE_REFUTED
    );
    if (!viableChildren.length) {
      budget.raceBoundsRefuted++;
      return y19CaptureResult(Y19_CAPTURE_REFUTED);
    }
    if (budget.frontierOnly && viableChildren.length > 1) {
      const policyHash = y19SemeaiPolicyHash(
        cells,
        state.target,
        state.own,
        scratch.policyHashMask
      );
      return y19FrontierResult(
        "or",
        viableChildren.map(child => y19FrontierBranch(
          cells,
          context.defender,
          movesRemaining - 1,
          y19SemeaiContextAfterAttackerMove(context, child.point),
          history,
          budget,
          true,
          child.point,
          child,
          [policyHash[0], policyHash[1], child.point]
        ))
      );
    }
    const selected = y19PartitionSemeaiChoices(
      viableChildren,
      partition,
      "or"
    );
    let sawUnknown = false;
    const proofChildren = [];
    for (const child of selected.choices) {
      const childContext = y19SemeaiContextAfterAttackerMove(
        context,
        child.point
      );
      child.key ??= y19Key(child.cells);
      y19SemeaiHistoryAdd(
        history,
        budget,
        child.key,
        child.cells,
        child.hash,
        child.hash2
      );
      const result = child.raceBoundResult ?? y19ReadSemeaiNode(
        child.cells,
        context.defender,
        movesRemaining - 1,
        childContext,
        history,
        budget,
        true,
        selected.nextPartition,
        depth + 1,
        child.hash,
        child.hash2
      );
      proofChildren.push(result);
      if (result.frontier) {
        y19SemeaiHistoryDelete(
          history,
          budget,
          child.key,
          child.hash,
          child.hash2
        );
        const hash = y19SemeaiPolicyHash(
          cells,
          state.target,
          state.own,
          scratch.policyHashMask
        );
        return y19PrependFrontier(
          result,
          child.point,
          [hash[0], hash[1], child.point]
        );
      }
      y19SemeaiHistoryDelete(
        history,
        budget,
        child.key,
        child.hash,
        child.hash2
      );
      if (result.status === Y19_CAPTURE_PROVEN) {
        const hash = y19SemeaiPolicyHash(
          cells,
          state.target,
          state.own,
          scratch.policyHashMask
        );
        result.policy.push(hash[0], hash[1], child.point);
        result.line.unshift(child.point);
        return result;
      }
      if (result.status === Y19_CAPTURE_UNKNOWN) sawUnknown = true;
    }
    if (!sawUnknown) return y19CaptureResult(Y19_CAPTURE_REFUTED);
    const [proofNumber, disproofNumber] = y19CombineProofNumbers(
      "or",
      proofChildren
    );
    return y19CaptureResult(
      Y19_CAPTURE_UNKNOWN,
      [],
      [],
      proofNumber,
      disproofNumber
    );
  }

  const opponent = y19SemeaiOpponentResponses(
    cells,
    history,
    context,
    state,
    raceMask,
    budget,
    analysis,
    scratch,
    boardHash,
    boardHash2
  );
  if (opponent.forced && !opponent.responses.length) {
    return y19CaptureResult(Y19_CAPTURE_UNKNOWN);
  }
  const branches = opponent.responses.map(child => ({ child, pass: false }));
  if (opponent.tenuki || !opponent.responses.length) {
    branches.push({ child: null, pass: true });
  }
  for (const branch of branches) {
    [branch.proofNumber, branch.disproofNumber] =
      y19SemeaiLeafProofNumbers(branch.child?.cells ?? cells, context);
  }
  branches.sort((a, b) =>
    a.disproofNumber - b.disproofNumber ||
    a.proofNumber - b.proofNumber ||
    (a.child?.point ?? -1) - (b.child?.point ?? -1)
  );
  if (budget.frontierOnly && branches.length > 1) {
    return y19FrontierResult(
      "and",
      branches.map(branch => y19FrontierBranch(
        cells,
        context.attacker,
        movesRemaining - 1,
        context,
        history,
        budget,
        false,
        branch.child?.point ?? -1,
        branch.child
      ))
    );
  }
  const selected = y19PartitionSemeaiChoices(
    branches,
    partition,
    "and"
  );
  let sawUnknown = false;
  let worstLine = [];
  const semeaiPolicy = [];
  const proofChildren = [];
  for (const branch of selected.choices) {
    const child = branch.child;
    if (child) {
      child.key ??= y19Key(child.cells);
      y19SemeaiHistoryAdd(
        history,
        budget,
        child.key,
        child.cells,
        child.hash,
        child.hash2
      );
    }
    const result = y19ReadSemeaiNode(
      child?.cells ?? cells,
      context.attacker,
      movesRemaining - 1,
      context,
      history,
      budget,
      false,
      selected.nextPartition,
      depth + 1,
      child?.hash ?? boardHash,
      child?.hash2 ?? boardHash2
    );
    proofChildren.push(result);
    if (result.frontier) {
      if (child) {
        y19SemeaiHistoryDelete(
          history,
          budget,
          child.key,
          child.hash,
          child.hash2
        );
      }
      return y19PrependFrontier(result, child?.point ?? -1);
    }
    if (child) {
      y19SemeaiHistoryDelete(
        history,
        budget,
        child.key,
        child.hash,
        child.hash2
      );
    }
    if (result.status === Y19_CAPTURE_REFUTED) return result;
    if (result.status === Y19_CAPTURE_UNKNOWN) {
      sawUnknown = true;
    } else {
      y19AppendCapturePolicy(semeaiPolicy, result.policy);
      result.line.unshift(child?.point ?? -1);
      if (result.line.length > worstLine.length) worstLine = result.line;
    }
  }
  if (!sawUnknown) {
    return y19CaptureResult(
      Y19_CAPTURE_PROVEN,
      worstLine,
      semeaiPolicy
    );
  }
  const [proofNumber, disproofNumber] = y19CombineProofNumbers(
    "and",
    proofChildren
  );
  return y19CaptureResult(
    Y19_CAPTURE_UNKNOWN,
    worstLine,
    semeaiPolicy,
    proofNumber,
    disproofNumber
  );
}

function y19BuildSemeaiPairTasks(
  cells,
  history,
  analysis,
  attacker,
  defender,
  target,
  own
) {
  if (!target || !own ||
    !y19SemeaiGroupsRelated(analysis, own, target)) return [];
  const context = {
    attacker,
    defender,
    targetStones: target.points,
    ownStones: own.points,
  };
  const mask = y19SemeaiMoveMask(
    cells,
    { target, own },
    attacker,
    defender
  );
  const tasks = [];
  for (const child of y19LegalChildren(
    cells,
    attacker,
    history,
    mask
  )) {
    const after = y19CurrentSemeai(child.cells, context);
    if (!after.own) continue;
    tasks.push({
      targetStones: target.points.slice(),
      targetSize: target.points.length,
      targetLiberties: target.liberties.length,
      ownStones: own.points.slice(),
      ownSize: own.points.length,
      ownLiberties: own.liberties.length,
      firstMove: child.point,
      firstCapture: after.target ? 0 : 1,
    });
  }
  return tasks;
}

function y19BuildSemeaiContinuationTasks(
  board,
  historyKeys,
  attacker,
  targetStones,
  ownStones
) {
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const analysis = y19SourceAnalysis(cells);
  const targetAnchor = targetStones.find(point => cells[point] === defender);
  const ownAnchor = ownStones.find(point => cells[point] === attacker);
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  if (targetAnchor === undefined || ownAnchor === undefined) {
    return { rootKey: y19Key(cells), tasks: [] };
  }
  const target = analysis.groups[analysis.groupAt[targetAnchor]];
  const own = analysis.groups[analysis.groupAt[ownAnchor]];
  const tasks = y19BuildSemeaiPairTasks(
    cells,
    history,
    analysis,
    attacker,
    defender,
    target,
    own
  );
  tasks.sort((a, b) =>
    b.firstCapture - a.firstCapture ||
    a.targetLiberties - b.targetLiberties ||
    b.ownLiberties - a.ownLiberties ||
    a.firstMove - b.firstMove
  );
  return { rootKey: y19Key(cells), tasks };
}

function y19BuildSemeaiTasks(
  board,
  historyKeys,
  attacker,
  maximumLiberties = 8
) {
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const analysis = y19SourceAnalysis(cells);
  const ownEyes = y19SourceEyesByGroup(analysis, attacker);
  const enemyEyes = y19SourceEyesByGroup(analysis, defender);
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const ownGroups = analysis.groups.filter(group =>
    group.color === attacker &&
    group.liberties.length <= maximumLiberties &&
    (ownEyes.get(group.id)?.length ?? 0) < 2
  );
  const targetGroups = analysis.groups.filter(group =>
    group.color === defender &&
    group.points.length >= Y19_SEMEAI_MIN_TARGET_STONES &&
    group.liberties.length <= maximumLiberties &&
    (enemyEyes.get(group.id)?.length ?? 0) < 2 &&
    !y19TargetIsEffectivelyDead(
      cells,
      { stones: group.points, liberties: group.liberties },
      defender,
      history
    )
  );
  const tasks = [];
  for (const target of targetGroups) {
    for (const own of ownGroups) {
      tasks.push(...y19BuildSemeaiPairTasks(
        cells,
        history,
        analysis,
        attacker,
        defender,
        target,
        own
      ));
    }
  }
  tasks.sort((a, b) =>
    b.firstCapture - a.firstCapture ||
    b.targetSize - a.targetSize ||
    a.ownLiberties - b.ownLiberties ||
    a.targetLiberties - b.targetLiberties ||
    a.firstMove - b.firstMove
  );
  return { rootKey: y19Key(cells), tasks };
}

function y19SemeaiTaskWeight(task) {
  const targetLiberties = Number.isFinite(task.targetLiberties)
    ? task.targetLiberties
    : Number.isFinite(task.proofNumber) ? task.proofNumber : 1;
  const ownLiberties = Number.isFinite(task.ownLiberties)
    ? task.ownLiberties
    : Number.isFinite(task.disproofNumber) ? task.disproofNumber : 1;
  const liberties = targetLiberties + ownLiberties + 1;
  return liberties * liberties *
    (1 + Math.min(16, task.targetSize + task.ownSize) / 8);
}

function y19BuildSemeaiWorkerBuckets(tasks, workerCount) {
  const count = Math.max(0, Math.floor(workerCount));
  if (!count || !tasks.length) return [];
  const laneCounts = new Int16Array(tasks.length);
  laneCounts.fill(1);
  let totalLanes = tasks.length;
  while (totalLanes < count) {
    let best = 0, bestPressure = -1;
    const mode = tasks[0]?.frontierMode ?? null;
    const mostProving = mode === "or"
      ? Math.min(...tasks.map(task => task.proofNumber ?? 1))
      : mode === "and"
        ? Math.min(...tasks.map(task => task.disproofNumber ?? 1))
        : null;
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      const proofNumber = mode === "or"
        ? task.proofNumber ?? 1
        : task.disproofNumber ?? 1;
      // Every branch owns one lane. Extra lanes follow the most-proving
      // branch: minimum proof number at OR, minimum disproof at AND.
      const pnPriority = mostProving == null || proofNumber === mostProving
        ? 1
        : 0;
      const pressure = pnPriority * y19SemeaiTaskWeight(task) /
        (laneCounts[index] * (laneCounts[index] + 1));
      if (pressure > bestPressure) {
        best = index;
        bestPressure = pressure;
      }
    }
    laneCounts[best]++;
    totalLanes++;
  }

  const work = [];
  for (let taskId = 0; taskId < tasks.length; taskId++) {
    const laneCount = laneCounts[taskId];
    const weight = y19SemeaiTaskWeight(tasks[taskId]) / laneCount;
    for (let laneIndex = 0; laneIndex < laneCount; laneIndex++) {
      work.push({
        task: {
          ...tasks[taskId],
          taskId,
          laneIndex,
          laneCount,
        },
        weight,
      });
    }
  }
  work.sort((a, b) => b.weight - a.weight ||
    a.task.taskId - b.task.taskId ||
    a.task.laneIndex - b.task.laneIndex);

  const active = Math.min(count, work.length);
  const buckets = Array.from({ length: active }, () => []);
  const loads = new Float64Array(active);
  for (const item of work) {
    let worker = 0;
    for (let index = 1; index < active; index++) {
      if (loads[index] < loads[worker]) worker = index;
    }
    buckets[worker].push(item.task);
    loads[worker] += item.weight;
  }
  return buckets;
}

function y19BuildSemeaiProofRound(task, workerCount) {
  // A proof round is deliberately one root candidate wide. This lets every
  // worker partition that candidate's first meaningful AND/OR branch instead
  // of spreading the pool across unrelated root moves.
  return y19BuildSemeaiWorkerBuckets([task], workerCount);
}

function y19MergeSemeaiLaneResults(replies, rootKey) {
  const groups = new Map();
  for (const reply of replies) {
    if (reply?.rootKey !== rootKey) continue;
    for (const lane of reply.laneResults ?? []) {
      let group = groups.get(lane.taskId);
      if (!group) {
        group = [];
        groups.set(lane.taskId, group);
      }
      group.push(lane);
    }
  }

  const proven = [];
  for (const lanes of groups.values()) {
    const laneCount = lanes[0]?.laneCount ?? 1;
    const modes = new Set(lanes.map(lane => lane.splitMode).filter(Boolean));
    if (modes.size > 1) continue;
    const mode = modes.values().next().value ?? null;
    const winning = lanes.filter(lane =>
      lane.status === Y19_CAPTURE_PROVEN
    );
    if (mode === "and") {
      const unique = new Set(lanes.map(lane => lane.laneIndex));
      if (unique.size !== laneCount || winning.length !== lanes.length) {
        continue;
      }
      const policy = y19CanonicalCapturePolicy(
        winning.flatMap(lane => lane.continuationPolicy)
      );
      if (!policy) continue;
      const worst = winning.reduce((selected, lane) =>
        !selected || lane.plies > selected.plies ? lane : selected,
        null
      );
      proven.push({ ...worst, continuationPolicy: policy });
      continue;
    }
    if (!winning.length) continue;
    // OR partitions are our choice: one fully proven lane is sufficient.
    // A null mode means the line terminated before reaching a split, so the
    // lanes duplicated the same proof and one is likewise sufficient.
    winning.sort((a, b) => a.plies - b.plies ||
      a.firstMove - b.firstMove || a.laneIndex - b.laneIndex);
    proven.push(winning[0]);
  }
  return proven;
}

function y19MergeSemeaiFrontierResults(replies, rootKey, mode, branchCount) {
  const branches = y19MergeSemeaiLaneResults(replies, rootKey);
  if (mode === "or") {
    branches.sort((a, b) => a.plies - b.plies ||
      a.firstMove - b.firstMove);
    return branches.length ? [branches[0]] : [];
  }
  const byBranch = new Map();
  for (const branch of branches) {
    byBranch.set(branch.frontierBranchIndex, branch);
  }
  if (byBranch.size !== branchCount) return [];
  const values = [...byBranch.values()];
  const policy = y19CanonicalCapturePolicy(
    values.flatMap(branch => branch.continuationPolicy)
  );
  if (!policy) return [];
  const worst = values.reduce((selected, branch) =>
    !selected || branch.plies > selected.plies ? branch : selected,
    null
  );
  return [{ ...worst, continuationPolicy: policy }];
}

function y19SemeaiRoundRefuted(
  replies,
  rootKey,
  frontierMode = null,
  frontierBranchCount = 0
) {
  const groups = new Map();
  for (const reply of replies) {
    if (reply?.rootKey !== rootKey) continue;
    for (const lane of reply.laneResults ?? []) {
      let lanes = groups.get(lane.taskId);
      if (!lanes) groups.set(lane.taskId, lanes = []);
      lanes.push(lane);
    }
  }
  const statuses = [];
  for (const lanes of groups.values()) {
    const laneCount = lanes[0]?.laneCount ?? 1;
    const unique = new Set(lanes.map(lane => lane.laneIndex));
    const modes = new Set(lanes.map(lane => lane.splitMode).filter(Boolean));
    let status = Y19_CAPTURE_UNKNOWN;
    if (modes.size <= 1 && unique.size === laneCount) {
      const mode = modes.values().next().value ?? null;
      const anyProven = lanes.some(lane =>
        lane.status === Y19_CAPTURE_PROVEN
      );
      const anyRefuted = lanes.some(lane =>
        lane.status === Y19_CAPTURE_REFUTED
      );
      const allProven = lanes.every(lane =>
        lane.status === Y19_CAPTURE_PROVEN
      );
      const allRefuted = lanes.every(lane =>
        lane.status === Y19_CAPTURE_REFUTED
      );
      if (mode === "and") {
        if (anyRefuted) status = Y19_CAPTURE_REFUTED;
        else if (allProven) status = Y19_CAPTURE_PROVEN;
      } else if (mode === "or") {
        if (anyProven) status = Y19_CAPTURE_PROVEN;
        else if (allRefuted) status = Y19_CAPTURE_REFUTED;
      } else {
        // No split means every lane read the same exact line.
        if (anyProven) status = Y19_CAPTURE_PROVEN;
        else if (anyRefuted) status = Y19_CAPTURE_REFUTED;
      }
    }
    statuses.push({
      status,
      branch: lanes[0]?.frontierBranchIndex,
    });
  }
  if (!frontierMode) {
    return statuses.length === 1 &&
      statuses[0].status === Y19_CAPTURE_REFUTED;
  }
  const byBranch = new Map();
  for (const item of statuses) byBranch.set(item.branch, item.status);
  if (frontierMode === "and") {
    return [...byBranch.values()].some(
      status => status === Y19_CAPTURE_REFUTED
    );
  }
  return byBranch.size === frontierBranchCount &&
    [...byBranch.values()].every(
      status => status === Y19_CAPTURE_REFUTED
    );
}

// Per-task lane-joined statuses for a distributed prescan round: groups every
// laneResult by taskId and applies the same AND/OR lane rules as
// y19SemeaiRoundRefuted, but reports EVERY task's verdict (a Map of
// taskId -> Y19_CAPTURE_*) instead of a single-task boolean.
function y19SemeaiTaskStatuses(replies, rootKey) {
  const groups = new Map();
  for (const reply of replies) {
    if (reply?.rootKey !== rootKey) continue;
    for (const lane of reply.laneResults ?? []) {
      let lanes = groups.get(lane.taskId);
      if (!lanes) groups.set(lane.taskId, lanes = []);
      lanes.push(lane);
    }
  }
  const statuses = new Map();
  for (const [taskId, lanes] of groups) {
    const laneCount = lanes[0]?.laneCount ?? 1;
    const unique = new Set(lanes.map(lane => lane.laneIndex));
    const modes = new Set(lanes.map(lane => lane.splitMode).filter(Boolean));
    let status = Y19_CAPTURE_UNKNOWN;
    if (modes.size <= 1 && unique.size === laneCount) {
      const mode = modes.values().next().value ?? null;
      const anyProven = lanes.some(lane =>
        lane.status === Y19_CAPTURE_PROVEN
      );
      const anyRefuted = lanes.some(lane =>
        lane.status === Y19_CAPTURE_REFUTED
      );
      const allProven = lanes.every(lane =>
        lane.status === Y19_CAPTURE_PROVEN
      );
      const allRefuted = lanes.every(lane =>
        lane.status === Y19_CAPTURE_REFUTED
      );
      if (mode === "and") {
        if (anyRefuted) status = Y19_CAPTURE_REFUTED;
        else if (allProven) status = Y19_CAPTURE_PROVEN;
      } else if (mode === "or") {
        if (anyProven) status = Y19_CAPTURE_PROVEN;
        else if (allRefuted) status = Y19_CAPTURE_REFUTED;
      } else {
        if (anyProven) status = Y19_CAPTURE_PROVEN;
        else if (anyRefuted) status = Y19_CAPTURE_REFUTED;
      }
    }
    statuses.set(taskId, status);
  }
  return statuses;
}

function y19SemeaiPreScanDecision(preScan, rootKey, deepEnabled) {
  if (preScan?.results?.length) return "proven";
  if (y19SemeaiRoundRefuted([preScan], rootKey)) return "refuted";
  if (!(preScan?.frontiers?.length > 0)) return "inconclusive";
  return deepEnabled ? "deep" : "deferred";
}

function y19FindSemeai(request) {
  BOARD_SIZE = request.board.length;
  y19Configure(BOARD_SIZE);
  y19EnforceSemeaiAnalysisCache(request.maxNodes);
  y19RescueLadderCache.clear();
  const root = y19CellsFromBoard(request.board);
  const history = new Set(request.historyKeys);
  history.add(y19Key(root));
  const attacker = request.attackerColor;
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const budget = {
    used: 0,
    limit: Math.max(1, Math.floor(request.maxNodes)),
    deadline: performance.now() +
      Math.max(1, Number(request.timeLimitMs) || 1),
    policyScans: 0,
    legalReplies: 0,
    expandedReplies: 0,
    collapsedReplies: 0,
    materializedReplies: 0,
    policyLocalReplies: 0,
    analysisCacheHits: 0,
    analysisCacheMisses: 0,
    raceBoundsEvaluated: 0,
    raceBoundsProven: 0,
    raceBoundsRefuted: 0,
    raceBoundBranchesPruned: 0,
    raceSharedLiberties: 0,
    raceTargetExclusiveLiberties: 0,
    raceOwnExclusiveLiberties: 0,
    raceApproachCosts: 0,
    raceUnavoidableCaptures: 0,
    deadlineCheckCountdown: 0,
    deadlineChecks: 0,
    historyHashes: y19FastHistoryCounts(history),
    scratchFrames: [],
    frontierOnly: !!request.frontierOnly,
    baseHistory: new Set(history),
  };
  const results = [];
  const laneResults = [];
  const frontiers = [];
  for (let taskIndex = 0; taskIndex < request.tasks.length; taskIndex++) {
    const task = request.tasks[taskIndex];
    if (budget.used >= budget.limit ||
      performance.now() >= budget.deadline) break;
    if (task.frontierCells) {
      const frontierCells = task.frontierCells instanceof Uint8Array
        ? task.frontierCells
        : new Uint8Array(task.frontierCells);
      const added = [];
      for (const pathKey of task.frontierPathKeys ?? []) {
        if (history.has(pathKey)) continue;
        const hash = y19FastHashKey(pathKey);
        const hash2 = y19FastHashKeySecond(pathKey);
        y19SemeaiHistoryAdd(
          history,
          budget,
          pathKey,
          frontierCells,
          hash,
          hash2
        );
        added.push([pathKey, hash, hash2]);
      }
      const laneCount = Math.max(1, task.laneCount ?? 1);
      const partition = laneCount > 1
        ? {
          index: Math.max(0, task.laneIndex ?? 0),
          count: laneCount,
          mode: null,
        }
        : null;
      const result = y19ReadSemeaiNode(
        frontierCells,
        task.frontierToPlay,
        task.frontierMovesRemaining,
        task.frontierContext,
        history,
        budget,
        task.frontierAttackerJustMoved,
        partition,
        0,
        task.frontierHash,
        task.frontierHash2
      );
      for (let index = added.length - 1; index >= 0; index--) {
        const [pathKey, hash, hash2] = added[index];
        y19SemeaiHistoryDelete(history, budget, pathKey, hash, hash2);
      }
      const policy = result.status === Y19_CAPTURE_PROVEN
        ? y19CanonicalCapturePolicy([
          ...(task.prefixPolicy ?? []),
          ...result.policy,
        ])
        : null;
      const status = result.status === Y19_CAPTURE_PROVEN && !policy
        ? Y19_CAPTURE_UNKNOWN
        : result.status;
      laneResults.push({
        taskId: task.taskId ?? taskIndex,
        laneIndex: task.laneIndex ?? 0,
        laneCount,
        splitMode: partition?.mode ?? null,
        status,
        proofNumber: status === result.status ? result.proofNumber : 1,
        disproofNumber: status === result.status ? result.disproofNumber : 1,
        firstMove: task.firstMove,
        targetStones: task.targetStones.slice(),
        targetSize: task.targetSize,
        ownStones: task.ownStones.slice(),
        ownSize: task.ownSize,
        plies: (task.prefixLine?.length ?? 0) + result.line.length,
        line: [...(task.prefixLine ?? []), ...result.line],
        continuationPolicy: policy ?? [],
        frontierMode: task.frontierMode,
        frontierBranchIndex: task.frontierBranchIndex,
        frontierBranchCount: task.frontierBranchCount,
      });
      continue;
    }
    const played = y19TryPlay(root, task.firstMove, attacker);
    if (!played) continue;
    const key = y19Key(played.cells);
    if (history.has(key)) continue;
    const playedHash = y19FastHashCells(played.cells);
    const playedHash2 = y19FastHashCellsSecond(played.cells);
    const laneCount = Math.max(1, task.laneCount ?? 1);
    const partition = laneCount > 1
      ? {
        index: Math.max(0, task.laneIndex ?? 0),
        count: laneCount,
        mode: null,
      }
      : null;
    y19SemeaiHistoryAdd(
      history,
      budget,
      key,
      played.cells,
      playedHash,
      playedHash2
    );
    const result = y19ReadSemeaiNode(
      played.cells,
      defender,
      Math.max(0, request.maximumMoves - 1),
      {
        attacker,
        defender,
        targetStones: task.targetStones,
        ownStones: task.ownStones,
        committedStones: [task.firstMove],
        ownForcedPrefix: request.ownForcedPrefix,
      },
      history,
      budget,
      true,
      partition,
      0,
      playedHash,
      playedHash2
    );
    if (result.frontier) {
      const branchCount = result.frontier.branches.length;
      for (let branchIndex = 0; branchIndex < branchCount; branchIndex++) {
        const branch = result.frontier.branches[branchIndex];
        branch.prefixLine.unshift(task.firstMove);
        Object.assign(branch, {
          firstMove: task.firstMove,
          targetStones: task.targetStones.slice(),
          targetSize: task.targetSize,
          ownStones: task.ownStones.slice(),
          ownSize: task.ownSize,
          frontierMode: result.frontier.mode,
          frontierBranchIndex: branchIndex,
          frontierBranchCount: branchCount,
        });
        frontiers.push(branch);
      }
      y19SemeaiHistoryDelete(
        history,
        budget,
        key,
        playedHash,
        playedHash2
      );
      continue;
    }
    y19SemeaiHistoryDelete(
      history,
      budget,
      key,
      playedHash,
      playedHash2
    );
    const canonical = result.status === Y19_CAPTURE_PROVEN
      ? y19CanonicalCapturePolicy(result.policy)
      : null;
    const status = result.status === Y19_CAPTURE_PROVEN && !canonical
      ? Y19_CAPTURE_UNKNOWN
      : result.status;
    const laneResult = {
      taskId: task.taskId ?? taskIndex,
      laneIndex: task.laneIndex ?? 0,
      laneCount,
      splitMode: partition?.mode ?? null,
      status,
      proofNumber: status === result.status ? result.proofNumber : 1,
      disproofNumber: status === result.status ? result.disproofNumber : 1,
      firstMove: task.firstMove,
      targetStones: task.targetStones.slice(),
      targetSize: task.targetSize,
      ownStones: task.ownStones.slice(),
      ownSize: task.ownSize,
      plies: 1 + result.line.length,
      line: [task.firstMove, ...result.line],
      continuationPolicy: canonical ?? [],
    };
    laneResults.push(laneResult);
    if (laneCount === 1 && status === Y19_CAPTURE_PROVEN) {
      results.push(laneResult);
    }
  }
  return {
    rootKey: y19Key(root),
    results,
    laneResults,
    frontiers,
    nodesCreated: budget.used,
    nodeLimit: budget.limit,
    exhausted: budget.used >= budget.limit ||
      performance.now() >= budget.deadline,
    policyScans: budget.policyScans,
    legalReplies: budget.legalReplies,
    expandedReplies: budget.expandedReplies,
    collapsedReplies: budget.collapsedReplies,
    materializedReplies: budget.materializedReplies,
    policyLocalReplies: budget.policyLocalReplies,
    analysisCacheHits: budget.analysisCacheHits,
    analysisCacheMisses: budget.analysisCacheMisses,
    analysisCacheEntries: Y19_SEMEAI_ANALYSIS_SIZE,
    deadlineChecks: budget.deadlineChecks,
    raceBoundsEvaluated: budget.raceBoundsEvaluated,
    raceBoundsProven: budget.raceBoundsProven,
    raceBoundsRefuted: budget.raceBoundsRefuted,
    raceBoundBranchesPruned: budget.raceBoundBranchesPruned,
    raceSharedLiberties: budget.raceSharedLiberties,
    raceTargetExclusiveLiberties: budget.raceTargetExclusiveLiberties,
    raceOwnExclusiveLiberties: budget.raceOwnExclusiveLiberties,
    raceApproachCosts: budget.raceApproachCosts,
    raceUnavoidableCaptures: budget.raceUnavoidableCaptures,
  };
}

function y19LadderAttackIsStable(
  cells,
  committedStones,
  attacker,
  history = null
) {
  if (!committedStones?.length) return false;
  const seen = new Uint8Array(Y19_NN);
  for (const point of committedStones) {
    if (cells[point] !== attacker) return false;
    if (seen[point]) continue;
    const liberties = y19GroupLibs(cells, point);
    const group = Array.from(Y19_GROUP.subarray(0, Y19_GROUP_LEN));
    for (const stone of group) seen[stone] = 1;
    if (liberties < 2 || (liberties === 2 && !y19RescueSurvivesLadder(
      cells,
      point,
      attacker,
      true,
      history
    ))) return false;
  }
  return true;
}

function y19LadderTerminalSurvivesSourceReply(
  cells,
  history,
  attacker,
  defender,
  targetStones,
  committedStones,
  protectedStones
) {
  const target = y19CollectCurrentGroup(cells, targetStones, defender);
  if ((target && !y19TargetIsEffectivelyDead(
    cells,
    target,
    defender,
    history
  )) || !y19LadderAttackIsStable(
    cells,
    committedStones,
    attacker,
    history
  )) {
    return false;
  }
  // Against the modeled policy alone we miss the opponent's ~10% random
  // fallback — an unmodeled counter-atari that recaptures our committed chain
  // and revives the "dead" group. When terminal safety is on, validate against
  // EVERY legal defender reply, not just the modeled-reachable subset.
  const replies = Y19_LADDER_TERMINAL_SAFETY
    ? y19LegalChildren(cells, defender, history)
    : y19SourceReachableChildren(cells, history, defender).children;
  for (const reply of replies) {
    reply.key ??= y19Key(reply.cells);
    history.add(reply.key);
    const nextTarget = y19CollectCurrentGroup(
      reply.cells,
      targetStones,
      defender
    );
    const safe = (!nextTarget || y19TargetIsEffectivelyDead(
      reply.cells,
      nextTarget,
      defender,
      history
    )) && !committedStones.some(
      stone => reply.cells[stone] !== attacker
    ) && !protectedStones.some(
      stone => reply.cells[stone] !== attacker
    ) && y19LadderAttackIsStable(
      reply.cells,
      committedStones,
      attacker,
      history
    );
    history.delete(reply.key);
    if (!safe) return false;
  }
  return true;
}

function y19ReadOffensiveLadder(
  cells,
  originalStones,
  history,
  attacker,
  defender,
  movesRemaining,
  budget,
  ownForcedPrefix,
  committedStones,
  protectedStones,
  partition = null
) {
  if (movesRemaining <= 0 || budget.nodes-- <= 0) return null;
  if (protectedStones.some(point => cells[point] !== attacker)) return null;
  const target = y19CollectCurrentGroup(
    cells,
    originalStones,
    defender
  );
  if (!target && y19LadderTerminalSurvivesSourceReply(
    cells,
    history,
    attacker,
    defender,
    originalStones,
    committedStones,
    protectedStones
  )) {
    return {
      line: [],
      extensions: 0,
      captured: true,
    };
  }
  if (!target) return null;
  if (y19TargetIsEffectivelyDead(cells, target, defender, history) &&
    y19LadderTerminalSurvivesSourceReply(
      cells,
      history,
      attacker,
      defender,
      originalStones,
      committedStones,
      protectedStones
    )) {
    return {
      line: [],
      extensions: 0,
      captured: true,
    };
  }
  // TERMINAL: the group is at one liberty and extending into it leaves it at
  // one liberty (or is illegal) — it can never gain a liberty, so the capture
  // is proven. This is the stone we can stop on. Counts as captured=true.
  if (target.liberties.length !== 1) return null;

  // The ladder is exploitable only when the real mystery/Illuminati cascade
  // is forced to extend this exact atari group. A forced capture, eye move,
  // corner, or defense elsewhere breaks the ladder and rejects the move.
  const replies = y19LegalChildren(cells, defender, history);
  const policy = y19ResolveUnknownOpponentPolicy(
    cells,
    replies.map(child => child.point),
    defender,
    false
  );
  const extensionPoint = target.liberties[0];
  if (!policy.forced || policy.forcedPosition !== extensionPoint) {
    return null;
  }
  const extension = replies.find(
    child => child.point === extensionPoint
  );
  if (!extension) return null;
  // A forced extension that captures any stone used to construct the ladder
  // is a ladder breaker. The old reader followed the target anyway, which
  // could prove an enemy capture while our attacking chain disappeared.
  if (committedStones.some(point => extension.cells[point] !== attacker)) {
    return null;
  }

  history.add(extension.key);
  const extendedTarget = y19CollectCurrentGroup(
    extension.cells,
    originalStones,
    defender
  );
  if (!extendedTarget) {
    history.delete(extension.key);
    // The proof must finish on our capture, never on the defender's move.
    return null;
  }
  if (extendedTarget.liberties.length >= 3 || movesRemaining <= 1) {
    history.delete(extension.key);
    return null;
  }
  // BREAKER via a merge: the forced extension reached one of the defender's
  // OWN stones (its stone count grew by more than the single extension). That
  // is NOT automatically an escape — the enlarged group may still be laddered
  // to death, so keep chasing. Only abandon when the merged group PROVES
  // uncapturable: two eyes make it unconditionally alive.
  if (extendedTarget.stones.length > target.stones.length + 1 &&
    y19TargetEyeCount(extension.cells, extendedTarget, defender) >= 2) {
    history.delete(extension.key);
    return null;
  }

  const forced = y19ResolveOwnForcedMoves(
    extension.cells,
    history,
    attacker,
    ownForcedPrefix
  );
  let chaseChildren;
  let allMustWork = false;
  if (forced) {
    const forcedMask = new Uint8Array(Y19_NN);
    for (const point of forced.positions) forcedMask[point] = 1;
    chaseChildren = y19LegalChildren(
      extension.cells,
      attacker,
      history,
      forcedMask
    );
    if (chaseChildren.length !== forced.positions.length) {
      history.delete(extension.key);
      return null;
    }
    allMustWork = true;
  } else {
    const chaseMask = new Uint8Array(Y19_NN);
    for (const liberty of extendedTarget.liberties) {
      chaseMask[liberty] = 1;
    }
    chaseChildren = y19LegalChildren(
      extension.cells,
      attacker,
      history,
      chaseMask
    );
  }

  // LANE PARTITION (same structure as the semeai lanes): at the first chase
  // split that is OUR free choice (an OR node — any winning chase suffices),
  // lane i keeps only chase branches with index % laneCount === laneIndex, so
  // parallel workers read disjoint follow-up lines. A forced round must keep
  // every child (AND semantics), so the partition is carried one level deeper
  // instead. Unused lanes on a 1-branch split read the same line — identical
  // to the semeai "no split" case.
  let childPartition = partition;
  if (partition && !allMustWork && chaseChildren.length > 1) {
    chaseChildren = chaseChildren.filter((child, childIndex) =>
      childIndex % partition.count === partition.index);
    childPartition = null;
  }
  const successful = [];
  for (const chase of chaseChildren) {
    // Our chasing stone must stay safe: if the hane lands in self-atari (it
    // touches enemy stones on all but one side), the defender captures it
    // instead of extending and the ladder collapses. A capturing chase is
    // fine (it gained liberties / removed the target).
    if (chase.captured === 0 &&
      y19GroupLibs(chase.cells, chase.point) < 2) {
      if (allMustWork) {
        history.delete(extension.key);
        return null;
      }
      continue;
    }
    const chasedTarget = y19CollectCurrentGroup(
      chase.cells,
      originalStones,
      defender
    );
    if (chasedTarget && chasedTarget.liberties.length !== 1) {
      if (allMustWork) {
        history.delete(extension.key);
        return null;
      }
      continue;
    }
    history.add(chase.key);
    const continuation = y19ReadOffensiveLadder(
      chase.cells,
      originalStones,
      history,
      attacker,
      defender,
      movesRemaining - 2,
      budget,
      ownForcedPrefix,
      committedStones.includes(chase.point)
        ? committedStones
        : [...committedStones, chase.point],
      protectedStones,
      childPartition
    );
    history.delete(chase.key);
    if (!continuation) {
      if (allMustWork) {
        history.delete(extension.key);
        return null;
      }
      continue;
    }
    successful.push({
      line: [extension.point, chase.point, ...continuation.line],
      extensions: 1 + continuation.extensions,
      captured: !chasedTarget || continuation.captured,
    });
  }
  history.delete(extension.key);
  if (!successful.length) return null;
  successful.sort((a, b) =>
    +b.captured - +a.captured ||
    (Y19_LADDER_MAXIMIZE
      ? b.line.length - a.line.length
      : a.line.length - b.line.length)
  );
  return allMustWork
    ? successful.reduce((worst, result) =>
      result.line.length > worst.line.length ? result : worst
    )
    : successful[0];
}

// Would the offensive ladder capture the two-liberty enemy group identified by
// `groupStones`? Plays each liberty to atari and reads the forced chase,
// returning true only when the read actually captures. Used to validate a
// ladder BAIT: after the free fill turns a 3-lib group into a 2-lib one, that
// group must be a winning ladder or the sacrifice is wasted.
function y19GroupIsLadderable(
  cells, groupStones, attacker, defender, history, maximumMoves, budget, ownForcedPrefix
) {
  const protectedStones = [];
  for (let point = 0; point < Y19_NN; point++) {
    if (cells[point] === attacker) protectedStones.push(point);
  }
  const target = y19CollectCurrentGroup(cells, groupStones, defender);
  if (!target || target.liberties.length !== 2) return false;
  for (const liberty of target.liberties) {
    if (budget.nodes <= 0) return false;
    const attack = y19TryPlay(cells, liberty, attacker);
    if (!attack || attack.captured > 0) continue;
    if (y19GroupLibs(attack.cells, liberty) < 2) continue;
    const atari = y19CollectCurrentGroup(attack.cells, groupStones, defender);
    if (!atari || atari.liberties.length !== 1) continue;
    const attackKey = y19Key(attack.cells);
    if (history.has(attackKey)) continue;
    history.add(attackKey);
    const read = y19ReadOffensiveLadder(
      attack.cells, groupStones, history, attacker, defender,
      Math.max(0, maximumMoves - 1), budget, ownForcedPrefix, [liberty],
      protectedStones
    );
    history.delete(attackKey);
    if (read && read.extensions >= 1 && read.captured) return true;
  }
  return false;
}

// Enemy-territory mask for the ladder-bait scan: marks empty points whose empty
// region touches ONLY the defender — a bait there forces the opponent to answer
// inside their own area, draining more tempo than one in contested space.
function y19EnemyTerritoryMask(cells, defender) {
  const attacker = defender === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const mask = new Uint8Array(Y19_NN);
  const seen = new Uint8Array(Y19_NN);
  const stack = [];
  for (let start = 0; start < Y19_NN; start++) {
    if (cells[start] !== Y19_EMPTY || seen[start]) continue;
    const region = [start];
    seen[start] = 1; stack.length = 0; stack.push(start);
    let touchDef = false, touchAtk = false;
    while (stack.length) {
      const q = stack.pop(), base = q * 4;
      for (let k = 0; k < 4; k++) {
        const n = Y19_NEIGH[base + k];
        if (n < 0) break;
        const v = cells[n];
        if (v === Y19_EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); stack.push(n); } }
        else if (v === defender) touchDef = true;
        else if (v === attacker) touchAtk = true;
      }
    }
    if (touchDef && !touchAtk) for (const q of region) mask[q] = 1;
  }
  return mask;
}

function y19FindLadderBait(
  cells, group, attacker, defender, history, maximumMoves, budget, ownForcedPrefix
) {
  const perimeter = y19TargetPerimeterMask(group.points);
  const enemyTerritory = y19EnemyTerritoryMask(cells, defender);
  const candidates = [];
  let tried = 0;
  for (let p = 0; p < Y19_NN && tried < 8; p++) {
    if (budget.nodes <= 0) break;
    if (cells[p] !== Y19_EMPTY || perimeter[p]) continue;
    //single-stone bait only: never merge with an existing group
    let touchesFriendly = false;
    const base = p * 4;
    for (let k = 0; k < 4; k++) {
      const n = Y19_NEIGH[base + k];
      if (n < 0) break;
      if (cells[n] === attacker) { touchesFriendly = true; break; }
    }
    if (touchesFriendly) continue;
    const placed = y19TryPlay(cells, p, attacker);
    if (!placed || placed.captured > 0) continue;
    const placedLibs = y19GroupLibs(placed.cells, p);
    // 1-lib bait: opponent forced to CAPTURE it. 2-lib bait (when enabled):
    // opponent forced to REDUCE it to 1 lib, then capture next turn.
    if (placedLibs !== 1 && !(Y19_LADDER_BAIT_2LIB && placedLibs === 2)) continue;
    const baitKey = y19Key(placed.cells);
    if (history.has(baitKey)) continue;
    tried++;
    budget.nodes--;
    history.add(baitKey);
    //the defender's modeled reply must handle the bait as expected
    const legal = y19LegalChildren(placed.cells, defender, history);
    const policy = y19ResolveUnknownOpponentPolicy(
      placed.cells, legal.map(child => child.point), defender, false
    );
    const reply = policy.forced
      ? legal.find(child => child.point === policy.forcedPosition)
      : null;
    if (!reply) { history.delete(baitKey); continue; }
    if (placedLibs === 1) {
      // must be captured outright
      if (reply.cells[p] === attacker) { history.delete(baitKey); continue; }
    } else {
      // must be reduced to exactly one liberty (still ours, now in atari)
      const baitAfter = reply.cells[p] === attacker
        ? y19CollectCurrentGroup(reply.cells, [p], attacker)
        : null;
      if (!baitAfter || baitAfter.liberties.length !== 1) {
        history.delete(baitKey); continue;
      }
    }
    const target = y19CollectCurrentGroup(reply.cells, group.points, defender);
    if (!target) { history.delete(baitKey); continue; }
    history.add(reply.key);
    //the fill must be playable next turn: no own forced move may preempt it
    if (y19ResolveOwnForcedMoves(reply.cells, history, attacker, ownForcedPrefix)) {
      history.delete(reply.key); history.delete(baitKey); continue;
    }
    let recorded = false;
    for (const fill of target.liberties) {
      const filled = y19TryPlay(reply.cells, fill, attacker);
      if (!filled) continue;
      const fillKey = y19Key(filled.cells);
      if (history.has(fillKey)) continue;
      history.add(fillKey);
      // The fill is NOT an atari, so after it the DEFENDER moves next and
      // freely — they can simply extend the 2-lib group to safety, in which
      // case NO ladder ever starts and the sacrifice is wasted. The bait is
      // only sound if, for every reply the defender can actually reach (and a
      // pass), the group is captured or STILL a winning ladder.
      const stillLadders = boardCells => {
        const still = y19CollectCurrentGroup(boardCells, group.points, defender);
        if (!still) return true; // captured outright
        return y19GroupIsLadderable(
          boardCells, group.points, attacker, defender, history,
          Math.max(0, maximumMoves - 4), budget, ownForcedPrefix
        );
      };
      const defReplies = y19LegalChildren(filled.cells, defender, history);
      const defPolicy = y19ResolveUnknownOpponentPolicy(
        filled.cells, defReplies.map(child => child.point), defender, false
      );
      // The policy is EITHER a full reachable-set (reachable Uint8Array) OR a
      // forced "cascade" result whose reachable moves are cascadePositions
      // (reachable is null in that case). Handle both.
      const defReachable = point => defPolicy.reachable
        ? !!defPolicy.reachable[point]
        : (defPolicy.cascadePositions?.includes(point) ?? false);
      let sound = !defPolicy.passPossible || stillLadders(filled.cells);
      if (sound) {
        for (const defReply of defReplies) {
          if (!defReachable(defReply.point)) continue;
          if (budget.nodes <= 0) { sound = false; break; }
          history.add(defReply.key);
          const holds = stillLadders(defReply.cells);
          history.delete(defReply.key);
          if (!holds) { sound = false; break; }
        }
      }
      history.delete(fillKey);
      if (sound) {
        candidates.push({
          firstMove: p,
          targetStones: group.points.slice(),
          targetSize: group.points.length,
          followUpMove: fill,
          expectKey: reply.key,
          bait: true,
          inEnemyTerritory: !!enemyTerritory[p],
          baitLibs: placedLibs,
        });
        recorded = true;
        break; // one sound bait per point is enough
      }
    }
    history.delete(reply.key); history.delete(baitKey);
    void recorded;
  }
  if (!candidates.length) return null;
  // Prefer baits INSIDE enemy territory over contested, and among those the
  // 2-liberty bait (drains an extra opponent tempo), then the largest target.
  candidates.sort((a, b) =>
    +b.inEnemyTerritory - +a.inEnemyTerritory ||
    b.baitLibs - a.baitLibs ||
    b.targetSize - a.targetSize ||
    a.firstMove - b.firstMove
  );
  return candidates[0];
}

// Ranking for proven ladder candidates (shared by the sequential maker, the
// balanced orchestrator, and its lane join). Maximize mode ranks by TOTAL
// KILL — the target's stones plus every forced extension the defender adds
// during the chase, all of which die with the group — preferring the start
// liberty (and winding line) that builds the LARGEST ladder. Off = the old
// biggest-target/shortest-proof ranking.
function y19LadderCandidateCompare(a, b) {
  if (Y19_LADDER_MAXIMIZE) {
    return +b.capturedInRead - +a.capturedInRead ||
      (b.targetSize + b.extensions) - (a.targetSize + a.extensions) ||
      a.line.length - b.line.length ||
      a.firstMove - b.firstMove;
  }
  return b.targetSize - a.targetSize ||
    +b.capturedInRead - +a.capturedInRead ||
    a.line.length - b.line.length ||
    a.firstMove - b.firstMove;
}

function y19FindLadderMaker(
  board,
  historyKeys,
  attacker = Y19_BLACK,
  maximumMoves = Y19_LADDER_MAKER_MAX_MOVES,
  nodeLimit = Y19_LADDER_MAKER_NODE_LIMIT,
  cascadePosition = Y19_LADDER_MAKER_CASCADE_POSITION
) {
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const analysis = y19SourceAnalysis(cells);
  const eyes = y19SourceEyesByGroup(analysis, defender);
  const legal = y19LegalChildren(cells, attacker, history);
  const legalByPoint = new Map(legal.map(child => [child.point, child]));
  const ownForcedPrefix = Math.max(
    0,
    Math.min(3, Math.floor(cascadePosition))
  );
  const budget = { nodes: Math.max(1, Math.floor(nodeLimit)) };
  const protectedStones = [];
  for (let point = 0; point < Y19_NN; point++) {
    if (cells[point] === attacker) protectedStones.push(point);
  }
  const candidates = [];

  const ladderGroups = analysis.groups
    .filter(group =>
      group.color === defender &&
      group.liberties.length === 2 &&
      (eyes.get(group.id)?.length ?? 0) < 2
    )
    .sort((a, b) => b.points.length - a.points.length);
  for (const group of ladderGroups) {
    if (budget.nodes <= 0) break;
    for (const liberty of group.liberties) {
      const attack = legalByPoint.get(liberty);
      if (!attack) continue;
      if (attack.captured > 0 ||
        y19GroupLibs(attack.cells, liberty) < 2) continue;
      const target = y19CollectCurrentGroup(
        attack.cells,
        group.points,
        defender
      );
      if (!target || target.liberties.length !== 1) continue;
      const attackKey = attack.key;
      history.add(attackKey);
      const read = y19ReadOffensiveLadder(
        attack.cells,
        group.points,
        history,
        attacker,
        defender,
        Math.max(0, Math.floor(maximumMoves) - 1),
        budget,
        ownForcedPrefix,
        [liberty],
        protectedStones
      );
      history.delete(attackKey);
      // Only fire when the read PROVES the capture (played to zero liberties),
      // and it took at least one forced enemy extension (a genuine ladder, not
      // cleanup of an already-atari group). We never chase unconditionally.
      if (!read || read.extensions < 1 || !read.captured) continue;
      candidates.push({
        firstMove: liberty,
        targetStones: group.points.slice(),
        targetSize: group.points.length,
        line: [liberty, ...read.line],
        extensions: read.extensions,
        capturedInRead: read.captured,
        nodesRemaining: budget.nodes,
      });
    }
  }
  candidates.sort(y19LadderCandidateCompare);
  if (candidates.length) return candidates[0];

  // No DIRECT ladder. If enabled and no bait is already live, try a ladder
  // bait: a forced-capture sacrifice that fills a 3-lib group down to 2 and
  // hands it to the normal ladder next turn. Largest target first.
  if (Y19_LADDER_BAIT && !y19BaitIsActive()) {
    const baitGroups = analysis.groups
      .filter(group =>
        group.color === defender &&
        group.points.length >= 2 &&
        group.liberties.length === 3 &&
        (eyes.get(group.id)?.length ?? 0) < 2)
      .sort((a, b) => b.points.length - a.points.length);
    for (const group of baitGroups) {
      if (budget.nodes <= 0) break;
      if (y19TargetIsEffectivelyDead(
        cells,
        { stones: group.points, liberties: group.liberties },
        defender,
        history
      )) continue;
      const bait = y19FindLadderBait(
        cells, group, attacker, defender, history,
        maximumMoves, budget, ownForcedPrefix
      );
      if (bait) return bait;
    }
  }
  return null;
}

// ===== DISTRIBUTED TACTICAL READS (shared host/worker executor) =====
// One request = one balanced slice of independent read tasks on the same root
// board. Task kinds: "ladder" (direct 2-lib ladder read), "ladderFill" (bait-
// capture: a free fill takes a 3-lib group to 2, sound only if the post-capture
// group is a proven ladder), "semeaiFill" (fill brings a group back into semeai
// range, sound only if the post-capture prescan proves the race).

// Verify the AI still captures the bait after our fill: simulate the fill,
// resolve the modeled policy, and require the FORCED reply to remove the bait
// stone. Returns the post-capture board plus both path keys, or null. The
// shared history set is left unchanged.
function y19VerifyBaitCaptureAfterFill(cells, history, fillPoint, baitPoint, attacker) {
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  if (cells[baitPoint] !== attacker) return null;
  const fill = y19TryPlay(cells, fillPoint, attacker);
  if (!fill || fill.captured > 0) return null;
  const fillKey = y19Key(fill.cells);
  if (history.has(fillKey)) return null;
  history.add(fillKey);
  const legal = y19LegalChildren(fill.cells, defender, history);
  const policy = y19ResolveUnknownOpponentPolicy(
    fill.cells,
    legal.map(child => child.point),
    defender,
    false
  );
  const reply = policy.forced
    ? legal.find(child => child.point === policy.forcedPosition)
    : null;
  history.delete(fillKey);
  if (!reply || reply.cells[baitPoint] === attacker) return null;
  const replyKey = reply.key ?? y19Key(reply.cells);
  if (history.has(replyKey)) return null;
  return { postCells: reply.cells, fillKey, replyKey };
}

function y19RunTacticalReadTasks(request) {
  BOARD_SIZE = request.board.length;
  y19Configure(BOARD_SIZE);
  const cells = y19CellsFromBoard(request.board);
  const rootKey = y19Key(cells);
  const attacker = request.attackerColor;
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const history = new Set(request.historyKeys);
  history.add(rootKey);
  const ownForcedPrefix = Math.max(
    0,
    Math.min(3, Math.floor(request.ownForcedPrefix ?? Y19_OWN_FORCED_PREFIX))
  );
  const maximumMoves = Math.max(
    1,
    Math.floor(request.maximumMoves ?? Y19_LADDER_MAKER_MAX_MOVES)
  );
  const nodeLimit = Math.max(
    1,
    Math.floor(request.nodeLimit ?? Y19_LADDER_MAKER_NODE_LIMIT)
  );
  const protectedStones = [];
  for (let point = 0; point < Y19_NN; point++) {
    if (cells[point] === attacker) protectedStones.push(point);
  }
  const results = [];
  for (const task of request.tasks) {
    if (task.kind === "ladder") {
      // Mirror of the sequential reader's per-liberty check, with a fresh
      // node budget per task (a heavy group cannot starve its siblings).
      // Lane items (laneCount > 1) partition the read's first free chase
      // split so parallel workers explore disjoint follow-up lines.
      const budget = { nodes: nodeLimit };
      const partition = (task.laneCount ?? 1) > 1
        ? { index: task.laneIndex ?? 0, count: task.laneCount }
        : null;
      let ok = false, line = null, extensions = 0, captured = false;
      const attack = y19TryPlay(cells, task.liberty, attacker);
      if (attack && attack.captured === 0 &&
        y19GroupLibs(attack.cells, task.liberty) >= 2) {
        const attackKey = y19Key(attack.cells);
        if (!history.has(attackKey)) {
          const target = y19CollectCurrentGroup(
            attack.cells,
            task.groupPoints,
            defender
          );
          if (target && target.liberties.length === 1) {
            history.add(attackKey);
            const read = y19ReadOffensiveLadder(
              attack.cells,
              task.groupPoints,
              history,
              attacker,
              defender,
              Math.max(0, maximumMoves - 1),
              budget,
              ownForcedPrefix,
              [task.liberty],
              protectedStones,
              partition
            );
            history.delete(attackKey);
            if (read && read.extensions >= 1 && read.captured) {
              ok = true;
              line = [task.liberty, ...read.line];
              extensions = read.extensions;
              captured = read.captured;
            }
          }
        }
      }
      results.push({
        index: task.index ?? task.taskId,
        kind: task.kind,
        laneIndex: task.laneIndex ?? 0,
        ok,
        firstMove: task.liberty,
        line,
        extensions,
        captured,
      });
      continue;
    }
    if (task.kind === "ladderFill") {
      let ok = false;
      const verified = y19VerifyBaitCaptureAfterFill(
        cells, history, task.liberty, task.baitPoint, attacker
      );
      // The fill stone must survive the capture exchange with breathing room —
      // a self-atari fill would just gift a second stone.
      if (verified && verified.postCells[task.liberty] === attacker &&
        y19GroupLibs(verified.postCells, task.liberty) >= 2) {
        const budget = { nodes: nodeLimit };
        history.add(verified.fillKey);
        history.add(verified.replyKey);
        ok = y19GroupIsLadderable(
          verified.postCells,
          task.groupPoints,
          attacker,
          defender,
          history,
          Math.max(0, maximumMoves - 2),
          budget,
          ownForcedPrefix
        );
        history.delete(verified.replyKey);
        history.delete(verified.fillKey);
      }
      results.push({
        index: task.index,
        kind: task.kind,
        ok,
        firstMove: task.liberty,
      });
      continue;
    }
    if (task.kind === "semeaiFill") {
      let ok = false, plies = 0;
      const verified = y19VerifyBaitCaptureAfterFill(
        cells, history, task.liberty, task.baitPoint, attacker
      );
      if (verified && verified.postCells[task.liberty] === attacker) {
        const target = y19CollectCurrentGroup(
          verified.postCells,
          task.groupPoints,
          defender
        );
        if (target && target.liberties.length <= task.maxLiberties) {
          const postRows = y19RowsFromCells(verified.postCells);
          const postKeys = [...request.historyKeys, rootKey, verified.fillKey];
          const groupSet = new Set(target.stones);
          const plan = y19BuildSemeaiTasks(
            postRows,
            postKeys,
            attacker,
            task.maxLiberties
          );
          const subTasks = plan.tasks
            .filter(sub => sub.targetStones.some(point => groupSet.has(point)))
            .slice(0, 8);
          if (subTasks.length) {
            const reply = y19FindSemeai({
              board: postRows,
              historyKeys: postKeys,
              attackerColor: attacker,
              ownForcedPrefix,
              maximumMoves: Math.max(
                1,
                Math.floor(request.semeaiMaxMoves ?? maximumMoves)
              ),
              maxNodes: Math.max(1, Math.floor(request.maxNodes ?? nodeLimit)),
              timeLimitMs: Math.max(1, Math.floor(request.fillReadMs ?? 50)),
              tasks: subTasks,
              frontierOnly: true,
            });
            if (reply.results.length) {
              ok = true;
              plies = reply.results[0].plies;
            }
          }
        }
      }
      results.push({
        index: task.index,
        kind: task.kind,
        ok,
        firstMove: task.liberty,
        plies,
      });
      continue;
    }
    results.push({ index: task.index, kind: task.kind, ok: false });
  }
  return { rootKey, results };
}
// ======= END DISTRIBUTED TACTICAL READS (shared host/worker executor) =======

function y19BuildLadderContinuationPlan(
  board,
  historyKeys,
  ladder,
  attacker = Y19_BLACK
) {
  if (!ladder || ladder.bait || !Array.isArray(ladder.line) ||
    ladder.line.length < 3 || ladder.line.length % 2 === 0 ||
    ladder.line[0] !== ladder.firstMove) return null;
  y19Configure(board.length);
  let cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const policy = new Map();
  const terminalPolicyKeys = new Set();
  let finalPolicyKey = null;
  const protectedStones = [];
  const committedStones = [];
  for (let point = 0; point < Y19_NN; point++) {
    if (cells[point] === attacker) protectedStones.push(point);
  }
  for (let index = 0; index < ladder.line.length; index++) {
    const point = ladder.line[index];
    const color = index % 2 === 0 ? attacker : defender;
    const played = y19TryPlay(cells, point, color);
    if (!played) return null;
    const key = y19Key(played.cells);
    if (history.has(key)) return null;
    history.add(key);
    cells = played.cells;
    if (color === attacker) committedStones.push(point);
    // After each forced defender reply, remember our already-proven response.
    if (index % 2 === 1 && index + 1 < ladder.line.length) {
      const hash = y19CapturePolicyHash(cells);
      const policyKey = hash[0] + ":" + hash[1];
      const previous = policy.get(policyKey);
      if (previous !== undefined && previous !== ladder.line[index + 1]) {
        return null;
      }
      policy.set(policyKey, ladder.line[index + 1]);
      if (index + 1 === ladder.line.length - 1) {
        finalPolicyKey = policyKey;
      }
    }
  }
  if (!policy.size) return null;
  if (finalPolicyKey != null) {
    terminalPolicyKeys.add(finalPolicyKey);
  }
  return {
    attacker,
    targetStones: ladder.targetStones.slice(),
    targetSize: ladder.targetSize,
    protectedStones,
    committedStones,
    policy,
    terminalPolicyKeys,
  };
}

function y19ResolveLadderContinuation(board, historyKeys, consume = true) {
  const plan = y19LadderPlan;
  if (!plan) return null;
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const hash = y19CapturePolicyHash(cells);
  const policyKey = hash[0] + ":" + hash[1];
  const point = plan.policy.get(policyKey);
  if (point === undefined) {
    if (consume) y19LadderPlan = null;
    return null;
  }
  const played = y19TryPlay(cells, point, plan.attacker);
  const history = new Set(historyKeys);
  if (!played || history.has(y19Key(played.cells))) {
    if (consume) y19LadderPlan = null;
    return null;
  }
  const terminal = plan.terminalPolicyKeys?.has(policyKey) ?? false;
  if (consume) {
    plan.policy.delete(policyKey);
    plan.terminalPolicyKeys?.delete(policyKey);
    if (terminal || !plan.policy.size) y19LadderPlan = null;
  }
  return {
    coords: [(point / board.length) | 0, point % board.length],
    msg: (terminal ? "Ladder terminal stone: " : "Ladder continuation: ") +
      plan.targetSize + " stones",
    telemetry: {
      type: "ladderContinuation",
      terminal,
      targetStones: plan.targetStones,
      targetSize: plan.targetSize,
      protectedStones: plan.protectedStones,
      committedStones: plan.committedStones,
      policyRemaining: plan.policy.size - +(!consume),
    },
  };
}

// ============ END 19x19 BOARD HELPERS (cheat layer support) ============

function compactGetMovesResult(result) {
  const [q, s, children] = result;
  const compact = [q, s, children.map(c => {
    const risk = c.laneSummary ? null : summarizeRootChanceRisk(c);
    return {
      pos: c.pos,
      visits: c.visits,
      weight: c.weight,
      value: c.value,
      laneSummary: c.laneSummary ?? null,
      riskSourceWeight: risk?.sourceWeight ?? 0,
      riskCoveredWeight: risk?.coveredWeight ?? 0,
      riskLosingWeight: risk?.losingWeight ?? 0,
      riskResponseVisits: risk?.responseVisits ?? 0,
      terminalRiskTotalWeight: risk?.terminalRiskTotalWeight ?? 0,
      terminalRiskCoveredWeight: risk?.terminalRiskCoveredWeight ?? 0,
      terminalFailureWeight: risk?.terminalFailureWeight ?? 0,
      ...(CONFIDENCE_BEFORE_VALUE
        ? { variance: edgeDecisionVariance(c) }
        : {}),
    };
  })];
  return compact;
}

//End Of Worker

const IPVGO_RESOURCE_LEVELS = ["Min", "Low", "Med", "High", "Max"]
const opponent = []
const opponent2 = []
let oppNoAi = false
let oppNetburners = true
let oppSlumSnakes = true
let oppBlackHand = true
let oppTetrads = true
let oppIlluminati = true
let oppDaedalus = true
let oppRedPill = false
let slowMode = false
let REPEAT = true
let PLAY_AS_WHITE = false
let THREADS = getMaximumIPvGoThreads()
let THREAD_SETTING = THREADS
let MEMORY_USE = "Med"
let EFFORT = "Med"
let LOGINFO = false
let win = false
const ipvGoUiListeners = new Set()

/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  ns.clearLog()
  ns.ui.setTailTitle("SphyxOS - Jump3rs Ghost")
  //ns.go.analysis.resetStats(true)

  if (!Worker) {
    ns.print('Please get a real browser')
    ns.exit()
  }
  ns.atExit(() => {
    ns.clearPort(5)
    if (win) {
      win.close()
      win = false
      ns.writePort(1, "ipvgo popout off")
    }
  })
  writeProxy(ns)
  ns.clearPort(5)
  ns.writePort(5, ns.pid) //We are running!
  THREADS = resolveIPvGoThreadCount()
  //The first is to build the opponents lists, the second is to start the 200ms command receiver.
  await getCommands(ns, true)
  getCommands(ns)
  const React = getReactLib()
  if (React) {
    ns.ui.openTail()
    ns.ui.resizeTail(390, 255)
    ns.printRaw(<IPvGoControlPanel ns={ns}></IPvGoControlPanel>)
  } else {
    ns.print("React runtime unavailable; IPvGo will continue without its control panel.")
  }
  const workers = []

  let worker_script = ns.read(ns.getScriptName()).split('//End Of Worker')[0] + `
  onmessage = function(e) {
    const request = e.data;
    if (request.runtime) y19ApplyWorkerRuntime(request.runtime);
    let value;
    if (request.type === "search") {
      value = compactGetMovesResult(getMoves(...request.args));
    } else if (request.type === "y19SemeaiRead") {
      value = y19FindSemeai(request);
    } else if (request.type === "y19TacticalRead") {
      value = y19RunTacticalReadTasks(request);
    } else if (request.type === "resetGame") {
      value = resetWorkerGameState();
    } else if (request.type === "exportTree") {
      value = createSearchSnapshotUpdate(
        request.board,
        request.size,
        request.opponent,
        request.lastPassed,
        request.allowDelta,
        request.playerIsBlack,
        request.historyHashes
      );
    } else if (request.type === "importTree") {
      value = importSearchSnapshotUpdate(
        request.update,
        request.size,
        request.opponent,
        request.playerIsBlack
      );
    } else {
      throw new Error("Unknown worker request");
    }
    const transfer = request.type === "exportTree" && value?.buffer
      ? [value.buffer]
      : [];
    postMessage({ ok: true, value }, transfer);
  }`;

  const blob = new Blob([worker_script], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  ns.atExit(() => {
    workers.forEach(w => w.terminate())
    URL.revokeObjectURL(url)
  }, 'worker');

  let firstTime = true
  let rootOwnerByPosition
  let rootPassOwner = 0
  let rootResponseOwnerByAction = new Map()
  let treeOwnerWorker = null
  // Per-game cheat state: usable until the live success chance decays below
  // CHEAT_MIN_SUCCESS_CHANCE, then off for the rest of the game.
  let cheatUsable = false
  let cheatsUsed = 0
  // A new semeai may begin after Aggro(2,2,2), but all later moves in that
  // proof run from the early continuation-only slot.
  let y19SemeaiTarget = null
  let y19SemeaiOwnGroup = null
  let y19SemeaiCommittedStones = null
  let y19SemeaiPolicy = new Map()
  let y19SemeaiTerminalPlaced = false

  function loadY19CapturePolicy(flatPolicy) {
    const policy = new Map();
    for (let index = 0; index + 2 < flatPolicy.length; index += 3) {
      policy.set(
        flatPolicy[index] + ":" + flatPolicy[index + 1],
        flatPolicy[index + 2]
      );
    }
    return policy;
  }

  function y19SemeaiMoveWasTerminal(board, historyKeys) {
    if (!y19SemeaiTarget || !y19SemeaiOwnGroup) return false;
    y19Configure(board.length);
    const cells = y19CellsFromBoard(board);
    const history = new Set(historyKeys);
    history.add(y19Key(cells));
    const own = y19CollectCurrentGroup(
      cells,
      y19SemeaiOwnGroup,
      isBlack ? Y19_BLACK : Y19_WHITE
    );
    const attacker = isBlack ? Y19_BLACK : Y19_WHITE;
    if (!y19SemeaiOwnIsStable(cells, own, attacker, history) ||
      !y19LadderAttackIsStable(
        cells,
        y19SemeaiCommittedStones ?? [],
        attacker,
        history
      )) return false;
    const defender = isBlack ? Y19_WHITE : Y19_BLACK;
    const target = y19CollectCurrentGroup(
      cells,
      y19SemeaiTarget,
      defender
    );
    if (!target) return true;
    return y19TargetIsEffectivelyDead(
      cells,
      target,
      defender,
      history
    );
  }
  function requestWorker(worker, payload, workerIndex) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      };

      worker.onmessage = (msg) => {
        cleanup();
        if (!msg.data?.ok) {
          reject(new Error(msg.data?.error || `Worker ${workerIndex} failed`));
          return;
        }
        resolve(msg.data.value);
      };
      worker.onerror = (event) => {
        cleanup();
        reject(event.error ?? new Error(event.message || `Worker ${workerIndex} failed`));
      };
      worker.onmessageerror = () => {
        cleanup();
        reject(new Error(`Worker ${workerIndex} returned an unreadable message`));
      };

      worker.postMessage(payload);
    });
  }

  // ---- Balanced y19 read distribution over the worker pool ----
  // Tasks are split round-robin (task i -> worker i % N): even load, and no
  // task is ever read twice. Any slice whose worker fails or times out is
  // recomputed on the host with the same shared executor, so a bad worker can
  // cost time but never a missed read. A timed-out worker is quarantined until
  // its late reply drains — the one-in-flight protocol would otherwise let a
  // stale reply resolve the NEXT request posted to that worker.
  function y19EnsureReadPool() {
    if (!Y19_PARALLEL_READS) return [];
    treeOwnerWorker = resizeWorkerPool(
      workers,
      THREADS,
      treeOwnerWorker,
      () => new Worker(url)
    );
    return workers.filter(worker => !worker.y19Quarantined);
  }

  async function y19RequestWithTimeout(worker, payload, workerIndex, timeoutMs) {
    let timer = null;
    try {
      return await Promise.race([
        requestWorker(worker, payload, workerIndex),
        new Promise((resolvePromise, rejectPromise) => {
          timer = setTimeout(
            () => rejectPromise(new Error("y19-read-timeout")),
            Math.max(50, timeoutMs)
          );
        }),
      ]);
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  }

  async function y19RunBalancedReads(
    baseRequest,
    tasks,
    timeoutMs,
    hostRun,
    prebuiltSlices = null
  ) {
    if (!tasks.length) return [];
    const pool = y19EnsureReadPool();
    if (!pool.length) return hostRun(tasks);
    // Callers may pass weight-balanced slices (semeai lane buckets); plain
    // task lists fall back to the even round-robin split. Prebuilt slices are
    // only honored when they fit the pool — never drop a slice's tasks.
    const slices = prebuiltSlices?.length &&
      prebuiltSlices.length <= pool.length
      ? prebuiltSlices
      : y19SplitTasksRoundRobin(tasks, pool.length);
    const parts = await Promise.all(slices.map(async (slice, sliceIndex) => {
      const worker = pool[sliceIndex];
      const payload = {
        ...baseRequest,
        tasks: slice,
        runtime: y19WorkerRuntimeSnapshot(),
      };
      if (baseRequest.perTaskTimeLimitMs) {
        payload.timeLimitMs = Math.max(
          1,
          Math.min(
            baseRequest.perTaskTimeLimitMs * slice.length,
            baseRequest.maxSliceTimeLimitMs ?? Infinity
          )
        );
      }
      try {
        return [await y19RequestWithTimeout(
          worker,
          payload,
          sliceIndex,
          timeoutMs
        )];
      } catch (error) {
        if (String(error?.message).includes("y19-read-timeout")) {
          worker.y19Quarantined = true;
          worker.onmessage = () => {
            worker.y19Quarantined = false;
            worker.onmessage = null;
          };
        }
        return hostRun(slice);
      }
    }));
    return parts.flat();
  }

  // Context handed to the sphyx cascade so module-level move generators can
  // dispatch tactical reads without reaching into main()'s closure.
  const y19Reads = {
    available: () => Y19_PARALLEL_READS,
    workerCount: () => Y19_PARALLEL_READS
      ? Math.max(1, Math.floor(THREADS))
      : 0,
    tactical: async (
      board,
      historyKeys,
      attackerColor,
      tasks,
      prebuiltSlices = null
    ) => {
      const baseRequest = {
        type: "y19TacticalRead",
        board,
        historyKeys,
        attackerColor,
        ownForcedPrefix: Math.max(
          0,
          Math.min(3, Math.floor(Y19_LADDER_MAKER_CASCADE_POSITION))
        ),
        maximumMoves: Math.max(1, Math.floor(Y19_LADDER_MAKER_MAX_MOVES)),
        nodeLimit: Math.max(1, Math.floor(Y19_LADDER_MAKER_NODE_LIMIT)),
        maxNodes: Math.max(
          1,
          Math.floor(MAX_ACTIVE_SEARCH_NODES_PER_WORKER)
        ),
        semeaiMaxMoves: Math.max(1, Math.floor(Y19_SEMEAI_MAX_MOVES)),
        fillReadMs: Math.max(
          1,
          Math.floor(Number(Y19_SEMEAI_PRESCAN_TIME_LIMIT_MS) || 1)
        ),
      };
      return y19RunBalancedReads(
        baseRequest,
        tasks,
        1000,
        slice => [y19RunTacticalReadTasks({ ...baseRequest, tasks: slice })],
        prebuiltSlices
      );
    },
  };

  // SEMEAI BAIT CONVERSION (Y19_SEMEAI_BAIT): the AI is committed to capturing
  // our live createBait stone next turn, so this stone is FREE — fill one
  // liberty of a group sitting at (or one beyond) the semeai liberty cap when
  // the post-capture prescan proves the race. The move played now is just the
  // fill; next turn the regular reader finds the group in range and re-proves
  // the race live, so no continuation state needs arming here.
  async function y19SemeaiBaitFillMove(board, historyKeys, attacker) {
    if (!Y19_SEMEAI_BAIT || Y19_DEEP_SEMEAI) return null;
    const pending = y19CreateBaitCapturePending(board, historyKeys);
    if (!pending) return null;
    y19Configure(board.length);
    const cells = y19CellsFromBoard(board);
    const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
    const history = new Set(historyKeys);
    history.add(y19Key(cells));
    const analysis = y19SourceAnalysis(cells);
    const enemyEyes = y19SourceEyesByGroup(analysis, defender);
    const cap = Math.max(1, Math.floor(Y19_SEMEAI_MAX_LIBERTIES));
    // Every group eligible for a semeai check PLUS ONE LIBERTY: the free fill
    // during the AI's capture turn brings the whole band into normal range.
    const fillGroups = analysis.groups.filter(group =>
      group.color === defender &&
      group.points.length >= Y19_SEMEAI_MIN_TARGET_STONES &&
      group.liberties.length >= 2 &&
      group.liberties.length <= cap + 1 &&
      (enemyEyes.get(group.id)?.length ?? 0) < 2 &&
      !y19TargetIsEffectivelyDead(
        cells,
        { stones: group.points, liberties: group.liberties },
        defender,
        history
      )
    ).sort((a, b) => b.points.length - a.points.length);
    const tasks = [];
    for (const group of fillGroups) {
      if (tasks.length >= 32) break;
      for (const liberty of group.liberties) {
        if (tasks.length >= 32) break;
        tasks.push({
          kind: "semeaiFill",
          index: tasks.length,
          groupPoints: group.points.slice(),
          liberty,
          baitPoint: pending.baitPoint,
          maxLiberties: cap,
        });
      }
    }
    if (!tasks.length) return null;
    const repliesFill = await y19Reads.tactical(
      board,
      historyKeys,
      attacker,
      tasks
    );
    const hits = [];
    for (const reply of repliesFill) {
      for (const result of reply?.results ?? []) {
        if (!result.ok) continue;
        hits.push({
          firstMove: result.firstMove,
          plies: result.plies ?? 99,
          targetStones: tasks[result.index].groupPoints,
          targetSize: tasks[result.index].groupPoints.length,
        });
      }
    }
    if (!hits.length) return null;
    hits.sort((a, b) =>
      b.targetSize - a.targetSize ||
      a.plies - b.plies ||
      a.firstMove - b.firstMove
    );
    const best = hits[0];
    return {
      coords: [
        (best.firstMove / board.length) | 0,
        best.firstMove % board.length,
      ],
      msg: "Semeai bait fill: " + best.targetSize +
        " stones, race after the capture",
      telemetry: {
        type: "semeaiBaitFill",
        targetStones: best.targetStones,
        targetSize: best.targetSize,
      },
    };
  }

  async function resetWorkersForNewGame() {
    rootOwnerByPosition = null;
    rootPassOwner = 0;
    rootResponseOwnerByAction = new Map();
    treeOwnerWorker = null;
    y19ClearSemeaiAnalysisCache();
    if (!workers.length) return;
    await Promise.all(workers.map(async (worker, index) => {
      // A quarantined worker still owes a stale y19 read reply; reusing it
      // would let that reply resolve the reset request. Replace it outright.
      if (worker.y19Quarantined) {
        worker.terminate();
        workers[index] = new Worker(url);
        workers[index].snapshotReady = false;
        return;
      }
      try {
        await requestWorker(worker, { type: "resetGame" }, index);
        worker.snapshotReady = false;
      } catch {
        worker.terminate();
        workers[index] = new Worker(url);
        workers[index].snapshotReady = false;
      }
    }));
  }

  async function synchronizeWorkerTrees(
    board,
    opponent,
    lastPassed,
    historyHashes
  ) {
    if (firstTime || treeOwnerWorker == null) return;
    if (BOARD_SIZE !== 5) {
      // No cross-turn tree retention on the big board; each turn searches fresh.
      workers.forEach(worker => worker.snapshotReady = false);
      return;
    }
    const owner = treeOwnerWorker % workers.length;
    const publish = async (allowDelta) => {
      const update = await requestWorker(workers[owner], {
        type: "exportTree",
        board,
        size: BOARD_SIZE,
        opponent,
        lastPassed,
        allowDelta,
        playerIsBlack: isBlack,
        historyHashes,
        runtime: y19WorkerRuntimeSnapshot(),
      }, owner);
      const imported = await Promise.all(workers.map((worker, index) => {
        if (index === owner) return Promise.resolve(0);
        return requestWorker(worker, {
          type: "importTree",
          update,
          size: BOARD_SIZE,
          opponent,
          playerIsBlack: isBlack,
        }, index);
      }));
      return { update, imported };
    };

    const canDelta = workers.every(worker => worker.snapshotReady);
    let published = await publish(canDelta);
    if (published.update?.type === "delta" &&
      published.imported.some(count => count < 0)) {
      published = await publish(false);
    }
    if (!published.update ||
      published.imported.some(count => count < 0)) {
      throw new Error("Unable to synchronize worker search trees");
    }
    const hasSharedSnapshot = published.update.type !== "reset";
    workers.forEach(worker => worker.snapshotReady = hasSharedSnapshot);
  }

  async function getMoves(d, l, m, opp) {
    treeOwnerWorker = resizeWorkerPool(
      workers,
      THREADS,
      treeOwnerWorker,
      () => new Worker(url)
    );
    if (firstTime) {
      workers.forEach(worker => worker.snapshotReady = false);
    }
    await synchronizeWorkerTrees(d, opp, l, m);
    const workPlan = getRootWorkPlan(
      workers.length,
      d,
      PLAYOUTS,
      m,
      isBlack
    );
    rootOwnerByPosition = workPlan.ownerByPosition;
    rootPassOwner = workPlan.passOwner;
    const jobs = workPlan.scheduledWorkers.map((w) => {
      const worker = workers[w];
      // Every worker keeps the same playout cap. Underloaded workers use
      // their spare quota to add an independent lane to overloaded actions.
      return requestWorker(worker, {
        type: "search",
        args: [
          d,
          l,
          m,
          workPlan.tasks[w],
          opp,
          BOARD_SIZE,
          PLAYOUTS,
          firstTime,
          isBlack,
          w,
          CHEATS_ENABLED && cheatUsable,
          {
            maxActiveNodesPerWorker: MAX_ACTIVE_SEARCH_NODES_PER_WORKER,
            cheatCaptureMinStones: CHEAT_CAPTURE_MIN_STONES,
            y19BlackNearRadius: Y19_BLACK_NEAR_RADIUS,
            y19WhiteNearRadius: Y19_WHITE_NEAR_RADIUS,
          },
        ],
      }, w);
    });

    const results = await Promise.all(jobs);
    rootResponseOwnerByAction = new Map();
    for (let index = 0; index < results.length; index++) {
      const worker = workPlan.scheduledWorkers[index];
      for (const edge of results[index][2] ?? []) {
        const lane = edge.laneSummary;
        if (!lane?.partitioned) continue;
        let responseOwners = rootResponseOwnerByAction.get(edge.pos);
        if (!responseOwners) {
          responseOwners = new Map();
          rootResponseOwnerByAction.set(edge.pos, responseOwners);
        }
        for (const responsePos of lane.treePositions) {
          responseOwners.set(responsePos, worker);
        }
      }
    }
    const merged = mergeWorkerResults(results, d, isBlack, l, opp, m);
    //console.log("Merged worker results:");
    //console.log(merged);
    firstTime = false
    return merged;
  }

  async function getY19Semeai(board, historyKeys, followUpOnly) {
    if (!Y19_SEMEAI_READING ||
      !(Y19_SEMEAI_MAX_MOVES > 0)) return null;

    // The early continuation slot owns an active proof. Do not let the later
    // discovery slot replace its target merely because another cascade move
    // ran or a bounded continuation refresh did not return a move this turn.
    if (!y19MayStartSemeaiRead(
      followUpOnly,
      y19SemeaiTarget
    )) return null;

    const attacker = isBlack ? Y19_BLACK : Y19_WHITE;
    const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
    let continuationTarget = null;
    let continuationOwn = null;
    if (followUpOnly) {
      if (!y19SemeaiTarget || !y19SemeaiOwnGroup) return null;
      y19Configure(board.length);
      const cells = y19CellsFromBoard(board);
      const history = new Set(historyKeys);
      history.add(y19Key(cells));
      continuationTarget = y19CollectCurrentGroup(
        cells,
        y19SemeaiTarget,
        defender
      );
      continuationOwn = y19CollectCurrentGroup(
        cells,
        y19SemeaiOwnGroup,
        attacker
      );
      if (!continuationOwn) {
        if (LOGINFO) ns.print("Semeai cancelled: our racing group was captured");
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      const lostCommitted = (y19SemeaiCommittedStones ?? []).filter(
        point => cells[point] !== attacker
      );
      if (lostCommitted.length) {
        if (LOGINFO) ns.print("Semeai cancelled: a committed attacking group was captured");
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      if (!continuationTarget) {
        const resolved = y19SemeaiTerminalPlaced &&
          y19SemeaiOwnIsStable(cells, continuationOwn, attacker);
        if (LOGINFO) ns.print(
          resolved
            ? "Semeai resolved: our terminal stone captured the target"
            : "Semeai cancelled: target vanished without a stable survivor"
        );
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      const effectivelyDead = y19TargetIsEffectivelyDead(
        cells,
        continuationTarget,
        defender,
        history
      );
      if (effectivelyDead) {
        const stable = y19SemeaiOwnIsStable(
          cells,
          continuationOwn,
          attacker,
          history
        ) && y19LadderAttackIsStable(
          cells,
          y19SemeaiCommittedStones ?? [],
          attacker,
          history
        );
        if (LOGINFO) ns.print(stable
          ? "Semeai resolved: target cannot extend to two liberties"
          : "Semeai cancelled: our racing group is not stable");
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      y19SemeaiTerminalPlaced = false;
      if (y19TargetEyeCount(cells, continuationTarget, defender) >= 2) {
        if (LOGINFO) ns.print("Semeai cancelled: target formed two true eyes");
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      // COMMIT-VALUE GATE: an ongoing committed chase whose target has shrunk
      // below the minimum is no longer worth the multi-turn risk — release it
      // and let a direct atari take the lone remnant (the ladder still chases
      // single stones; only the committed semeai requires 2+).
      if (continuationTarget.stones.length < Y19_SEMEAI_MIN_TARGET_STONES) {
        if (LOGINFO) ns.print("Semeai released: target shrank below the committed-chase minimum");
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }

      const policyHash = y19SemeaiPolicyHash(
        cells,
        continuationTarget,
        continuationOwn
      );
      const policyKey = policyHash[0] + ":" + policyHash[1];
      const policyMove = y19SemeaiPolicy.get(policyKey);
      if (policyMove !== undefined) {
        const played = y19TryPlay(cells, policyMove, attacker);
        if (played && !history.has(y19Key(played.cells))) {
          return {
            coords: [
              (policyMove / board.length) | 0,
              policyMove % board.length,
            ],
            msg: "Semeai proven continuation",
            telemetry: {
              type: "semeai",
              continuation: true,
              targetStones: continuationTarget.stones,
              targetSize: continuationTarget.stones.length,
              ownStones: continuationOwn.stones,
              ownSize: continuationOwn.stones.length,
            },
          };
        }
        // A hash hit can only be used when it is still legal in the exact
        // live superko history. Fall through to a fresh bounded proof.
        y19SemeaiPolicy.delete(policyKey);
      }
    }

    const plan = continuationTarget
      ? y19BuildSemeaiContinuationTasks(
        board,
        historyKeys,
        attacker,
        continuationTarget.stones,
        continuationOwn.stones
      )
      : y19BuildSemeaiTasks(
        board,
        historyKeys,
        attacker,
        Math.max(1, Math.floor(Y19_SEMEAI_MAX_LIBERTIES))
      );
    const tasksToRead = plan.tasks;
    if (!tasksToRead.length) {
      if (continuationTarget) {
        if (LOGINFO) ns.print(
          "Semeai cancelled: no legal local continuation remains"
        );
        y19SemeaiTarget = null;
        y19SemeaiOwnGroup = null;
        y19SemeaiCommittedStones = null;
        y19SemeaiTerminalPlaced = false;
        y19SemeaiPolicy.clear();
        return null;
      }
      // No group is inside normal range — the bait-capture fill can still
      // reach the (cap + 1) band.
      return await y19SemeaiBaitFillMove(board, historyKeys, attacker);
    }

    const readStarted = performance.now();
    const configuredReadMs = Math.max(
      1,
      Number(Y19_SEMEAI_TIME_LIMIT_MS) || 1
    );
    const activeReadMs = Y19_DEEP_SEMEAI
      ? configuredReadMs
      : Math.min(
        configuredReadMs,
        Math.max(1, Number(Y19_SEMEAI_PRESCAN_TIME_LIMIT_MS) || 1)
      );
    const readDeadline = readStarted + Math.max(
      1,
      activeReadMs
    );
    const proofTasks = tasksToRead.slice().sort((a, b) =>
      b.targetSize - a.targetSize ||
      b.firstCapture - a.firstCapture ||
      a.targetLiberties - b.targetLiberties ||
      b.ownLiberties - a.ownLiberties ||
      a.firstMove - b.firstMove
    );
    const replies = [];
    let proven = [];
    let attemptedTasks = 0, refutedTasks = 0;
    let preScanDeferred = 0, preScanInconclusive = 0;
    let laneCount = 0, activeWorkers = 0;
    let deepWorkersReady = false;
    // QUICK SEMEAI VIA THE WORKER POOL: the sequential prescan below only
    // reached about half the candidate tasks before its deadline. Here EVERY
    // task is prescanned, split evenly round-robin across the pool with no
    // task read twice; a failed or timed-out slice is recomputed on the host.
    // Deep-proof mode keeps the sequential path (its rounds already fan out).
    const quickReadPool = !Y19_DEEP_SEMEAI && proofTasks.length
      ? y19EnsureReadPool()
      : [];
    if (quickReadPool.length) {
      // EQUAL WORK SHARE: weight-balanced lane buckets, not a plain count
      // split. Heavy tasks (more liberties = deeper reads) weigh more, and
      // whenever there are fewer tasks than workers the spare workers get
      // LANES of the same task — partitions of its first AND/OR follow-up
      // branch — so every worker holds a comparable piece of the read.
      const perTaskMs = Math.max(
        1,
        Number(Y19_SEMEAI_PRESCAN_TIME_LIMIT_MS) || 1
      );
      // Lanes engage ONLY when tasks < workers (the idle-worker case). With
      // tasks >= workers a packed bucket shares one deadline first-come-first-
      // served, starving a lane whose lost proof the AND-join then discards
      // (the first lanes regression); one lane item per bucket avoids that.
      const buckets = Y19_READ_LANES &&
        proofTasks.length < quickReadPool.length
        ? y19BuildSemeaiWorkerBuckets(proofTasks, quickReadPool.length)
        : null;
      const laneItems = buckets
        ? buckets.flat()
        : proofTasks.map((task, taskIndex) => ({ ...task, taskId: taskIndex }));
      const baseRequest = {
        type: "y19SemeaiRead",
        board,
        historyKeys,
        attackerColor: attacker,
        ownForcedPrefix: Y19_OWN_FORCED_PREFIX,
        maximumMoves: Math.max(1, Math.floor(Y19_SEMEAI_MAX_MOVES)),
        maxNodes: Math.max(
          1,
          Math.floor(MAX_ACTIVE_SEARCH_NODES_PER_WORKER)
        ),
        timeLimitMs: perTaskMs,
        perTaskTimeLimitMs: perTaskMs,
        maxSliceTimeLimitMs: configuredReadMs,
        frontierOnly: true,
      };
      const roundReplies = await y19RunBalancedReads(
        baseRequest,
        laneItems,
        configuredReadMs + 500,
        slice => slice.map(item => y19FindSemeai({
          ...baseRequest,
          timeLimitMs: perTaskMs,
          tasks: [item],
        })),
        buckets
      );
      replies.push(...roundReplies);
      attemptedTasks = proofTasks.length;
      laneCount = laneItems.length;
      activeWorkers = buckets
        ? buckets.length
        : Math.min(quickReadPool.length, laneItems.length);
      // Lane-aware joins: a multi-lane AND task is proven only when every
      // lane proves; OR/no-split tasks prove from any winning lane.
      proven = y19MergeSemeaiLaneResults(roundReplies, plan.rootKey);
      const statuses = y19SemeaiTaskStatuses(roundReplies, plan.rootKey);
      const anyFrontiers = roundReplies.some(reply =>
        reply?.rootKey === plan.rootKey && reply.frontiers?.length);
      for (const status of statuses.values()) {
        if (status === Y19_CAPTURE_REFUTED) refutedTasks++;
        else if (status !== Y19_CAPTURE_PROVEN) {
          if (anyFrontiers) preScanDeferred++;
          else preScanInconclusive++;
        }
      }
      preScanInconclusive += Math.max(
        0,
        proofTasks.length - statuses.size
      );
    } else for (const task of proofTasks) {
      let remainingMs = readDeadline - performance.now();
      if (remainingMs <= 1) break;
      attemptedTasks++;
      const frontierPlan = y19FindSemeai({
        board,
        historyKeys,
        attackerColor: attacker,
        ownForcedPrefix: Y19_OWN_FORCED_PREFIX,
        maximumMoves: Math.max(1, Math.floor(Y19_SEMEAI_MAX_MOVES)),
        maxNodes: Math.max(
          1,
          Math.floor(MAX_ACTIVE_SEARCH_NODES_PER_WORKER)
        ),
        timeLimitMs: Math.min(
          Math.max(1, Number(Y19_SEMEAI_PRESCAN_TIME_LIMIT_MS) || 1),
          remainingMs
        ),
        tasks: [task],
        frontierOnly: true,
      });
      replies.push(frontierPlan);
      const preScanDecision = y19SemeaiPreScanDecision(
        frontierPlan,
        plan.rootKey,
        Y19_DEEP_SEMEAI
      );
      if (preScanDecision === "proven") {
        proven = frontierPlan.results;
        break;
      }
      if (preScanDecision === "refuted") {
        refutedTasks++;
        continue;
      }
      const frontierTasks = frontierPlan.frontiers ?? [];
      if (preScanDecision !== "deep") {
        if (preScanDecision === "deferred") preScanDeferred++;
        else preScanInconclusive++;
        continue;
      }
      if (!deepWorkersReady) {
        treeOwnerWorker = resizeWorkerPool(
          workers,
          THREADS,
          treeOwnerWorker,
          () => new Worker(url)
        );
        deepWorkersReady = true;
      }
      remainingMs = readDeadline - performance.now();
      if (remainingMs <= 1) break;
      const buckets = y19BuildSemeaiWorkerBuckets(
        frontierTasks,
        workers.length
      );
      activeWorkers = Math.max(activeWorkers, buckets.length);
      laneCount += buckets.reduce(
        (count, workerTasks) => count + workerTasks.length,
        0
      );
      const roundReplies = await Promise.all(
        buckets.map((workerTasks, workerIndex) =>
          requestWorker(workers[workerIndex], {
            type: "y19SemeaiRead",
            board,
            historyKeys,
            attackerColor: attacker,
            ownForcedPrefix: Y19_OWN_FORCED_PREFIX,
            maximumMoves: Math.max(
              1,
              Math.floor(Y19_SEMEAI_MAX_MOVES)
            ),
            maxNodes: Math.max(
              1,
              Math.floor(MAX_ACTIVE_SEARCH_NODES_PER_WORKER)
            ),
            timeLimitMs: Math.max(1, remainingMs),
            tasks: workerTasks,
          }, workerIndex)
        )
      );
      replies.push(...roundReplies);
      const roundProof = y19MergeSemeaiFrontierResults(
        roundReplies,
        plan.rootKey,
        frontierTasks[0].frontierMode,
        frontierTasks[0].frontierBranchCount
      );
      if (roundProof.length) {
        proven = roundProof;
        break;
      }
      if (y19SemeaiRoundRefuted(
        roundReplies,
        plan.rootKey,
        frontierTasks[0]?.frontierMode ?? null,
        frontierTasks[0]?.frontierBranchCount ?? 0
      )) {
        refutedTasks++;
      }
    }

    // The toggle and board are checked after the await. A live change or a
    // stale result cannot cause a move after the reader has been disabled.
    if (!Y19_SEMEAI_READING) return null;
    y19Configure(board.length);
    const currentRows = await proxy(ns, "go.getBoardState")
    if (y19Key(y19CellsFromBoard(currentRows)) !== plan.rootKey) return null;

    const readStats = replies.reduce((stats, reply) => {
      stats.nodes += reply?.nodesCreated ?? 0;
      stats.policyScans += reply?.policyScans ?? 0;
      stats.legalReplies += reply?.legalReplies ?? 0;
      stats.expandedReplies += reply?.expandedReplies ?? 0;
      stats.collapsedReplies += reply?.collapsedReplies ?? 0;
      stats.materializedReplies += reply?.materializedReplies ?? 0;
      stats.policyLocalReplies += reply?.policyLocalReplies ?? 0;
      stats.analysisCacheHits += reply?.analysisCacheHits ?? 0;
      stats.analysisCacheMisses += reply?.analysisCacheMisses ?? 0;
      for (const key of [
        "raceBoundsEvaluated", "raceBoundsProven", "raceBoundsRefuted",
        "raceBoundBranchesPruned", "raceSharedLiberties",
        "raceTargetExclusiveLiberties", "raceOwnExclusiveLiberties",
        "raceApproachCosts", "raceUnavoidableCaptures",
      ]) stats[key] += reply?.[key] ?? 0;
      stats.analysisCacheEntries = Math.max(
        stats.analysisCacheEntries,
        reply?.analysisCacheEntries ?? 0
      );
      return stats;
    }, {
      nodes: 0,
      policyScans: 0,
      legalReplies: 0,
      expandedReplies: 0,
      collapsedReplies: 0,
      materializedReplies: 0,
      policyLocalReplies: 0,
      analysisCacheHits: 0,
      analysisCacheMisses: 0,
      analysisCacheEntries: 0,
      raceBoundsEvaluated: 0,
      raceBoundsProven: 0,
      raceBoundsRefuted: 0,
      raceBoundBranchesPruned: 0,
      raceSharedLiberties: 0,
      raceTargetExclusiveLiberties: 0,
      raceOwnExclusiveLiberties: 0,
      raceApproachCosts: 0,
      raceUnavoidableCaptures: 0,
    });
    proven.sort((a, b) =>
      b.targetSize - a.targetSize ||
      a.plies - b.plies ||
      a.firstMove - b.firstMove
    );
    const best = proven[0];
    if (!best) {
      if (!continuationTarget) {
        // Nothing proven in normal range — try the bait-capture fill that
        // brings a group one liberty beyond the cap into a proven race.
        const fillMove = await y19SemeaiBaitFillMove(
          board,
          historyKeys,
          attacker
        );
        if (fillMove) return fillMove;
      }
      if (continuationTarget) {
        const exactlyRefuted = attemptedTasks === proofTasks.length &&
          refutedTasks === proofTasks.length;
        if (exactlyRefuted) {
          if (LOGINFO) ns.print("Semeai cancelled: continuation was exactly refuted");
          y19SemeaiTarget = null;
          y19SemeaiOwnGroup = null;
          y19SemeaiCommittedStones = null;
          y19SemeaiTerminalPlaced = false;
          y19SemeaiPolicy.clear();
        } else {
          if (LOGINFO) ns.print(
            preScanDeferred && !Y19_DEEP_SEMEAI
              ? "Semeai deferred: deep proof is disabled"
              : "Semeai deferred: the pre-scan did not prove this race"
          );
        }
      }
      return null;
    }
    y19SemeaiTarget = best.targetStones.slice();
    y19SemeaiOwnGroup = best.ownStones.slice();
    if (!continuationTarget || !y19SemeaiCommittedStones) {
      y19SemeaiCommittedStones = [];
    }
    if (!y19SemeaiCommittedStones.includes(best.firstMove)) {
      y19SemeaiCommittedStones.push(best.firstMove);
    }
    y19SemeaiTerminalPlaced = false;
    y19SemeaiPolicy = loadY19CapturePolicy(
      best.continuationPolicy ?? []
    );
    return {
      coords: [
        (best.firstMove / board.length) | 0,
        best.firstMove % board.length,
      ],
      msg: "Semeai: " + best.targetSize + " enemy vs " +
        best.ownSize + " own, " + (best.plies === 1
          ? "terminal stone played now"
          : "terminal in " + best.plies + " moves"),
      telemetry: {
        type: "semeai",
        targetStones: best.targetStones,
        targetSize: best.targetSize,
        ownStones: best.ownStones,
        ownSize: best.ownSize,
        readMs: performance.now() - readStarted,
        tasks: tasksToRead.length,
        attemptedTasks,
        deepEnabled: Y19_DEEP_SEMEAI,
        preScanDeferred,
        preScanInconclusive,
        lanes: laneCount,
        workers: activeWorkers,
        ...readStats,
      },
    };
  }

  function responseTreeOwner(rootPos, response) {
    const responsePos = response?.type === "move"
      ? response.x * BOARD_SIZE + response.y
      : response?.type === "pass"
        ? -1
        : null;
    const fallback = rootPos === -1
      ? rootPassOwner
      : rootOwnerByPosition[rootPos];
    return responsePos == null
      ? fallback
      : rootResponseOwnerByAction.get(rootPos)?.get(responsePos) ??
      fallback;
  }

  // ---- Game flow (SphyxOS/go.js style) ----
  // Continue whatever board is currently loaded; only start a fresh game once
  // this one ends (checkNewGame). No games/opponent for-loops. The single
  // board-size split is how we pick our move: 5x5 uses the MCTS search, the
  // 19x19 ???? board uses the Sphyx cascade.

  // Reset every per-game variable. `doReset` also loads a brand-new board — used
  // only when repeating after a game ends; the first game continues the board
  // already on screen.
  let ct = 0
  async function startGame(doReset) {
    // Color controls are requested live but become active only at a game
    // boundary, so a button click can never switch the side of an in-flight game.
    isBlack = !PLAY_AS_WHITE
    const currentBoard = await proxy(ns, "go.getBoardState")
    if (currentBoard[0].length !== 19 && currentBoard[0].length > 5) {
      ns.tprintf("Invalid board continuation detected for IPvGo.  Size " + currentBoard[0].length + " is not supported.  Resetting.")
      doReset = true
    }
    let opp;
    if (!opponent.length && !opponent2.length) throw new Error("No valid AI opponent detected while creating a new game.  Exiting."); 
    if (doReset) {
      try { ns.go.resetBoardState(opp = opponent2[Math.floor(Math.random() * opponent2.length)], 5) }
      catch { ns.go.resetBoardState(opp = opponent[Math.floor(Math.random() * opponent.length)], 5) }
    }
    else opp = ns.go.getOpponent()
    ct++
    BOARD_SIZE = opp === "????????????" ? 19 : 5
    applyIPvGoSearchSettings(opp)
    firstTime = true
    treeOwnerWorker = null
    await resetWorkersForNewGame()
    // cheatUsable drives the host first-choice playTwoMoves layer (5x5 only, per
    // user); the cascade's own cheat steps are gated by CHEATS_ENABLED instead.
    cheatUsable = CHEATS_ENABLED && (isBlack || opp === "No AI") && BOARD_SIZE === 5
    cheatsUsed = 0
    sphyxTurn = 0
    sphyxOpeningPlaced = 0
    sphyxOpeningBaitPlaced = []
    y19BaitFollowUp = null
    y19BaitOwner = null
    y19LadderPlan = null
    y19RouterKill = null
    y19SemeaiTarget = null
    y19SemeaiOwnGroup = null
    y19SemeaiCommittedStones = null
    y19SemeaiTerminalPlaced = false
    y19SemeaiPolicy.clear()
    BAITED = null
    turn = 0
  }

  // Once the current game ends (game over, or both sides passed), start a fresh
  // game of the SAME opponent + board size and keep playing.
  async function checkNewGame(gameInfo, passed) {
    if (gameInfo?.type === "gameOver" ||
      (gameInfo?.type === "pass" && passed)) {
      if (!REPEAT) ns.exit()
      while (workers.length) {
        let worker = workers.pop()
        worker.terminate()
        worker = null
      }
      await startGame(true)
    }
  }

  let turn = 0
  let opponent = ns.go.getOpponent()
  // Pick up the board exactly where it is — reset only if it is already
  // finished. Then, if it is the opponent's move, let them play first.
  if (ns.go.getCurrentPlayer() === "None")
    await startGame(true)
  else
    await startGame(false)
  let lastMove = {}

  while (true) {//ct <= 1000) {
    if (slowMode) await ns.asleep(1000)
    else await ns.asleep(4)
    await pushBoard(ns, turn)
    // Turn sync. Reset a finished game, and when it is the OPPONENT's move wait
    // for them before we play — covers No-AI white play (the human moves black
    // between our turns) and the first move after a reset when we are white and
    // the opponent goes first. Without this, makeMove throws "not your turn".
    const currentPlayer = ns.go.getCurrentPlayer()
    if (currentPlayer === "None") {
      await checkNewGame({ type: "gameOver" }, false)
      continue
    }
    if (currentPlayer !== (isBlack ? "Black" : "White")) {
      lastMove = await ns.go.opponentNextTurn(false, !isBlack)
      if (lastMove?.type === "move") goMark(lastMove.x, lastMove.y)
      await checkNewGame(lastMove, false)
      continue
    }
    turn++
    const boardState = await proxy(ns, "go.getBoardState")
    BOARD_SIZE = boardState[0].length
    // Apply UI/loader resource changes only between moves, never while worker
    // requests are in flight.
    applyIPvGoSearchSettings(ns.go.getOpponent())
    let passed = false
    // The opponent passed and the game is already decided — pass to end it.
    if (lastMove?.type == 'pass') {
      const { blackScore, whiteScore, komi } = ns.go.getGameState();
      if ((isBlack && whiteScore == komi) ||
        (!isBlack && blackScore == 0)) {
        lastMove = await ns.go.passTurn(!isBlack);
        await checkNewGame(lastMove, true);
        continue;
      }
    }
    // PLAY-TWO-MOVES CHEAT — first-choice layer. A guaranteed capture
    // of a qualifying two-liberty group beats anything the search can
    // return, so it is played before any worker time is spent. The
    // live success chance is re-read each turn; once it drops below
    // the floor, cheating is off for the rest of the game.
    if (CHEATS_ENABLED && cheatUsable) {
      if (readCheatSuccessChance(ns, !isBlack) <
        CHEAT_MIN_SUCCESS_CHANCE) {
        cheatUsable = false;
      } else {
        y19Configure(BOARD_SIZE);
        const boardState = await proxy(ns, "go.getBoardState")
        const cheatPairs = y19CheatCapturePairs(
          y19CellsFromBoard(boardState),
          isBlack ? Y19_BLACK : Y19_WHITE
        );
        if (cheatPairs.length) {
          const pick = cheatPairs[0];

          const playAsWhite = !isBlack;
          const countBefore = await readCheatCount(ns, playAsWhite);
          const chanceBefore = readCheatSuccessChance(
            ns,
            playAsWhite
          );
          lastMove = await proxy(ns, "go.cheat.playTwoMoves",
            (pick.p1 / BOARD_SIZE) | 0,
            pick.p1 % BOARD_SIZE,
            (pick.p2 / BOARD_SIZE) | 0,
            pick.p2 % BOARD_SIZE,
            playAsWhite
          );
          if (lastMove) {
            const countAfter = await readCheatCount(ns, playAsWhite);
            cheatsUsed = countAfter ?? cheatsUsed + 1;
            const chanceAfter = readCheatSuccessChance(
              ns,
              playAsWhite
            );
            const afterBoard = await proxy(ns, "go.getBoardState")
            const enemy = isBlack ? "O" : "X";
            const remainingTarget = pick.targetStones.reduce(
              (count, point) => count + +(
                afterBoard[(point / BOARD_SIZE) | 0]?.[
                point % BOARD_SIZE
                ] === enemy
              ),
              0
            );
            const audit = {
              kind: `playTwoMoves/capture-${pick.stones}`,
              coords: [
                (pick.p1 / BOARD_SIZE) | 0,
                pick.p1 % BOARD_SIZE,
                (pick.p2 / BOARD_SIZE) | 0,
                pick.p2 % BOARD_SIZE,
              ],
              countBefore,
              countAfter,
              chanceBefore,
              chanceAfter,
            };
            if (LOGINFO) ns.printf(
              formatCheatAudit(audit) +
              `; target remaining ${remainingTarget}/${pick.stones}`
            );
            if (remainingTarget === pick.stones) {
              if (LOGINFO) ns.print(
                "CHEAT VERIFY FAILED: the targeted enemy group was " +
                "unchanged after playTwoMoves and the opponent reply"
              );
              cheatUsable = false;
            } else if (chanceAfter < CHEAT_MIN_SUCCESS_CHANCE) {
              cheatUsable = false;
            }
            // The retained trees never modeled a two-stone turn.
            treeOwnerWorker = null;
            await checkNewGame(lastMove, false);
            continue;
          }
          else

            // Rejected by the API (should not happen at 100%): fall
            // back to the normal search permanently this game.
            cheatUsable = false;

        }
      }
    }
    // SPHYX 19x19 CASCADE — the big board is played by the ported
    // Sphyx move cascade directly: analyze the current board, walk the
    // priority list, play. No retained MCTS tree; the ladder and semeai
    // steps DO fan their reads out across the worker pool (y19Reads),
    // each read bounded by MAX_ACTIVE_SEARCH_NODES_PER_WORKER.
    if (BOARD_SIZE !== 5) {
      const seen19 = ns.go.getMoveHistory().map(board => {
        y19Configure(board.length);
        return y19Key(y19CellsFromBoard(board));
      });
      const sphyxPlayed = await sphyxPlayTurn(
        ns,
        seen19,
        Y19_SEMEAI_READING
          ? getY19Semeai
          : null,
        y19SemeaiTarget != null,
        y19Reads
      );
      if (y19SemeaiTarget && sphyxPlayed.coords) {
        const point = sphyxPlayed.coords[0] * BOARD_SIZE +
          sphyxPlayed.coords[1];
        y19SemeaiCommittedStones ??= [];
        if (!y19SemeaiCommittedStones.includes(point)) {
          y19SemeaiCommittedStones.push(point);
        }
      }
      if (sphyxPlayed.telemetry?.type === "semeai" ||
        sphyxPlayed.detail === "semeai forced continuation") {
        const terminalHistory19 = ns.go.getMoveHistory().map(state => {
          y19Configure(state.length);
          return y19Key(y19CellsFromBoard(state));
        });
        const boardState = await proxy(ns, "go.getBoardState")
        y19SemeaiTerminalPlaced = y19SemeaiMoveWasTerminal(
          boardState,
          terminalHistory19
        );
      }
      if (sphyxPlayed.telemetry?.type === "cheat") {
        const audit = sphyxPlayed.telemetry;
        cheatsUsed = audit.countAfter ?? cheatsUsed + 1;
        if (LOGINFO) ns.printf(
          formatCheatAudit(audit) +
          (audit.verified === false ? "; VERIFY FAILED" : "")
        );
        if (audit.verified === false ||
          audit.chanceAfter < CHEAT_MIN_SUCCESS_CHANCE) {
          cheatUsable = false;
        }
      }
      if (LOGINFO) ns.printf(
        sphyxPlayed.detail
          ? sphyxPlayed.msg + " [" + sphyxPlayed.detail + "]"
          : sphyxPlayed.msg
      )
      lastMove = sphyxPlayed.response;
      passed = sphyxPlayed.msg === "Turn Passed";
      if (sphyxPlayed.coords)
        goMark(sphyxPlayed.coords[0], sphyxPlayed.coords[1]);
      if (lastMove?.type === "move") goMark(lastMove.x, lastMove.y);
      await pushBoard(ns, turn, sphyxPlayed.msg);
      treeOwnerWorker = null;
      await checkNewGame(lastMove, passed);
      continue;
    }
    let seen = ns.go.getMoveHistory().map(x => zobristHash(x, false));
    const boardState2 = await proxy(ns, "go.getBoardState")
    const m = await getMoves(
      boardState2,
      lastMove?.type == 'pass',
      seen,
      opponent
    );

    let moved = false;

    const orderedMoves = m[2];
    for (let e of orderedMoves) {
      if (e.pos == -1) {
        // The search wants to pass — fall through to the pass handler
        // below, which first tries a last-ditch cheat.
        break;
      }

      if (!e.visits) {
        continue;
      }

      const myX = (e.pos / BOARD_SIZE) | 0;
      const myY = e.pos % BOARD_SIZE;
      lastMove = await ns.go.makeMove(myX, myY, !isBlack);
      goMark(myX, myY);
      if (lastMove?.type === "move") goMark(lastMove.x, lastMove.y);
      treeOwnerWorker = responseTreeOwner(e.pos, lastMove)
      moved = true;
      break;
    }

    if (!moved) {
      // LAST-DITCH CHEAT BEFORE PASSING (5x5): the search has nothing
      // worth playing. Before conceding the turn, see if a snake-eyes
      // capture or a wall-breaker sever/split can still grab stones —
      // comboCheat(1) catches the small captures and the destroyNode
      // kills that the guaranteed playTwoMoves first-choice layer (min
      // stones, playTwoMoves only) never plays. Cheats-enabled only.
      let cheatResponse = null;
      if (CHEATS_ENABLED && cheatUsable) {
        if (readCheatSuccessChance(ns, !isBlack) <
          CHEAT_MIN_SUCCESS_CHANCE) {
          cheatUsable = false;
        } else {
          const boardState = await proxy(ns, "go.getBoardState")
          sphyxAnalyzeBoard(boardState, new Set());
          const combo = comboCheat(1);
          if (combo && combo.coords) {
            const cheat = combo.kind === "snakeEyes"
              ? await sphyxSnakeEyes(ns, combo)
              : await sphyxWallBreaker(ns, combo);
            if (cheat) {
              const audit = cheat.telemetry;
              cheatsUsed = audit.countAfter ?? cheatsUsed + 1;
              if (LOGINFO) ns.printf(
                formatCheatAudit(audit) +
                (audit.verified === false ? "; VERIFY FAILED" : "")
              );
              if (audit.verified === false ||
                audit.chanceAfter < CHEAT_MIN_SUCCESS_CHANCE) {
                cheatUsable = false;
              }
              // The retained trees never modeled a cheat turn.
              treeOwnerWorker = null;
              cheatResponse = cheat.response;
            }
          }
        }
      }
      if (cheatResponse) {
        lastMove = cheatResponse;
      } else {
        lastMove = await ns.go.passTurn(!isBlack);
        treeOwnerWorker = responseTreeOwner(-1, lastMove)
        passed = true;
      }
    }
    await checkNewGame(lastMove, passed);
  }
}
// ---- IPvGo board view: render the live board to the popout window `win` ----
// `win` is a top-level variable created elsewhere (makeNewWindow) that exposes
// win.setHTML(selector, html). No-op when the window is absent or closed, and
// skips the redraw when the board, side-to-move, and highlighted moves are all
// unchanged. The last two moves are ringed — newest bright, prior faint.
// getBoardState() gives columns ([x] left->right, [x][0] bottom), so y is
// flipped to draw the board in the same orientation as the in-game UI.
function goMark(x, y) {
  if (x == null || y == null || x < 0 || y < 0) return;
  goTrail.push([x, y]);
  if (goTrail.length > 2) goTrail.shift();
}
function renderGoBoard(rows, info) {
  const size = rows.length;
  const px = Math.max(14, Math.floor(400 / size));
  const newest = goTrail[goTrail.length - 1];
  const prior = goTrail.length > 1 ? goTrail[0] : null;
  let cells = "";
  for (let r = 0; r < size; r++) {          // display rows, top -> bottom
    const y = size - 1 - r;                  // board row ([x][0] is the bottom)
    for (let x = 0; x < size; x++) {         // display cols, left -> right
      const ch = rows[x][y];
      const base = ch === "X" ? "b" : ch === "O" ? "w" : ch === "#" ? "off" : "e";
      const mark = newest && newest[0] === x && newest[1] === y
        ? " last"
        : prior && prior[0] === x && prior[1] === y
          ? " prev"
          : "";
      cells += '<div class="gpt ' + base + mark + '"></div>';
    }
  }
  const safeMsg = "";
  /*const safeMsg = info.msg
    ? " &middot; " + String(info.msg).replace(/[&<>]/g,
      c => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"))
    : "";*/
  const style =
    '<style>' +
    '.gstatus{padding:5px 6px;font-size:13px;text-align:center;white-space:nowrap}' +
    '.goban{display:grid;gap:1px;background:#c9a86a;padding:6px;margin:4px auto;' +
    'width:max-content;grid-template-columns:repeat(' + size + ',' + px + 'px);' +
    'grid-auto-rows:' + px + 'px}' +
    '.gpt{background:#dcb35c;position:relative}' +
    '.gpt.b::after,.gpt.w::after{content:"";position:absolute;inset:8%;' +
    'border-radius:50%;box-shadow:0 1px 1px rgba(0,0,0,.45)}' +
    '.gpt.b::after{background:radial-gradient(circle at 34% 30%,#575757,#000)}' +
    '.gpt.w::after{background:radial-gradient(circle at 34% 30%,#fff,#c8c8c8);' +
    'border:1px solid #8a8a8a}' +
    '.gpt.off{background:#2a2a2a}' +
    '.gpt.last::before{content:"";position:absolute;inset:26%;' +
    'border:2px solid #ff4136;border-radius:50%;z-index:2}' +
    '.gpt.prev::before{content:"";position:absolute;inset:30%;' +
    'border:2px solid rgba(255,65,54,.4);border-radius:50%;z-index:2}' +
    '</style>';
  const status =
    '<div class="gstatus">Turn ' + info.turn + ' &middot; B ' + info.black +
    ' / W ' + info.white + ' &middot; ' + info.toMove + ' to move' + safeMsg +
    '</div>';
  return style + status + '<div class="goban">' + cells + '</div>';
}
async function pushBoard(ns, turnNum, msg) {
  if (typeof win === "undefined" || !win || win.closed) {
    if (win?.closed) {
      win = false;
      syncIPvGoLoader(ns, "ipvgo popout off");
      publishIPvGoUiState();
    }
    goLastSig = "";
    return;
  }
  const rows = await proxy(ns, "go.getBoardState")
  const toMove = ns.go.getCurrentPlayer();
  const sig = rows.join("|") + "#" + toMove + "#" +
    goTrail.map(m => m[0] + "," + m[1]).join(";");
  if (sig === goLastSig) return;
  goLastSig = sig;
  const gs = ns.go.getGameState();
  win.setHTML("#go", renderGoBoard(rows, {
    turn: turnNum,
    black: gs.blackScore,
    white: gs.whiteScore,
    toMove,
    msg,
  }));
}
function enemyCaptureMasks(board, children, playerIsBlack, output) {
  output.final = 0;
  output.any = 0;
  if (!board) return output;

  const linearBoard = linearizeBoard(board);
  const scratch = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, scratch.sourceBits);
  const enemyBits = playerIsBlack ? bits[1] : bits[0];
  if (!enemyBits) return output;

  for (const child of children) {
    if (child.pos < 0 || child.visits <= 0) continue;
    const pos = child.pos;
    if (!addMoveBitboard5(
      linearBoard,
      scratch.board,
      (pos / BOARD_SIZE) | 0,
      pos % BOARD_SIZE,
      playerIsBlack,
      bits[0],
      bits[1],
      bits[2],
      scratch.liberties,
      scratch.nextBits
    )) {
      continue;
    }
    const remainingEnemy = playerIsBlack
      ? scratch.nextBits[1]
      : scratch.nextBits[0];
    if (remainingEnemy !== enemyBits) output.any |= 1 << pos;
    if (!remainingEnemy) output.final |= 1 << pos;
  }
  return output;
}

function stableAtariCleanupMask(board, children, playerIsBlack) {
  if (!board) return 0;
  const linearBoard = linearizeBoard(board);
  const scratch = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, scratch.sourceBits);
  const enemyBefore = playerIsBlack ? bits[1] : bits[0];
  let cleanupMask = 0;

  for (const child of children) {
    if (child.pos < 0 || child.visits <= 0) continue;
    if (!addMoveBitboard5(
      linearBoard,
      scratch.board,
      (child.pos / BOARD_SIZE) | 0,
      child.pos % BOARD_SIZE,
      playerIsBlack,
      bits[0],
      bits[1],
      bits[2],
      null,
      scratch.nextBits
    )) {
      continue;
    }

    const enemyAfter = playerIsBlack
      ? scratch.nextBits[1]
      : scratch.nextBits[0];
    if (enemyAfter !== enemyBefore) continue;

    const ownAfter = playerIsBlack
      ? scratch.nextBits[0]
      : scratch.nextBits[1];
    const emptyAfter = BITBOARD_FULL_5 &
      ~(scratch.nextBits[0] | scratch.nextBits[1] | bits[2]);
    const playedBit = 1 << child.pos;
    const playedGroup = groupBits5(ownAfter, playedBit);
    let ownLiberties = neighborBits5(playedGroup) & emptyAfter;
    let sealedEyes = 0;
    while (ownLiberties) {
      const liberty = ownLiberties & -ownLiberties;
      ownLiberties ^= liberty;
      const position = 31 - Math.clz32(liberty);
      if (!isLegalMoveBits5(
        position,
        !playerIsBlack,
        scratch.nextBits[0],
        scratch.nextBits[1],
        bits[2]
      )) {
        sealedEyes++;
        if (sealedEyes >= 2) break;
      }
    }
    if (sealedEyes < 2) continue;

    let remainingEnemy = enemyAfter;
    while (remainingEnemy) {
      const first = remainingEnemy & -remainingEnemy;
      const group = groupBits5(enemyAfter, first);
      remainingEnemy &= ~group;
      if (!(neighborBits5(group) & playedBit)) continue;
      const liberties = neighborBits5(group) & emptyAfter;
      if (!liberties || (liberties & (liberties - 1))) continue;
      const libertyPosition = 31 - Math.clz32(liberties);
      if (!isLegalMoveBits5(
        libertyPosition,
        !playerIsBlack,
        scratch.nextBits[0],
        scratch.nextBits[1],
        bits[2]
      )) {
        cleanupMask |= playedBit;
        break;
      }
    }
  }
  return cleanupMask;
}

function getAdjacentCleanupScratch() {
  return ADJACENT_CLEANUP_SCRATCH ??= {
    boardAfterAttack: new Int8Array(25),
    boardAfterReply: new Int8Array(25),
    boardAfterCapture: new Int8Array(25),
    bitsAfterAttack: new Int32Array(3),
    bitsAfterReply: new Int32Array(3),
    bitsAfterCapture: new Int32Array(3),
  };
}

function adjacentLibertyCleanupMask(board, children, playerIsBlack) {
  if (!board) return 0;
  const linearBoard = linearizeBoard(board);
  const expansion = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, expansion.sourceBits);
  const enemyBefore = playerIsBlack ? bits[1] : bits[0];
  const scratch = getAdjacentCleanupScratch();
  let cleanupMask = 0;

  for (const child of children) {
    if (child.pos < 0 || child.visits <= 0) continue;
    const playedBit = 1 << child.pos;
    let remainingEnemy = enemyBefore;
    while (remainingEnemy) {
      const first = remainingEnemy & -remainingEnemy;
      const target = groupBits5(enemyBefore, first);
      remainingEnemy &= ~target;
      const liberties = neighborBits5(target) &
        (BITBOARD_FULL_5 & ~(bits[0] | bits[1] | bits[2]));
      if (popcount32(liberties) !== 2 ||
        !(liberties & playedBit)) {
        continue;
      }
      const otherLiberty = liberties & ~playedBit;
      if (!(neighborBits5(playedBit) & otherLiberty)) continue;
      const otherPosition = 31 - Math.clz32(otherLiberty);

      if (!addMoveBitboard5(
        linearBoard,
        scratch.boardAfterAttack,
        (child.pos / BOARD_SIZE) | 0,
        child.pos % BOARD_SIZE,
        playerIsBlack,
        bits[0],
        bits[1],
        bits[2],
        null,
        scratch.bitsAfterAttack
      )) {
        continue;
      }
      const enemyAfterAttack = playerIsBlack
        ? scratch.bitsAfterAttack[1]
        : scratch.bitsAfterAttack[0];
      if ((enemyAfterAttack & target) !== target) continue;

      // If the opponent ignores the sacrifice, the other liberty must
      // immediately capture the original group.
      if (!addMoveBitboard5(
        scratch.boardAfterAttack,
        scratch.boardAfterCapture,
        (otherPosition / BOARD_SIZE) | 0,
        otherPosition % BOARD_SIZE,
        playerIsBlack,
        scratch.bitsAfterAttack[0],
        scratch.bitsAfterAttack[1],
        scratch.bitsAfterAttack[2],
        null,
        scratch.bitsAfterCapture
      )) {
        continue;
      }
      const enemyAfterDirectCapture = playerIsBlack
        ? scratch.bitsAfterCapture[1]
        : scratch.bitsAfterCapture[0];
      if (enemyAfterDirectCapture & target) continue;

      // In a two-point eye the opponent may fill the other liberty and
      // capture our sacrifice. Replaying the first point must then capture
      // the entire original group; otherwise this is an escape corridor.
      if (!addMoveBitboard5(
        scratch.boardAfterAttack,
        scratch.boardAfterReply,
        (otherPosition / BOARD_SIZE) | 0,
        otherPosition % BOARD_SIZE,
        !playerIsBlack,
        scratch.bitsAfterAttack[0],
        scratch.bitsAfterAttack[1],
        scratch.bitsAfterAttack[2],
        null,
        scratch.bitsAfterReply
      )) {
        continue;
      }
      if (!addMoveBitboard5(
        scratch.boardAfterReply,
        scratch.boardAfterCapture,
        (child.pos / BOARD_SIZE) | 0,
        child.pos % BOARD_SIZE,
        playerIsBlack,
        scratch.bitsAfterReply[0],
        scratch.bitsAfterReply[1],
        scratch.bitsAfterReply[2],
        null,
        scratch.bitsAfterCapture
      )) {
        continue;
      }
      const enemyAfterRecapture = playerIsBlack
        ? scratch.bitsAfterCapture[1]
        : scratch.bitsAfterCapture[0];
      if (!(enemyAfterRecapture & target)) {
        cleanupMask |= playedBit;
        break;
      }
    }
  }
  return cleanupMask;
}

function rootMoveSafetyMasks(
  board,
  children,
  playerIsBlack,
  output = ROOT_MOVE_SAFETY_SCRATCH
) {
  output.nonCapturingGroupAtari = 0;
  output.anyAtari = 0;
  if (!board) return output;
  const linearBoard = linearizeBoard(board);
  const scratch = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, scratch.sourceBits);
  const enemyBits = playerIsBlack ? bits[1] : bits[0];
  for (const child of children) {
    if (child.pos < 0) continue;
    if (!addMoveBitboard5(
      linearBoard,
      scratch.board,
      (child.pos / BOARD_SIZE) | 0,
      child.pos % BOARD_SIZE,
      playerIsBlack,
      bits[0],
      bits[1],
      bits[2],
      scratch.liberties,
      scratch.nextBits
    )) {
      continue;
    }
    const enemyAfter = playerIsBlack
      ? scratch.nextBits[1]
      : scratch.nextBits[0];
    const ownAfter = playerIsBlack
      ? scratch.nextBits[0]
      : scratch.nextBits[1];
    if (scratch.liberties[child.pos] === 1) {
      output.anyAtari |= 1 << child.pos;
    }
    // Lone-stone throw-ins are legitimate bait; only flag moves that put a
    // group of two or more of our stones into atari without capturing.
    if ((enemyBits & ~enemyAfter) === 0 &&
      scratch.liberties[child.pos] === 1 &&
      popcount32(groupBits5(ownAfter, 1 << child.pos)) >= 2) {
      output.nonCapturingGroupAtari |= 1 << child.pos;
    }
  }
  return output;
}

function rootMoveTacticalMasks(
  board,
  children,
  playerIsBlack,
  output = ROOT_MOVE_TACTICAL_SCRATCH
) {
  output.connection = 0;
  output.rescue = 0;
  output.safetyImprovement = 0;
  if (!board) return output;

  const linearBoard = linearizeBoard(board);
  const scratch = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, scratch.sourceBits);
  const ownBefore = playerIsBlack ? bits[0] : bits[1];
  const emptyBefore = BITBOARD_FULL_5 &
    ~(bits[0] | bits[1] | bits[2]);

  for (const child of children) {
    if (child.pos < 0 || child.visits <= 0) continue;
    const playedBit = 1 << child.pos;
    let adjacent = neighborBits5(playedBit) & ownBefore;
    let adjacentGroups = 0;
    let maximumOldLiberties = 0;
    let rescuesAtari = false;
    while (adjacent) {
      const first = adjacent & -adjacent;
      const group = groupBits5(ownBefore, first);
      adjacent &= ~group;
      adjacentGroups++;
      const liberties = popcount32(neighborBits5(group) & emptyBefore);
      maximumOldLiberties = Math.max(maximumOldLiberties, liberties);
      if (liberties === 1) rescuesAtari = true;
    }

    if (!addMoveBitboard5(
      linearBoard,
      scratch.board,
      (child.pos / BOARD_SIZE) | 0,
      child.pos % BOARD_SIZE,
      playerIsBlack,
      bits[0],
      bits[1],
      bits[2],
      null,
      scratch.nextBits
    )) {
      continue;
    }
    const ownAfter = playerIsBlack
      ? scratch.nextBits[0]
      : scratch.nextBits[1];
    const emptyAfter = BITBOARD_FULL_5 &
      ~(scratch.nextBits[0] | scratch.nextBits[1] | bits[2]);
    const playedGroup = groupBits5(ownAfter, playedBit);
    const newLiberties = popcount32(
      neighborBits5(playedGroup) & emptyAfter
    );

    if (adjacentGroups >= 2) output.connection |= playedBit;
    if (rescuesAtari && newLiberties >= 2) output.rescue |= playedBit;
    if (adjacentGroups > 0 &&
      maximumOldLiberties <= 2 &&
      newLiberties > maximumOldLiberties) {
      output.safetyImprovement |= playedBit;
    }
  }
  return output;
}

function rootConfidenceBound(child, playerIsBlack) {
  const visits = Math.max(1, child.visits);
  const variance = Math.max(0, child.variance ?? 0);
  const priorVisits = 10;
  const priorVariance = 0.75 * BOARD_SIZE * BOARD_SIZE;
  const adjustedVariance =
    (variance * visits + priorVariance * priorVisits) /
    (visits + priorVisits);
  const error = ROOT_CONFIDENCE_Z * Math.sqrt(adjustedVariance / visits);
  return playerIsBlack ? child.value - error : child.value + error;
}

function rootSourceReplySafety5(
  board,
  playerMove,
  playerIsBlack,
  opponent,
  historyHashes
) {
  if (!board || opponent === "No AI") {
    return { known: false, safe: null, passPossible: false, outcomes: [] };
  }

  const source = linearizeBoard(board);
  const sourceBits = boardToBitboards5(source, new Int32Array(3));
  const afterMove = new Int8Array(25);
  const afterMoveBits = new Int32Array(3);
  const enemyBefore = playerIsBlack ? sourceBits[1] : sourceBits[0];
  if (playerMove < 0) {
    afterMove.set(source);
    afterMoveBits.set(sourceBits);
  } else if (!addMoveBitboard5(
    source,
    afterMove,
    (playerMove / 5) | 0,
    playerMove % 5,
    playerIsBlack,
    sourceBits[0],
    sourceBits[1],
    sourceBits[2],
    null,
    afterMoveBits
  )) {
    return { known: false, safe: false, passPossible: false, outcomes: [] };
  }

  const playerAfterMove = playerIsBlack
    ? afterMoveBits[0]
    : afterMoveBits[1];
  const enemyAfterMove = playerIsBlack
    ? afterMoveBits[1]
    : afterMoveBits[0];
  const capturedByPlayer =
    popcount32(enemyBefore) - popcount32(enemyAfterMove);
  const afterMoveHash = positionKeyBits5(
    afterMoveBits[0],
    afterMoveBits[1]
  );
  const history = new Set(historyHashes ?? []);
  history.add(positionKeyBits5(sourceBits[0], sourceBits[1]));
  history.add(afterMoveHash);

  const aiIsBlack = !playerIsBlack;
  const responsePositions = [];
  let responseLegalMask = 0;
  const responseBoard = new Int8Array(25);
  const responseBits = new Int32Array(3);
  for (let response = 0; response < 25; response++) {
    if (!addMoveBitboard5(
      afterMove,
      responseBoard,
      (response / 5) | 0,
      response % 5,
      aiIsBlack,
      afterMoveBits[0],
      afterMoveBits[1],
      afterMoveBits[2],
      null,
      responseBits
    )) {
      continue;
    }
    const responseHash = positionKeyBits5(responseBits[0], responseBits[1]);
    if (history.has(responseHash)) continue;
    responsePositions.push(response);
    responseLegalMask |= 1 << response;
  }

  const policy = resolveSourcePolicy5(
    afterMove,
    responsePositions,
    aiIsBlack ? 1 : 2,
    opponent,
    playerMove < 0
  );
  if (!policy) {
    return { known: false, safe: null, passPossible: false, outcomes: [] };
  }

  const outcomes = [];
  let worstNetLoss = -Infinity;
  let worstResponse = null;
  let reachableMask = policy.positionMask & responseLegalMask;
  while (reachableMask) {
    const responseBit = reachableMask & -reachableMask;
    reachableMask ^= responseBit;
    const response = 31 - Math.clz32(responseBit);
    addMoveBitboard5(
      afterMove,
      responseBoard,
      (response / 5) | 0,
      response % 5,
      aiIsBlack,
      afterMoveBits[0],
      afterMoveBits[1],
      afterMoveBits[2],
      null,
      responseBits
    );

    const playerAfterReply = playerIsBlack
      ? responseBits[0]
      : responseBits[1];
    const enemyAfterReply = playerIsBlack
      ? responseBits[1]
      : responseBits[0];
    const capturedPlayer =
      popcount32(playerAfterMove) - popcount32(playerAfterReply);
    let bestImmediateRecapture = 0;
    if (capturedPlayer > capturedByPlayer) {
      const responseHash = positionKeyBits5(
        responseBits[0],
        responseBits[1]
      );
      const recaptureHistory = new Set(history);
      recaptureHistory.add(responseHash);
      const recaptureBoard = new Int8Array(25);
      const recaptureBits = new Int32Array(3);
      for (let recapture = 0; recapture < 25; recapture++) {
        if (!addMoveBitboard5(
          responseBoard,
          recaptureBoard,
          (recapture / 5) | 0,
          recapture % 5,
          playerIsBlack,
          responseBits[0],
          responseBits[1],
          responseBits[2],
          null,
          recaptureBits
        )) {
          continue;
        }
        const recaptureHash = positionKeyBits5(
          recaptureBits[0],
          recaptureBits[1]
        );
        if (recaptureHistory.has(recaptureHash)) continue;
        const enemyAfterRecapture = playerIsBlack
          ? recaptureBits[1]
          : recaptureBits[0];
        bestImmediateRecapture = Math.max(
          bestImmediateRecapture,
          popcount32(enemyAfterReply) - popcount32(enemyAfterRecapture)
        );
      }
    }
    const netLoss =
      capturedPlayer - capturedByPlayer - bestImmediateRecapture;
    outcomes.push({
      pos: response,
      capturedPlayer,
      capturedByPlayer,
      bestImmediateRecapture,
      netLoss,
    });
    if (netLoss > worstNetLoss) {
      worstNetLoss = netLoss;
      worstResponse = response;
    }
  }

  if (policy.passPossible) {
    const netLoss = -capturedByPlayer;
    outcomes.push({
      pos: -1,
      capturedPlayer: 0,
      capturedByPlayer,
      bestImmediateRecapture: 0,
      netLoss,
    });
    if (netLoss > worstNetLoss) {
      worstNetLoss = netLoss;
      worstResponse = -1;
    }
  }

  return {
    known: true,
    safe: worstNetLoss < ROOT_REPLY_COLLAPSE_MIN_STONES,
    passPossible: policy.passPossible === true,
    worstNetLoss,
    worstResponse,
    outcomes,
  };
}


function mergeWorkerResults(
  results,
  board = null,
  playerIsBlack = isBlack,
  lastPassed = false,
  opponent = "No AI",
  historyHashes = []
) {
  const byPos = new Map();

  for (const result of results) {
    const children = result[2] ?? [];

    for (const c of children) {
      const value = Number.isFinite(c.value) ? c.value : 0;
      let merged = byPos.get(c.pos);

      if (!merged) {
        merged = {
          pos: c.pos,
          visits: 0,
          weight: c.weight,
          value: value,
          valueNumerator: 0,
          secondMomentNumerator: 0,
          riskSourceWeight: 0,
          riskCoveredWeight: 0,
          riskLosingWeight: 0,
          riskResponseVisits: 0,
          terminalRiskTotalWeight: 0,
          terminalRiskCoveredWeight: 0,
          terminalFailureWeight: 0,
          laneSummaries: new Map(),
        };
        byPos.set(c.pos, merged);
      }

      merged.weight = Math.max(merged.weight ?? c.weight, c.weight);
      if (c.laneSummary?.partitioned) {
        merged.laneSummaries.set(
          c.laneSummary.laneIndex,
          c.laneSummary
        );
      }
      if (!c.laneSummary &&
        (c.riskResponseVisits ?? 0) > merged.riskResponseVisits) {
        merged.riskSourceWeight = c.riskSourceWeight ?? 0;
        merged.riskCoveredWeight = c.riskCoveredWeight ?? 0;
        merged.riskLosingWeight = c.riskLosingWeight ?? 0;
        merged.riskResponseVisits = c.riskResponseVisits ?? 0;
        merged.terminalRiskTotalWeight =
          c.terminalRiskTotalWeight ?? 0;
        merged.terminalRiskCoveredWeight =
          c.terminalRiskCoveredWeight ?? 0;
        merged.terminalFailureWeight =
          c.terminalFailureWeight ?? 0;
      }
      if (c.visits > 0) {
        merged.visits += c.visits;
        merged.valueNumerator += value * c.visits;
        if (CONFIDENCE_BEFORE_VALUE) {
          const variance = Math.max(0, c.variance ?? 0);
          merged.secondMomentNumerator +=
            (variance + value * value) * c.visits;
        }
        merged.value = merged.valueNumerator / merged.visits;
        merged.variance = CONFIDENCE_BEFORE_VALUE
          ? Math.max(
            0,
            merged.secondMomentNumerator / merged.visits -
            merged.value * merged.value
          )
          : 0;
      } else if (merged.visits === 0) {
        merged.value = playerIsBlack
          ? Math.max(merged.value, value)
          : Math.min(merged.value, value);
      }
    }
  }

  for (const merged of byPos.values()) {
    const lanes = [...merged.laneSummaries.values()];
    const laneCount = lanes[0]?.laneCount ?? 0;
    if (!laneCount || lanes.length !== laneCount) continue;
    const sourceWeight = lanes.reduce(
      (sum, lane) => sum + lane.sourceWeight,
      0
    );
    const sourceTotal = lanes[0].sourceTotal;
    if (!(sourceWeight > 0) ||
      Math.abs(sourceWeight - sourceTotal) > 1e-9) {
      continue;
    }
    merged.value = lanes.reduce(
      (sum, lane) => sum + lane.sourceWeight * lane.value,
      0
    ) / sourceWeight;
    const secondMoment = lanes.reduce(
      (sum, lane) =>
        sum + lane.sourceWeight * lane.secondMoment,
      0
    ) / sourceWeight;
    merged.variance = Math.max(
      0,
      secondMoment - merged.value * merged.value
    );
    merged.visits = lanes.reduce(
      (sum, lane) => sum + lane.visits,
      0
    );
    merged.riskSourceWeight = sourceWeight;
    merged.riskCoveredWeight = lanes.reduce(
      (sum, lane) => sum + (lane.riskCoveredWeight ?? 0),
      0
    );
    merged.riskLosingWeight = lanes.reduce(
      (sum, lane) => sum + (lane.riskLosingWeight ?? 0),
      0
    );
    merged.terminalRiskTotalWeight =
      lanes[0].terminalRiskTotalWeight ?? 0;
    merged.terminalRiskCoveredWeight = lanes.reduce(
      (sum, lane) => sum + (lane.terminalRiskCoveredWeight ?? 0),
      0
    );
    merged.terminalFailureWeight = lanes.reduce(
      (sum, lane) => sum + (lane.terminalFailureWeight ?? 0),
      0
    );
    merged.riskResponseVisits = merged.visits;
    merged.lanePartitioned = true;
  }

  const passValue = byPos.get(-1)?.value;
  const territory = board && passValue != null
    ? getTerritory(linearizeBoard(board))
    : null;
  const playerColor = playerIsBlack ? 1 : 2;
  const moveBeatsPass = (value) =>
    playerIsBlack ? value > passValue : value < passValue;
  const mergedChildren = [...byPos.values()]
    .map(({
      valueNumerator,
      secondMomentNumerator,
      laneSummaries,
      ...c
    }) => c);
  for (const child of mergedChildren) {
    child.lossProbability =
      child.riskSourceWeight > 0 &&
        child.riskCoveredWeight >= child.riskSourceWeight - 1e-12
        ? child.riskLosingWeight / child.riskSourceWeight
        : null;
    child.terminalFailureProbability =
      child.terminalRiskTotalWeight > 0 &&
        child.terminalRiskCoveredWeight >=
        child.terminalRiskTotalWeight - 1
        ? child.terminalFailureWeight /
        child.terminalRiskTotalWeight
        : null;
  }
  const linearBoard = board ? linearizeBoard(board) : null;
  const boardBits = linearBoard
    ? boardToBitboards5(linearBoard, getTerritoryScratch(25).sourceBits)
    : null;
  const enemyStonesRemain = boardBits
    ? !!(playerIsBlack ? boardBits[1] : boardBits[0])
    : false;
  const emptyOpening = boardBits
    ? !(boardBits[0] | boardBits[1])
    : false;
  const isNonLosing = (value) =>
    playerIsBlack ? value >= 0 : value <= 0;
  const replySafetyByPosition = new Map();
  const replySafety = (child) => {
    if (!child || child.pos == null) return null;
    let analysis = replySafetyByPosition.get(child.pos);
    if (!analysis) {
      analysis = rootSourceReplySafety5(
        board,
        child.pos,
        playerIsBlack,
        opponent,
        historyHashes
      );
      replySafetyByPosition.set(child.pos, analysis);
    }
    return analysis;
  };
  const passReplySafety = replySafety(byPos.get(-1));
  const terminalRawMargin = boardBits
    ? rawTerminalMarginBits5(boardBits[0], boardBits[1], boardBits[2])
    : 0;
  const terminalMargin =
    terminalRawMargin - (KOMI_BY_OPPONENT[opponent] ?? 5.5);
  const terminalPlayerMargin =
    playerIsBlack ? terminalMargin : -terminalMargin;
  const terminalPassPossible =
    lastPassed || passReplySafety?.passPossible === true;
  const terminalPassIsLosing =
    terminalPassPossible && terminalPlayerMargin < 0;
  const averagePassIsLosing = passValue != null &&
    (playerIsBlack ? passValue < 0 : passValue > 0);
  // A source-reachable opponent pass ends the game immediately. Its exact
  // terminal result cannot be averaged away by branches that continue play.
  const passIsLosing = averagePassIsLosing || terminalPassIsLosing;
  const moveSafety = rootMoveSafetyMasks(
    board,
    mergedChildren,
    playerIsBlack
  );
  const selfAtariMask = moveSafety.nonCapturingGroupAtari;
  const unsafePassAlternativeMask = moveSafety.anyAtari;
  const isSelfAtari = (child) =>
    child.pos >= 0 && !!(selfAtariMask & (1 << child.pos));
  const sourceReplySafeContinuations = mergedChildren.filter((child) =>
    child.pos >= 0 &&
    child.visits > 0 &&
    replySafety(child)?.safe === true
  );
  const hasSourceReplySafeContinuation =
    sourceReplySafeContinuations.length > 0;
  const safeExternalContinuations = mergedChildren.filter((child) =>
    child.pos >= 0 &&
    child.visits > 0 &&
    !(unsafePassAlternativeMask & (1 << child.pos)) &&
    replySafety(child)?.safe !== false &&
    (!territory || territory[child.pos] === 0)
  );
  const hasSafeExternalContinuation =
    safeExternalContinuations.length > 0;
  const hasSafeNonLosingExternalContinuation =
    safeExternalContinuations.some((child) => isNonLosing(child.value));
  // A losing pass still forfeits immediately, so any locally safe external
  // move keeps the game alive. A non-losing pass is vetoed only when an
  // external continuation is itself non-losing.
  const externalContinuationVetoesPass =
    hasSafeExternalContinuation &&
    (passIsLosing || hasSafeNonLosingExternalContinuation);
  const hasAnyPlayableContinuation = mergedChildren.some((child) =>
    child.pos >= 0 && child.visits > 0 && !isSelfAtari(child)
  );
  const hasAnyLegalContinuation = mergedChildren.some((child) =>
    child.pos >= 0 && child.visits > 0
  );
  const hasBetterPlayableContinuation =
    enemyStonesRemain &&
    passValue != null &&
    mergedChildren.some((child) =>
      child.pos >= 0 &&
      child.visits > 0 &&
      !isSelfAtari(child) &&
      moveBeatsPass(child.value)
    );
  const openingPassSuppressed =
    emptyOpening && hasAnyPlayableContinuation;
  const captureMasks = enemyCaptureMasks(
    board,
    mergedChildren,
    playerIsBlack,
    ENEMY_CAPTURE_MASKS_SCRATCH
  );
  const finalCaptures = captureMasks.final;
  const stableCleanupMask = stableAtariCleanupMask(
    board,
    mergedChildren,
    playerIsBlack
  );
  const adjacentCleanupMask = adjacentLibertyCleanupMask(
    board,
    mergedChildren,
    playerIsBlack
  );
  const atariCleanupMask = stableCleanupMask | adjacentCleanupMask;
  const tacticalMasks = rootMoveTacticalMasks(
    board,
    mergedChildren,
    playerIsBlack
  );
  const ownTerritoryTacticalMask =
    captureMasks.any |
    atariCleanupMask |
    tacticalMasks.connection |
    tacticalMasks.rescue |
    tacticalMasks.safetyImprovement;
  const isOwnTerritory = (child) =>
    child.pos >= 0 &&
    territory &&
    territory[child.pos] === playerColor;
  const isOwnTerritoryTacticalMove = (child) =>
    child.pos >= 0 &&
    !!(ownTerritoryTacticalMask & (1 << child.pos));
  // Points that fill one of our own real eyes with no capture and no tactical
  // purpose. Filling these only endangers a living group; never play one as a
  // normal move, and when only these remain, pass instead.
  const selfEyeFillMask = boardBits
    ? ownRealEyeFillMask5(
      boardBits[0],
      boardBits[1],
      boardBits[2],
      playerIsBlack
    )
    : 0;
  const isSelfEyeFill = (child) =>
    child.pos >= 0 &&
    !!(selfEyeFillMask & (1 << child.pos)) &&
    !isOwnTerritoryTacticalMove(child);
  const isMeaningfulContinuation = (child) =>
    !isOwnTerritory(child) ||
    isOwnTerritoryTacticalMove(child) ||
    moveBeatsPass(child.value);
  // A quiet internal fill cannot keep pass suppressed merely because some
  // other move is non-losing. Only external, tactical, or pass-beating moves
  // count as meaningful cleanup continuations.
  const hasNonLosingContinuation = enemyStonesRemain &&
    mergedChildren.some((child) =>
      child.pos >= 0 &&
      child.visits > 0 &&
      isNonLosing(child.value) &&
      replySafety(child)?.safe !== false &&
      isMeaningfulContinuation(child)
    );
  const captureAvailable = captureMasks.any !== 0 &&
    mergedChildren.some((child) =>
      child.pos >= 0 &&
      child.visits > 0 &&
      (captureMasks.any & (1 << child.pos))
    );
  // A value estimate from a handful of visits is noise; never let it outrank
  // a well-sampled move on value alone.
  const maxRootVisits = mergedChildren.reduce(
    (maximum, child) => Math.max(maximum, child.visits),
    0
  );
  const rootVisitFloor = Math.min(
    maxRootVisits,
    Math.max(32, maxRootVisits * 0.01)
  );
  const hasAdequateVisits = (child) =>
    child.pos === -1 || child.visits >= rootVisitFloor;
  // A capture is cleanup only when search says the resulting line remains
  // non-losing. Once that is established with enough visits, double-pass
  // cannot take precedence merely because it wins by a larger current score.
  const hasSafeImmediateCapture = captureAvailable &&
    mergedChildren.some((child) =>
      child.pos >= 0 &&
      !!(captureMasks.any & (1 << child.pos)) &&
      hasAdequateVisits(child) &&
      isNonLosing(child.value)
    );
  const hasSafeForcedAtariCleanup = atariCleanupMask !== 0 &&
    mergedChildren.some((child) =>
      child.pos >= 0 &&
      !!(atariCleanupMask & (1 << child.pos)) &&
      hasAdequateVisits(child) &&
      isNonLosing(child.value)
    );
  let eligibleChildren = mergedChildren.filter((child) => {
    if (child.pos === -1) {
      if (hasSafeImmediateCapture || hasSafeForcedAtariCleanup) return false;
      return !openingPassSuppressed &&
        !(terminalPassIsLosing && hasAnyLegalContinuation) &&
        !externalContinuationVetoesPass &&
        !hasNonLosingContinuation &&
        !(passIsLosing && hasBetterPlayableContinuation);
    }
    // Never fill one of our own real eyes as a plain move — it only endangers a
    // living group. Captures/connections/rescues in our territory stay allowed
    // (isSelfEyeFill already excludes tactical moves).
    if (isSelfEyeFill(child)) return false;
    if (replySafety(child)?.safe === false &&
      hasSourceReplySafeContinuation) {
      return false;
    }
    // An unsafe (atari) alternative is dropped in favor of a safe external
    // continuation only when it is a NON-CAPTURE and itself LOSING. A capture
    // (throw-in/recapture) or any non-losing move that happens to leave our
    // stone in atari can still be the correct — even winning — move. Dropping
    // it here strands us: the "safe external continuations" it defers to may
    // themselves be losing and get filtered below, leaving nothing eligible
    // and falling through to a pass with a winning move on the board.
    if (hasSafeExternalContinuation &&
      (unsafePassAlternativeMask & (1 << child.pos)) &&
      !(captureMasks.any & (1 << child.pos)) &&
      !isNonLosing(child.value)) {
      return false;
    }
    if (passIsLosing && !hasNonLosingContinuation && isSelfAtari(child)) {
      return false;
    }
    if (hasNonLosingContinuation && !isNonLosing(child.value)) {
      return false;
    }
    if (!isOwnTerritory(child)) return true;
    if (isOwnTerritoryTacticalMove(child)) return true;
    const childReplySafety = replySafety(child);
    if (childReplySafety?.safe === false ||
      ((unsafePassAlternativeMask & (1 << child.pos)) &&
        !(childReplySafety?.known === true &&
          childReplySafety.worstNetLoss <= 0))) {
      return false;
    }
    if (moveBeatsPass(child.value)) return true;
    if (hasSafeNonLosingExternalContinuation) return false;
    return false;
  });
  if (terminalPassIsLosing &&
    !eligibleChildren.some(child => child.pos >= 0)) {
    const legalMoves = mergedChildren.filter(child =>
      child.pos >= 0 && child.visits > 0 && !isSelfEyeFill(child)
    );
    const externalMoves = legalMoves.filter(child => !isOwnTerritory(child));
    const forced = externalMoves.length ? externalMoves : legalMoves;
    // Every legal move only fills our own eyes: passing forfeits a smaller
    // margin than self-capturing, so restore the pass rather than self-destruct.
    const passChild = byPos.get(-1);
    eligibleChildren = forced.length
      ? forced
      : passChild
        ? [passChild]
        : eligibleChildren;
  }
  if (!eligibleChildren.length) {
    const legalMoves = mergedChildren.filter(child =>
      child.pos >= 0 && child.visits > 0 && !isSelfEyeFill(child)
    );
    const replySafeMoves = legalMoves.filter(child =>
      replySafety(child)?.safe === true
    );
    const fallbackPool = replySafeMoves.length ? replySafeMoves : legalMoves;
    const externalMoves = fallbackPool.filter(child => !isOwnTerritory(child));
    if (fallbackPool.length) {
      eligibleChildren = externalMoves.length ? externalMoves : fallbackPool;
    } else {
      // Only self-eye fills remain: pass rather than kill our own group. Use a
      // raw legal move only if there is no pass child at all.
      const passChild = byPos.get(-1);
      eligibleChildren = passChild
        ? [passChild]
        : mergedChildren.filter(child => child.pos >= 0 && child.visits > 0);
    }
  }
  const isFinalCapture = (child) =>
    child.pos >= 0 && !!(finalCaptures & (1 << child.pos));
  const valueOrderedChildren = eligibleChildren.sort((a, b) => {
    const adequacyOrder = +hasAdequateVisits(b) - +hasAdequateVisits(a);
    if (adequacyOrder) return adequacyOrder;
    const finalCaptureOrder =
      +isFinalCapture(b) - +isFinalCapture(a);
    if (finalCaptureOrder) return finalCaptureOrder;
    const valueOrder =
      playerIsBlack ? b.value - a.value : a.value - b.value;
    if (CONFIDENCE_BEFORE_VALUE) {
      const confidenceOrder = playerIsBlack
        ? rootConfidenceBound(b, true) - rootConfidenceBound(a, true)
        : rootConfidenceBound(a, false) - rootConfidenceBound(b, false);
      if (Math.abs(confidenceOrder) > NEAR_EQUAL_VALUE_EPSILON) {
        return confidenceOrder;
      }
    }
    return valueOrder || b.visits - a.visits;
  });
  const children = valueOrderedChildren;

  const q = children[0]?.value ?? 0;
  const s = results.length ? Math.max(...results.map(r => r[1] ?? 0)) : 0;

  return [q, s, children];
}
function resizeWorkerPool(workers, desired, owner, createWorker) {
  desired = Math.max(1, Math.floor(desired) || 1);
  while (workers.length < desired) workers.push(createWorker());
  if (workers.length > desired && owner != null && owner >= desired) {
    const retainedIndex = desired - 1;
    const retainedWorker = workers[retainedIndex];
    workers[retainedIndex] = workers[owner];
    workers[owner] = retainedWorker;
    owner = retainedIndex;
  }
  while (workers.length > desired) {
    const worker = workers.pop();
    worker?.terminate?.();
  }
  return owner;
}

function getRootWorkPlan(
  workerCount,
  board,
  playoutsPerWorker,
  seenHashes = [],
  playerIsBlack = isBlack
) {
  const tasks = Array.from({ length: workerCount }, () => []);
  const ownerByPosition = new Int16Array(board.length * board.length);
  ownerByPosition.fill(-1);
  const actions = [-1];
  const linearBoard = linearizeBoard(board);
  const scratch = getNodeExpansionScratch(linearBoard.length);
  const bits = boardToBitboards5(linearBoard, scratch.sourceBits);
  const history = new ExactHistorySet5(seenHashes);
  for (let pos = 0; pos < board.length * board.length; ++pos) {
    if (board[(pos / board.length) | 0][pos % board.length] !== ".") continue;
    if (!addMoveBitboard5(
      linearBoard,
      scratch.board,
      (pos / board.length) | 0,
      pos % board.length,
      playerIsBlack,
      bits[0],
      bits[1],
      bits[2],
      null,
      scratch.nextBits
    )) {
      continue;
    }
    const nextHash = positionKeyBits5(
      scratch.nextBits[0],
      scratch.nextBits[1]
    );
    if (!history.has(nextHash)) actions.push(pos);
  }

  const activeWorkerCount = workerCount;
  const scheduledWorkers = Array.from(
    { length: activeWorkerCount },
    (_, worker) => worker
  );
  const ownedActions = Array.from(
    { length: activeWorkerCount },
    () => []
  );
  const ownerBySlot = new Int16Array(26);
  ownerBySlot.fill(-1);
  ownerBySlot[0] = 0;
  ownedActions[0].push(-1);
  for (let index = 1; index < actions.length; index++) {
    const worker = index % activeWorkerCount;
    const pos = actions[index];
    ownerBySlot[pos + 1] = worker;
    ownerByPosition[pos] = worker;
    ownedActions[worker].push(pos);
  }

  const workerBudget = Math.max(0, playoutsPerWorker | 0);
  const totalBudget = activeWorkerCount * workerBudget;
  const targetBySlot = new Int32Array(26);
  const baseTarget = Math.floor(totalBudget / actions.length);
  let targetRemainder = totalBudget - baseTarget * actions.length;
  for (const pos of actions) {
    targetBySlot[pos + 1] =
      baseTarget + (targetRemainder-- > 0 ? 1 : 0);
  }
  const remainingBySlot = targetBySlot.slice();
  const remainingByWorker = new Int32Array(workerCount);
  remainingByWorker.fill(0);
  for (const worker of scheduledWorkers) {
    remainingByWorker[worker] = workerBudget;
  }

  const addTask = (worker, pos, quota, canonical) => {
    if (!(quota > 0)) return;
    const existing = tasks[worker].find(task => task.pos === pos);
    if (existing) {
      existing.quota += quota;
      existing.canonical ||= canonical;
      return;
    }
    tasks[worker].push({
      pos,
      quota,
      canonical,
      laneIndex: 0,
      laneCount: 1,
    });
  };

  // Give every canonical owner an equal slice for each action it owns.
  // Underloaded workers stop at the global per-action target, leaving their
  // remaining capacity available to assist overloaded owners.
  for (const worker of scheduledWorkers) {
    const owned = ownedActions[worker];
    if (!owned.length) continue;
    const assistReserve = SATURATED_PLAYOUT_REBALANCE_ENABLED &&
      actions.length > owned.length &&
      owned.length === 1
      ? Math.min(
        workerBudget - 1,
        SATURATED_PLAYOUT_ASSIST_RESERVE_MAX,
        Math.ceil(workerBudget * SATURATED_PLAYOUT_ASSIST_RESERVE_FRACTION)
      )
      : 0;
    const canonicalBudget = workerBudget - Math.max(0, assistReserve);
    const perAction = Math.floor(canonicalBudget / owned.length);
    let extra = canonicalBudget - perAction * owned.length;
    for (const pos of owned) {
      const slot = pos + 1;
      const quota = Math.min(
        remainingBySlot[slot],
        perAction + (extra-- > 0 ? 1 : 0)
      );
      addTask(worker, pos, quota, true);
      remainingBySlot[slot] -= quota;
      remainingByWorker[worker] -= quota;
    }
  }

  // Fill spare worker capacity from the largest action deficits. A helper
  // never assists an action it already owns unless no other deficit exists.
  for (const worker of scheduledWorkers) {
    while (remainingByWorker[worker] > 0) {
      let selectedPos = null;
      let selectedDeficit = 0;
      for (const pos of actions) {
        const deficit = remainingBySlot[pos + 1];
        if (deficit <= selectedDeficit ||
          ownerBySlot[pos + 1] === worker ||
          tasks[worker].some(task => task.pos === pos)) {
          continue;
        }
        selectedPos = pos;
        selectedDeficit = deficit;
      }
      if (selectedPos == null) {
        for (const pos of actions) {
          const deficit = remainingBySlot[pos + 1];
          if (deficit > selectedDeficit) {
            selectedPos = pos;
            selectedDeficit = deficit;
          }
        }
      }
      if (selectedPos == null || selectedDeficit <= 0) break;
      const quota = Math.min(
        remainingByWorker[worker],
        selectedDeficit
      );
      addTask(worker, selectedPos, quota, false);
      remainingBySlot[selectedPos + 1] -= quota;
      remainingByWorker[worker] -= quota;
    }
  }

  const sharesBySlot = Array.from({ length: 26 }, () => []);
  for (const worker of scheduledWorkers) {
    tasks[worker].sort((a, b) =>
      +b.canonical - +a.canonical || a.pos - b.pos
    );
    for (const task of tasks[worker]) {
      task.worker = worker;
      sharesBySlot[task.pos + 1].push(task);
    }
  }
  for (const shares of sharesBySlot) {
    shares.sort((a, b) =>
      +b.canonical - +a.canonical || a.worker - b.worker
    );
    const laneQuotas = shares.map(task => task.quota);
    for (let laneIndex = 0; laneIndex < shares.length; laneIndex++) {
      shares[laneIndex].laneIndex = laneIndex;
      shares[laneIndex].laneCount = shares.length;
      shares[laneIndex].laneQuotas = laneQuotas;
    }
  }

  return {
    tasks,
    ownerByPosition,
    passOwner: ownerBySlot[0],
    scheduledWorkers,
    totalBudget,
    actionCount: actions.length,
    targetBySlot,
  };
}

// ==== Top-level state (host section) ====
// Live board view pushed to the popout window `win` (created elsewhere).
let goTrail = [];      // last move coords [[x,y],...], newest last, capped at 2
let goLastSig = "";    // last board signature rendered — skips redundant redraws
// ================= SPHYX 19x19 MOVE CASCADE (ported) =================
// Ported from SphyxOS_bins_go.js (author: Sphyxis; contributors: Stoneware,
// gmcew) — the "??????" style cascade, adapted to this solver's framework:
// every board analysis the original pulled from the ns.go.analysis API
// (liberties, chains, controlled/contested empty nodes, valid moves) is
// computed locally from the board via the y19 helpers. No web workers: the
// cascade analyzes the current board and plays directly.
//
// Data grids, all indexed [x][y] like the board rows:
//   sphyxBoard         board rows ('.', 'X', 'O', '#')
//   sphyxTestBoard     board with a 'W' wall ring (pattern matching)
//   sphyxContested     'X'/'O' controlled empty, '?' contested empty,
//                      '.' stone, '#' offline — getControlledEmptyNodes shape
//   sphyxValidMove     true where WE may legally play (suicide + superko)
//   sphyxValidLibMoves chain liberty count at stones, -1 elsewhere
//   sphyxChains        chain id at stones, -1 elsewhere
const SPHYX_ME = "X";
const SPHYX_YOU = "O";
let sphyxBoard = null;
let sphyxTestBoard = null;
let sphyxContested = null;
let sphyxValidMove = null;
let sphyxValidLibMoves = null;
let sphyxChains = null;
let sphyxTurn = 0;
// Opening stones actually PLACED this game (the opening is placement-counted:
// engaged turns defend instead and the opening resumes when safe).
let sphyxOpeningPlaced = 0;
// Corridor bait stones placed by the opening (point indices). Their chains
// are EXEMPT from the engaged pause — being attacked is their entire job.
let sphyxOpeningBaitPlaced = [];
let sphyxValidMovesTurn = -1;
let sphyxValidMovesCache = null;
let sphyxContestedMovesCache = null;
let sphyxHistorySet = new Set();
//X,O = Me, You  x, o = Anything but the other person or a blocking, "W" space is off the board, ? is anything goes
//B is blocking(Wall or you, not empty or enemy), b is blocking but could be enemy, A is All but . (Wall, Me, You, Blank)
//* is move here next if you can - no safeties
const def5 = [
  ["?WW??", "WW.X?", "W.XX?", "WWW??", "?????"], //Pattern# Sphyxis - Eyes in a nook
  ["WWW??", "WW.X?", "W.*X?", "WWW??", "?????"], //Pattern# Sphyxis - 2x2 corner contain #GREAT
  ["BBB??", "BB.X?", "B..X?", "BBB??", "?????"], //Pattern# Sphyxis - 2x2 corner contain #GREAT
  ["?WWW?", "W.*.W", "WXXXW", "?????", "?????"], //Take the 3x3 back corner
];
// Star points in EARLY-INFLUENCE order: 4-4 corners first (influence-oriented),
// then the four side stars, then tengen, then the 3-3 / 5-5 corner fallbacks.
const Y19_OPENING_POINTS = [
  [3, 3], [3, 15], [15, 3], [15, 15],   // 4-4 corner hoshi
  [3, 9], [9, 3], [9, 15], [15, 9],     // side stars
  [9, 9],                               // tengen
  [2, 2], [2, 16], [16, 2], [16, 16],   // 3-3 corners
  [4, 4], [4, 14], [14, 4], [14, 14],   // 5-5 corners
];
const ENEMY_CAPTURE_MASKS_SCRATCH = { final: 0, any: 0 };
let ADJACENT_CLEANUP_SCRATCH = null;
const ROOT_MOVE_SAFETY_SCRATCH = {
  nonCapturingGroupAtari: 0,
  anyAtari: 0,
};
const ROOT_MOVE_TACTICAL_SCRATCH = {
  connection: 0,
  rescue: 0,
  safetyImprovement: 0,
};

function readCheatSuccessChance(ns, playAsWhite) {
  try {
    return ns.go.cheat.getCheatSuccessChance(undefined, playAsWhite);
  } catch {
    return 0;
  }
}

async function readCheatCount(ns, playAsWhite) {
  return await proxy(ns, "go.cheat.getCheatCount", playAsWhite);
}

function formatCheatAudit(audit) {
  const coords = audit.coords
    .reduce((pairs, value, index) => {
      if ((index & 1) === 0) pairs.push(`[${value},${audit.coords[index + 1]}]`);
      return pairs;
    }, [])
    .join(" + ");
  const count = audit.countBefore === null || audit.countAfter === null
    ? "count unavailable"
    : `count ${audit.countBefore}->${audit.countAfter}`;
  return `CHEAT ${audit.kind} ${coords}; ${count}; chance ` +
    `${audit.chanceBefore.toFixed(3)}->${audit.chanceAfter.toFixed(3)}`;
}

// Build every per-turn grid from the raw board — the local replacement for
// getBState/getLibs/getChain/getCEmptyNodes/getValMoves.
function sphyxAnalyzeBoard(rows, historySet) {
  const size = rows.length;
  y19Configure(size);
  const cells = y19CellsFromBoard(rows);
  sphyxBoard = rows;
  sphyxHistorySet = historySet ? new Set(historySet) : new Set();
  const wallRow = "W".repeat(size + 2);
  const test = [wallRow];
  for (const row of rows) test.push("W" + row + "W");
  test.push(wallRow);
  sphyxTestBoard = test;

  const libGrid = [];
  const chainGrid = [];
  const contestedGrid = [];
  const validGrid = [];
  for (let x = 0; x < size; x++) {
    libGrid.push(new Array(size).fill(-1));
    chainGrid.push(new Array(size).fill(-1));
    contestedGrid.push(new Array(size).fill("."));
    validGrid.push(new Array(size).fill(false));
  }

  // Stones: chain ids and per-chain liberty counts.
  const labeled = y19NextGen();
  let nextChain = 0;
  for (let p = 0; p < size * size; p++) {
    const v = cells[p];
    if (v !== Y19_BLACK && v !== Y19_WHITE) continue;
    if (Y19_LIBMARK[p] === labeled) continue;
    const libs = y19GroupLibs(cells, p);
    const id = nextChain++;
    for (let i = 0; i < Y19_GROUP_LEN; i++) {
      const q = Y19_GROUP[i];
      Y19_LIBMARK[q] = labeled;
      libGrid[(q / size) | 0][q % size] = libs;
      chainGrid[(q / size) | 0][q % size] = id;
    }
  }

  // Empty regions: controlled by whoever solely borders them, else contested
  // (mirrors getControlledEmptyNodes).
  const regionGen = y19NextGen();
  for (let p = 0; p < size * size; p++) {
    if (cells[p] !== Y19_EMPTY || Y19_MARK[p] === regionGen) continue;
    let top = 0, touchBlack = false, touchWhite = false;
    const region = [p];
    Y19_STACK[top++] = p;
    Y19_MARK[p] = regionGen;
    while (top > 0) {
      const q = Y19_STACK[--top];
      const base = q * 4;
      for (let k = 0; k < 4; k++) {
        const n = Y19_NEIGH[base + k];
        if (n < 0) break;
        const c = cells[n];
        if (c === Y19_EMPTY) {
          if (Y19_MARK[n] !== regionGen) {
            Y19_MARK[n] = regionGen;
            Y19_STACK[top++] = n;
            region.push(n);
          }
        } else if (c === Y19_BLACK) touchBlack = true;
        else if (c === Y19_WHITE) touchWhite = true;
      }
    }
    const owner = touchBlack && !touchWhite ? "X"
      : touchWhite && !touchBlack ? "O"
        : "?";
    for (const q of region) {
      contestedGrid[(q / size) | 0][q % size] = owner;
    }
  }
  for (let p = 0; p < size * size; p++) {
    if (cells[p] === Y19_WALL) {
      contestedGrid[(p / size) | 0][p % size] = "#";
    }
  }

  // Our legal moves: place, resolve captures, reject suicide and any result
  // repeating a real past position (positional superko).
  for (let p = 0; p < size * size; p++) {
    if (cells[p] !== Y19_EMPTY) continue;
    const placed = y19TryPlay(cells, p, Y19_BLACK);
    if (!placed) continue;
    if (historySet && historySet.has(y19Key(placed.cells))) continue;
    validGrid[(p / size) | 0][p % size] = true;
  }

  sphyxContested = contestedGrid;
  sphyxValidMove = validGrid;
  sphyxValidLibMoves = libGrid;
  sphyxChains = chainGrid;
  sphyxValidMovesTurn = -1; // invalidate the shuffled move cache
  y19RescueLadderCache.clear();
}

function getAllValidMoves(notMine = false) {
  const board = sphyxBoard, contested = sphyxContested, validMove = sphyxValidMove, you = SPHYX_YOU;
  if (sphyxValidMovesTurn === sphyxTurn) return notMine ? sphyxContestedMovesCache : sphyxValidMovesCache;
  let moves = [];
  let contestedMoves = [];
  for (let x = 0; x < board[0].length; x++)
    for (let y = 0; y < board[0].length; y++) {
      if (validMove[x][y]) {
        if ([you, "?"].includes(contested[x][y])) contestedMoves.push([x, y]);
        moves.push([x, y]);
      }
    }
  //Moves contains a randomized array of x,y
  moves = moves.sort(() => Math.random() - Math.random());
  contestedMoves = contestedMoves.sort(() => Math.random() - Math.random());
  sphyxValidMovesCache = moves;
  sphyxContestedMovesCache = contestedMoves;
  sphyxValidMovesTurn = sphyxTurn;
  return notMine ? sphyxContestedMovesCache : sphyxValidMovesCache;
}

function createsLib(x, y, player) {
  //Simulation-exact version of the original heuristic, same scope: only a
  //move that TOUCHES a friendly chain can "create a liberty problem", and it
  //does so exactly when the merged group ends on <= 1 liberty (captures are
  //resolved first, so a capturing connection that frees space passes).
  //Isolated placements are never vetoed here — accidental-looking
  //sacrifices are profitable bait against a capture-first opponent.
  const board = sphyxBoard;
  const size = board[0].length;
  let touchesFriendly = false;
  if (x > 0 && board[x - 1][y] === player) touchesFriendly = true;
  else if (x < size - 1 && board[x + 1][y] === player) touchesFriendly = true;
  else if (y > 0 && board[x][y - 1] === player) touchesFriendly = true;
  else if (y < size - 1 && board[x][y + 1] === player) touchesFriendly = true;
  if (!touchesFriendly) return false;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const placed = y19TryPlay(cells, x * size + y, player === SPHYX_ME ? Y19_BLACK : Y19_WHITE);
  if (!placed) return true; //suicide: the ultimate liberty problem
  return y19GroupLibs(placed.cells, x * size + y) <= 1;
}

function getChainValue(checkx, checky, player, isolated = false) {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const size = board[0].length;
  const otherPlayer = player === me ? you : me;
  const explored = new Set();
  if (contested[checkx][checky] === "?" || contested[checkx][checky] === "#" || board[checkx][checky] === otherPlayer) return 0;
  if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
  if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
  if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
  if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
  let count = 1;
  for (const explore of explored) {
    const [x, y] = JSON.parse(explore);
    if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer || (isolated && board[x][y] === ".")) continue;
    count++;
    if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
    if (x > 0) explored.add(JSON.stringify([x - 1, y]));
    if (y > 0) explored.add(JSON.stringify([x, y - 1]));
    if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
  }
  return count;
}

function getEyeValue(checkx, checky, player) {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const size = board[0].length;
  const otherPlayer = player === me ? you : me;
  const explored = new Set();
  if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
  if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
  if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
  if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
  let count = 0;
  for (const explore of explored) {
    const [x, y] = JSON.parse(explore);
    if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue;
    if (contested[x][y] === player) count++;
    if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
    if (x > 0) explored.add(JSON.stringify([x - 1, y]));
    if (y > 0) explored.add(JSON.stringify([x, y - 1]));
    if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
  }
  return count;
}

function getFreeSpace(checkx, checky) {
  const contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const size = sphyxBoard[0].length;
  if (contested[checkx][checky] !== "?") return 0;
  const explored = new Set();
  if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
  if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
  if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
  if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
  let count = 1;
  for (const explore of explored) {
    const [x, y] = JSON.parse(explore);
    if (["#", me, you].includes(contested[x][y])) continue;
    if (contested[x][y] === "?") count++;
    if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
    if (x > 0) explored.add(JSON.stringify([x - 1, y]));
    if (y > 0) explored.add(JSON.stringify([x, y - 1]));
    if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
  }
  return count;
}

function getEyeValueFull(checkx, checky, player) {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const size = board[0].length;
  const otherPlayer = player === me ? you : me;
  const explored = new Set();
  if (checkx < size - 1) explored.add(JSON.stringify([checkx + 1, checky]));
  if (checkx > 0) explored.add(JSON.stringify([checkx - 1, checky]));
  if (checky > 0) explored.add(JSON.stringify([checkx, checky - 1]));
  if (checky < size - 1) explored.add(JSON.stringify([checkx, checky + 1]));
  if (checkx < size - 1 && checky < size - 1) explored.add(JSON.stringify([checkx + 1, checky + 1]));
  if (checkx > 0 && checky < size - 1) explored.add(JSON.stringify([checkx - 1, checky + 1]));
  if (checkx < size - 1 && checky > 0) explored.add(JSON.stringify([checkx + 1, checky - 1]));
  if (checkx > 0 && checky > 0) explored.add(JSON.stringify([checkx - 1, checky - 1]));
  let count = 0;
  for (const explore of explored) {
    const [x, y] = JSON.parse(explore);
    if (contested[x][y] === "?" || contested[x][y] === "#" || board[x][y] === otherPlayer) continue;
    if (contested[x][y] === player) count++;
    if (x < size - 1) explored.add(JSON.stringify([x + 1, y]));
    if (x > 0) explored.add(JSON.stringify([x - 1, y]));
    if (y > 0) explored.add(JSON.stringify([x, y - 1]));
    if (y < size - 1) explored.add(JSON.stringify([x, y + 1]));
  }
  return count;
}

function getChainAttack(x, y) {
  const board = sphyxBoard, you = SPHYX_YOU;
  const size = board[0].length;
  let count = 0;
  if (x > 0 && board[x - 1][y] === you) count += getChainValue(x - 1, y, you);
  if (x < size - 1 && board[x + 1][y] === you) count += getChainValue(x + 1, y, you);
  if (y > 0 && board[x][y - 1] === you) count += getChainValue(x, y - 1, you);
  if (y < size - 1 && board[x][y + 1] === you) count += getChainValue(x, y + 1, you);

  return count;
}

function getChainAttackFull(x, y) {
  const you = SPHYX_YOU;
  const size = sphyxBoard[0].length;
  let count = 0;
  if (x < size - 1) count += getChainValue(x + 1, y, you);
  if (x > 0) count += getChainValue(x - 1, y, you);
  if (y > 0) count += getChainValue(x, y - 1, you);
  if (y < size - 1) count += getChainValue(x, y + 1, you);
  if (x < size - 1 && y < size - 1) count += getChainValue(x + 1, y + 1, you);
  if (x > 0 && y < size - 1) count += getChainValue(x - 1, y + 1, you);
  if (x < size - 1 && y > 0) count += getChainValue(x + 1, y - 1, you);
  if (x > 0 && y > 0) count += getChainValue(x - 1, y - 1, you);
  return count;
}

function getSurroundSpace(x, y) {
  const board = sphyxBoard;
  const size = board[0].length;
  let surround = 0;
  if (x > 0 && board[x - 1][y] === ".") surround++;
  if (x < size - 1 && board[x + 1][y] === ".") surround++;
  if (y > 0 && board[x][y - 1] === ".") surround++;
  if (y < size - 1 && board[x][y + 1] === ".") surround++;
  return surround;
}

function getSurroundSpaceFull(startx, starty, player = SPHYX_ME, depth = 1) {
  const board = sphyxBoard;
  const size = board[0].length;
  let surround = 0;
  for (let x = startx - depth; x <= startx + depth; x++)
    for (let y = starty - depth; y <= starty + depth; y++)
      if (x >= 0 && x <= size - 1 && y >= 0 && y <= size - 1 && [".", player].includes(board[x][y])) surround++;
  return surround;
}

function getHeatMap(startx, starty, player = SPHYX_ME, depth = 2) {
  const board = sphyxBoard;
  const size = board[0].length;
  let count = 1;
  for (let x = startx - depth; x <= startx + depth; x++)
    for (let y = starty - depth; y <= starty + depth; y++)
      if (x >= 0 && x <= size - 1 && y >= 0 && y <= size - 1 && [".", player].includes(board[x][y])) count += board[x][y] === player ? 1.5 : board[x][y] === "." ? 1 : 0;
  return count;
}

function getSurroundLibs(x, y, player) {
  const board = sphyxBoard, validLibMoves = sphyxValidLibMoves;
  const size = board[0].length;
  let surround = 0;
  if (x > 0 && (board[x - 1][y] === "." || board[x - 1][y] === player)) surround += board[x - 1][y] === "." ? 1 : validLibMoves[x - 1][y] - 1;
  if (x < size - 1 && (board[x + 1][y] === "." || board[x + 1][y] === player)) surround += board[x + 1][y] === "." ? 1 : validLibMoves[x + 1][y] - 1;
  if (y > 0 && (board[x][y - 1] === "." || board[x][y - 1] === player)) surround += board[x][y - 1] === "." ? 1 : validLibMoves[x][y - 1] - 1;
  if (y < size - 1 && (board[x][y + 1] === "." || board[x][y + 1] === player)) surround += board[x][y + 1] === "." ? 1 : validLibMoves[x][y + 1] - 1;
  return surround;
}

function getSurroundLibSpread(x, y, player) {
  const board = sphyxBoard;
  const size = board[0].length;
  let surround = 0;
  const checks = new Set;
  if (board[x][y] === ".") checks.add(JSON.stringify([x, y]));
  else return 0;
  if (x > 0 && board[x - 1][y] === ".") checks.add(JSON.stringify([x - 1, y]));
  if (x < size - 1 && board[x + 1][y] === ".") checks.add(JSON.stringify([x + 1, y]));
  if (y > 0 && board[x][y - 1] === ".") checks.add(JSON.stringify([x, y - 1]));
  if (y < size - 1 && board[x][y + 1] === ".") checks.add(JSON.stringify([x, y + 1]));
  //Now, check the liberty values of all the checks
  for (const check of checks) {
    const [cx, cy] = JSON.parse(check);
    surround += getSurroundLibs(cx, cy, player);
  }
  return surround;
}

function getSurroundEnemiesFull(x, y) {
  const board = sphyxBoard, you = SPHYX_YOU;
  const size = board[0].length;
  let surround = 0;
  if (x > 0 && board[x - 1][y] === you) surround += getChainValue(x - 1, y, you);
  if (x < size - 1 && board[x + 1][y] === you) surround += getChainValue(x + 1, y, you);
  if (y > 0 && board[x][y - 1] === you) surround += getChainValue(x, y - 1, you);
  if (y < size - 1 && board[x][y + 1] === you) surround += getChainValue(x, y + 1, you);

  if (x > 0 && y > 0 && board[x - 1][y - 1] === you) surround += getChainValue(x - 1, y - 1, you);
  if (x < size - 1 && y > 0 && board[x + 1][y - 1] === you) surround += getChainValue(x + 1, y - 1, you);
  if (y < size - 1 && x > 0 && board[x - 1][y + 1] === you) surround += getChainValue(x - 1, y + 1, you);
  if (y < size - 1 && x < size - 1 && board[x + 1][y + 1] === you) surround += getChainValue(x + 1, y + 1, you);

  return surround;
}

// --- 3x3/4x4/5x5 pattern machinery (prefixed: the 5x5 engine already has
// functions named getAllPatterns/rotate90Degrees/verticalMirror) ---
function sphyxRotate90(pattern) {
  return pattern.map((val, index) => pattern.map(row => row[index]).reverse().join(""));
}
function sphyxVerticalMirror(pattern) {
  return pattern.toReversed();
}
function sphyxAllPatterns(pattern) {
  const rotations = [
    pattern,
    sphyxRotate90(pattern),
    sphyxRotate90(sphyxRotate90(pattern)),
    sphyxRotate90(sphyxRotate90(sphyxRotate90(pattern))),
  ];
  return [...rotations, ...rotations.map(sphyxVerticalMirror)];
}

function isPattern(x, y, pattern) {
  //Move the pattern around with x/y loops, check if pattern matches IF a move is placed
  //We can assume that x and y are valid moves
  const testBoard = sphyxTestBoard, contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const size = testBoard[0].length;
  const patterns = sphyxAllPatterns(pattern);
  const patternSize = pattern.length;

  for (const patternCheck of patterns) {
    //cx and cy - the spots of the pattern we are checking against the test board
    //For, say a 3x3 pattern, we do a grid of 0,0 -> 2, 2
    for (let cx = ((patternSize - 1) * -1); cx <= 0; cx++) { // We've added a wall around everything, so 0 is a wall
      if (cx + x + 1 < 0 || cx + x + 1 > size - 1) continue;
      for (let cy = ((patternSize - 1) * -1); cy <= 0; cy++) {
        //We now have a cycle that will check each section of the grid against the pattern
        //Safety checks: We know 0,0 is safe, we were sent it, but each other section could be bad
        if (cy + y + 1 < 0 || cy + y + 1 > size - 1) continue;
        let count = 0;
        let abort = false;
        for (let px = 0; px < patternSize && !abort; px++) {
          if (x + cx + px + 1 < 0 || x + cx + px + 1 >= size) {  //Don't go off grid
            abort = true;
            break;
          }
          for (let py = 0; py < patternSize && !abort; py++) {
            if (y + cy + py + 1 < 0 || y + cy + py + 1 >= size) { //Are we off the map?
              abort = true;
              break;
            }
            if (cx + px === 0 && cy + py === 0 && ![me, "*"].includes(patternCheck[px][py])) {
              abort = true;
              break;
            }
            if (cx + px === 0 && cy + py === 0 && [me].includes(contested[x][y]) && patternCheck[px][py] !== "*") {
              abort = true;
              break;
            }
            //We now have a cycles for each spot in the pattern
            //0,0 -> 2,2 for a 3x3
            switch (patternCheck[px][py]) {
              case "X":
                if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === me || (cx + px === 0 && cy + py === 0 && testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")) {
                  count++;
                }
                else if (cx + px === 0 && cy + py === 0) {
                  count++; // Our placement piece
                }
                else abort = true;
                break;
              case "*": // Special case.  We move here next or break the test
                if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === "." && cx + px === 0 && cy + py === 0) {
                  count++;
                }
                else abort = true;
                break;
              case "O":
                if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === you)
                  count++;
                else abort = true;
                break;
              case "x":
                if ([me, "."].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
              case "o":
                if ([you, "."].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
              case "?":
                count++;
                break;
              case ".":
                if (testBoard[cx + x + 1 + px][cy + y + 1 + py] === ".")
                  count++;
                else abort = true;
                break;
              case "W":
                if (["W", "#"].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
              case "B":
                if (["W", "#", me].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
              case "b":
                if (["W", "#", you].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
              case "A":
                if (["W", "#", me, you].includes(testBoard[cx + x + 1 + px][cy + y + 1 + py]))
                  count++;
                else abort = true;
                break;
            }
            if (count === patternSize * patternSize) return true;
          }
        }
      }
    }
  }
  return false;
}





function getDefPattern() {
  let def = [];
  def.push(...def5);

  const moves = getAllValidMoves();
  for (const [x, y] of moves) {
    for (const pattern of def)
      if (isPattern(x, y, pattern)) {
        return {
          coords: [x, y],
          msg: "Def Pattern: " + pattern.length,
        };
      }
  }
  return [];
}

// SnakeEyes (playTwoMoves cheat): fill both liberties of an enemy chain in a
// single cheat turn. Two modes, ranked together by TOTAL stones killed:
//   SINGLE — one chain at two liberties: both filled, chain dies now.
//   PAIR   — two chains, each at two liberties, SHARING one: filling the
//            larger chain's own liberty plus the shared one captures it
//            outright AND drops the partner to a single liberty (captured on
//            the following turn). minKilled compares against the PAIR TOTAL,
//            never each chain individually. Twins sharing BOTH liberties die
//            together immediately.
function getSnakeEyes(minKilled = 6) {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME;
  if (!CHEATS_ENABLED) return [];
  const size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const analysis = y19SourceAnalysis(cells);
  // Enemy chains at exactly two liberties, outside space we already control
  // (a chain inside our own territory is already dead — no cheat needed).
  const targets = [];
  for (const group of analysis.groups) {
    if (group.color !== Y19_WHITE || group.liberties.length !== 2) continue;
    const ax = (group.points[0] / size) | 0, ay = group.points[0] % size;
    if (contested[ax][ay] === me) continue;
    targets.push(group);
  }
  if (!targets.length) return [];
  const candidates = [];
  for (const group of targets) {
    if (group.points.length < minKilled) continue;
    candidates.push({
      killed: group.points.length,
      immediate: group.points.length,
      pair: false,
      coords: [
        (group.liberties[0] / size) | 0, group.liberties[0] % size,
        (group.liberties[1] / size) | 0, group.liberties[1] % size,
      ],
    });
  }
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      const a = targets[i], b = targets[j];
      const shared = a.liberties.filter(point => b.liberties.includes(point));
      if (!shared.length) continue;
      const total = a.points.length + b.points.length;
      if (total < minKilled) continue;
      if (shared.length === 2) {
        candidates.push({
          killed: total,
          immediate: total,
          pair: true,
          coords: [
            (shared[0] / size) | 0, shared[0] % size,
            (shared[1] / size) | 0, shared[1] % size,
          ],
        });
        continue;
      }
      const sharedLib = shared[0];
      const larger = a.points.length >= b.points.length ? a : b;
      const own = larger.liberties.find(point => point !== sharedLib);
      if (own === undefined) continue;
      candidates.push({
        killed: total,
        immediate: larger.points.length,
        pair: true,
        coords: [
          (own / size) | 0, own % size,
          (sharedLib / size) | 0, sharedLib % size,
        ],
      });
    }
  }
  if (!candidates.length) return [];
  // Highest TOTAL killed wins — one large chain or two smaller ones — with
  // the guaranteed immediate capture breaking ties.
  candidates.sort((a, b) => b.killed - a.killed || b.immediate - a.immediate);
  const ties = candidates.filter(candidate =>
    candidate.killed === candidates[0].killed &&
    candidate.immediate === candidates[0].immediate);
  const pick = ties[Math.floor(Math.random() * ties.length)];
  return {
    coords: pick.coords,
    stones: pick.killed,
    msg: "SnakeEyes Cheat: " + pick.killed + " stones" +
      (pick.pair ? " (shared-liberty pair)" : ""),
  };
}

// removeRouter eye-kill finder. Target a LARGER enemy group holding at most one
// eye (already unkillable-by-life). Clear one of its stones with removeRouter so
// WE can occupy that vacated point and live there (>= 2 liberties): a foothold
// from which the next moves fill the group's single eye and kill it. Returns
// the enemy STONE to remove ({ removeAt, groupSize, eyes }) or null. The vacated
// point becomes our forced next move (y19RouterKill), so the AI can't refill it.
function y19FindRouterEyeKill() {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME;
  if (!CHEATS_ENABLED) return null;
  const size = board[0].length;
  const MIN_GROUP = 5; // only bother with a sizable ("larger") group
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const analysis = y19SourceAnalysis(cells);
  const whiteEyes = y19SourceEyesByGroup(analysis, Y19_WHITE);
  let best = null;
  for (const group of analysis.groups) {
    if (group.color !== Y19_WHITE || group.points.length < MIN_GROUP) continue;
    const ax = (group.points[0] / size) | 0, ay = group.points[0] % size;
    if (contested[ax][ay] === me) continue; // already ours
    const eyeList = whiteEyes.get(group.id) ?? [];
    if (eyeList.length > 1) continue; // up to ONE eye only
    const eyePoints = new Set();
    for (const eye of eyeList) for (const p of eye) eyePoints.add(p);
    for (const S of group.points) {
      // Clear the enemy stone, then require that we can legally play into the
      // vacated point AND that our stone there survives with >= 2 liberties.
      const simCells = cells.slice();
      simCells[S] = Y19_EMPTY;
      const play = y19TryPlay(simCells, S, Y19_BLACK);
      if (!play) continue;                            // can't play into the vacancy
      if (y19GroupLibs(play.cells, S) < 2) continue;  // must survive with 2+ libs
      const sx = (S / size) | 0, sy = S % size;
      let nearEye = false;
      if (sx > 0 && eyePoints.has(S - size)) nearEye = true;
      if (sx < size - 1 && eyePoints.has(S + size)) nearEye = true;
      if (sy > 0 && eyePoints.has(S - 1)) nearEye = true;
      if (sy < size - 1 && eyePoints.has(S + 1)) nearEye = true;
      // Prefer a foothold NEXT TO the eye (that is the one that kills), then a
      // bigger group.
      const score = (nearEye ? 100000 : 0) + group.points.length;
      if (!best || score > best.score) {
        best = { removeAt: S, score, groupSize: group.points.length, eyes: eyeList.length, nearEye };
      }
    }
  }
  return best;
}

function getWallBreaker(eyesToBreak = 3) {
  const board = sphyxBoard, contested = sphyxContested, validLibMoves = sphyxValidLibMoves, me = SPHYX_ME, you = SPHYX_YOU;
  if (!CHEATS_ENABLED) return [];
  const moveOptions = [];
  const size = board[0].length;
  let highValue = 1;

  // -1 => UNBOUNDED: destroyNode ('#') removes a liberty from every group
  // touching the node. Score all destroyable nodes and take the most damaging:
  //   (1) capture — node is the LAST liberty of one or more groups (they fall);
  //       the only way to take an enemy eye that's illegal for us to play into.
  //   (2) shared-eye double kill — node shared by 2+ two-liberty groups, so one
  //       destroy ataris them all. Lone 2-lib groups are left to the cascade.
  if (eyesToBreak < 0) {
    y19Configure(size);
    const cells = y19CellsFromBoard(board);
    const analysis = y19SourceAnalysis(cells);
    // liberty point -> { capture, atariStones, atariGroups, groups }
    const nodes = new Map();
    const ourLast = new Set(); // last liberty of one of OUR groups -> don't self-capture
    for (const group of analysis.groups) {
      if (group.color === Y19_WHITE) {
        const ax = (group.points[0] / size) | 0, ay = group.points[0] % size;
        if (contested[ax][ay] === me) continue; // already ours — no cheat needed
        const last = group.liberties.length === 1;
        const atari = group.liberties.length === 2;
        for (const lib of group.liberties) {
          let e = nodes.get(lib);
          if (!e) nodes.set(lib, e = { capture: 0, atariStones: 0, atariGroups: 0, groups: 0 });
          e.groups++;
          if (last) e.capture += group.points.length;
          else if (atari) { e.atariStones += group.points.length; e.atariGroups++; }
        }
      } else if (group.liberties.length === 1) {
        ourLast.add(group.liberties[0]); // destroying our own last liberty = suicide
      }
    }
    // Value a node by the enemy stones it neutralizes this turn — captured
    // outright, plus any group left at ONE liberty (atari) that we then take
    // out. A single-group atari counts too: reducing a 2-liberty group to one
    // liberty makes a takeable 1-lib group (the point the normal cascade could
    // not reach — e.g. an eye it is illegal for us to play into). Prefer the
    // biggest total, then realized captures over threats, then the move that
    // hits the most groups at once.
    let best = null; // { point, capture, atariStones, atariGroups, value }
    for (const [point, e] of nodes) {
      if (ourLast.has(point)) continue;                 // never self-capture
      if (e.capture <= 0 && e.atariGroups < 1) continue; // effective moves only
      const value = e.capture + e.atariStones;
      if (!best
        || value > best.value
        || (value === best.value && e.capture > best.capture)
        || (value === best.value && e.capture === best.capture
          && e.atariGroups > best.atariGroups)) {
        best = { point, capture: e.capture, atariStones: e.atariStones, atariGroups: e.atariGroups, value };
      }
    }
    if (!best) return [];
    const multi = best.atariGroups >= 2;
    const label =
      best.capture > 0 && best.atariGroups > 0
        ? (multi ? "capture + double kill, " : "capture + atari, ") + best.value + " stones"
        : best.capture > 0
          ? "capture, " + best.value + " stones"
          : multi
            ? "shared-eye double kill, " + best.atariGroups + " groups / " + best.value + " stones"
            : "atari (1-lib setup), " + best.value + " stones";
    return {
      coords: [(best.point / size) | 0, best.point % size],
      stones: best.value,
      msg: "WallBreaker Cheat: " + label,
    };
  }

  // ROOT SEVER (checked BEFORE any eye is filled): a destroyable empty node
  // that is the LAST liberty of one or more enemy branches kills everything
  // rooted on it outright — sever the root and the whole branch is captured,
  // having lost its liberties. Branches sharing the same root are summed.
  // AREA SPLIT: destroying one empty node can also CUT a shared liberty area
  // (3+ cells) so that every two-liberty chain holding that node falls to a
  // SINGLE liberty — dead men in the tunnels — while the rest of the area
  // keeps breathing. The kill count is the total stones of all chains cut to
  // one liberty. An outright root sever beats a same-size split.
  {
    y19Configure(size);
    const cells = y19CellsFromBoard(board);
    const analysis = y19SourceAnalysis(cells);
    const rootTotals = new Map();
    const splitCandidates = new Map(); // liberty point -> { stones, libs }
    for (const group of analysis.groups) {
      if (group.color !== Y19_WHITE) continue;
      const ax = (group.points[0] / size) | 0, ay = group.points[0] % size;
      if (contested[ax][ay] === me) continue; // already ours — no cheat needed
      if (group.liberties.length === 1) {
        const root = group.liberties[0];
        rootTotals.set(root, (rootTotals.get(root) ?? 0) + group.points.length);
        continue;
      }
      if (group.liberties.length !== 2) continue;
      for (const liberty of group.liberties) {
        let entry = splitCandidates.get(liberty);
        if (!entry) {
          splitCandidates.set(liberty, entry = { stones: 0, libs: new Set() });
        }
        entry.stones += group.points.length;
        for (const point of group.liberties) entry.libs.add(point);
      }
    }
    let bestRoot = -1, bestRootStones = 1;
    for (const [root, stones] of rootTotals) {
      if (stones > bestRootStones) {
        bestRootStones = stones;
        bestRoot = root;
      }
    }
    // A genuine SPLIT cuts an area of 3+ liberty cells; a lone 2-liberty
    // chain (union of 2) is a plain fill and stays with the normal cascade.
    let bestSplit = -1, bestSplitStones = 1;
    for (const [point, entry] of splitCandidates) {
      if (entry.libs.size < 3) continue;
      if (entry.stones > bestSplitStones) {
        bestSplitStones = entry.stones;
        bestSplit = point;
      }
    }
    const rootMove = bestRoot >= 0
      ? {
        coords: [(bestRoot / size) | 0, bestRoot % size],
        stones: bestRootStones,
        msg: "WallBreaker Cheat: root sever, " + bestRootStones + " stones",
      }
      : null;
    const splitMove = bestSplit >= 0
      ? {
        coords: [(bestSplit / size) | 0, bestSplit % size],
        stones: bestSplitStones,
        msg: "WallBreaker Cheat: area split, " + bestSplitStones + " stones",
      }
      : null;
    if (rootMove && (!splitMove || rootMove.stones >= splitMove.stones)) {
      return rootMove;
    }
    if (splitMove) return splitMove;
  }

  const checked = new Set;

  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) {
      if (contested[x][y] === me || board[x][y] !== you || (validLibMoves[x][y] !== eyesToBreak && eyesToBreak > 0) || checked.has(JSON.stringify([x, y]))) continue;
      //Is it the enemy, with 2 libs (we can kill) and we have not checked this spot and the chain is large enough
      const chain = getChainValue(x, y, you, true);
      checked.add(JSON.stringify([x, y]));
      //We have a winner!  Check all it's spots and find the 2 killing blows.  Add the checked spots to the checked list so we don't recheck
      const enemySearch = new Set;
      const moves = [];
      enemySearch.add(JSON.stringify([x, y]));
      for (const explore of enemySearch) {
        const [fx, fy] = JSON.parse(explore);
        //Find your eyes
        if (board[fx][fy] === ".") {
          moves.push([fx, fy]);
          checked.add(JSON.stringify([fx, fy]));
          continue;
        }

        //Find more of yourself to search...
        if (fx < size - 1 && [you, "."].includes(board[fx + 1][fy])) {
          enemySearch.add(JSON.stringify([fx + 1, fy]));
          checked.add(JSON.stringify([fx, fy]));
        }
        if (fx > 0 && [you, "."].includes(board[fx - 1][fy])) {
          enemySearch.add(JSON.stringify([fx - 1, fy]));
          checked.add(JSON.stringify([fx, fy]));
        }
        if (fy > 0 && [you, "."].includes(board[fx][fy - 1])) {
          enemySearch.add(JSON.stringify([fx, fy - 1]));
          checked.add(JSON.stringify([fx, fy]));
        }
        if (fy < size - 1 && [you, "."].includes(board[fx][fy + 1])) {
          enemySearch.add(JSON.stringify([fx, fy + 1]));
          checked.add(JSON.stringify([fx, fy]));
        }
      } // End of searching the enemy

      if (chain > highValue) {
        highValue = chain;
        moveOptions.length = 0;
        moveOptions.push(...moves);
      }
      else if (chain === highValue) {
        moveOptions.push(...moves);
      }
    } // Search whole board

  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    stones: highValue,
    msg: "WallBreaker Cheat"
  } : [];
}

// COMBO CHEAT: evaluate BOTH cheats — SnakeEyes (two placed stones) and
// WallBreaker (one destroyed node) — and play whichever kills the most
// stones, but only when that best meets the minimum. Its cascade slot is a
// user-tunable literal step (currently at the very bottom).
function comboCheat(minStones = 6) {
  if (!CHEATS_ENABLED) return [];
  const floor = Math.max(1, Math.floor(minStones));
  const snake = getSnakeEyes(floor);
  const breaker = getWallBreaker(-1);
  const snakeStones = snake && snake.coords ? snake.stones ?? 0 : 0;
  const breakerStones = breaker && breaker.coords ? breaker.stones ?? 0 : 0;
  const best = snakeStones >= breakerStones
    ? { kind: "snakeEyes", move: snake, stones: snakeStones }
    : { kind: "wallBreaker", move: breaker, stones: breakerStones };
  if (!best.move || !best.move.coords || best.stones < floor) return [];
  return {
    kind: best.kind,
    coords: best.move.coords,
    stones: best.stones,
    msg: "Combo Cheat: " + best.kind + ", " + best.stones + " stones",
  };
}

function getRandomLibAttack(minKilled = 1, ignore = 0) {
  const board = sphyxBoard, contested = sphyxContested, validLibMoves = sphyxValidLibMoves, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  const size = board[0].length;
  let highValue = 1;
  // Look through all the points on the board
  const moves = getAllValidMoves(true);
  for (const [x, y] of moves) {
    if (contested[x][y] === me || validLibMoves[x][y] !== -1) continue;

    let count = 0;
    let chains = 0;

    //We are only checking up, down, left and right
    if (x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] === 1) {
      count++;
      chains += getChainValue(x - 1, y, you);
    }
    if (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] === 1) {
      count++;
      chains += getChainValue(x + 1, y, you);
    }
    if (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] === 1) {
      count++;
      chains += getChainValue(x, y - 1, you);
    }
    if (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] === 1) {
      count++;
      chains += getChainValue(x, y + 1, you);
    }
    const enemyLibs = getSurroundLibs(x, y, you);
    if (count === 0 || chains <= ignore || (chains < minKilled && enemyLibs <= 1)) continue;
    const result = count * chains;
    if (result > highValue) {
      moveOptions.length = 0;
      moveOptions.push([x, y]);
      highValue = result;
    }
    else if (result === highValue) moveOptions.push([x, y]);
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Lib Attack"
  } : [];
}

function getRandomLibDefend(savedMin = 1) {
  const board = sphyxBoard, validLibMoves = sphyxValidLibMoves, chains = sphyxChains, me = SPHYX_ME;
  const moveOptions = [];
  const size = board[0].length;
  y19Configure(size);
  const defCells = y19CellsFromBoard(board);
  let highValue = 0;
  //BAIT bookkeeping: once the stone is taken, clear only its board point. The
  //owner-tagged follow-up remains active until its fill resolves, so no second
  //bait can start in between. While the stone remains, never rescue its chain.
  let baitChain = -1;
  if (BAITED != null) {
    const bx = (BAITED / size) | 0, by = BAITED % size;
    if (board[bx][by] !== me) BAITED = null;
    else baitChain = chains[bx][by];
  }
  // Look through all the points on the board
  const moves = getAllValidMoves();
  for (const [x, y] of moves) {
    const surround = getSurroundLibs(x, y, me);
    const myEyes = getEyeValue(x, y, me);
    if (surround + myEyes < 2 || createsLib(x, y, me)) continue; //Abort.  Let it go, let it go...

    if (validLibMoves[x][y] === -1) {
      //Never defend a bait: rescuing it wastes the sacrifice (and for the
      //ladder bait, starves the pending follow-up). This covers BOTH the
      //tactical bait stone (BAITED) and the opening corridor baits.
      const savesBait = (ax, ay) =>
        board[ax][ay] === me && (
          (baitChain >= 0 && chains[ax][ay] === baitChain) ||
          sphyxIsOpeningBaitChain(chains[ax][ay]));
      if ((x > 0 && savesBait(x - 1, y)) ||
        (x < size - 1 && savesBait(x + 1, y)) ||
        (y > 0 && savesBait(x, y - 1)) ||
        (y < size - 1 && savesBait(x, y + 1))) {
        continue;
      }
      let count = 0;
      //We are only checking up, down, left and right
      if (x > 0 && validLibMoves[x - 1][y] === 1 && board[x - 1][y] === me) count += getChainValue(x - 1, y, me);
      if (x < size - 1 && validLibMoves[x + 1][y] === 1 && board[x + 1][y] === me) count += getChainValue(x + 1, y, me);
      if (y > 0 && validLibMoves[x][y - 1] === 1 && board[x][y - 1] === me) count += getChainValue(x, y - 1, me);
      if (y < size - 1 && validLibMoves[x][y + 1] === 1 && board[x][y + 1] === me) count += getChainValue(x, y + 1, me);
      if (count === 0 || count < savedMin) continue;
      //LADDER CHECK (sized to the board): a rescue that walks into a losing
      //ladder is no rescue. Simulate the defense; if the merged group sits at
      //two liberties and the full-board ladder read says it dies anyway, do
      //not defend — let the group go.
      const defended = y19TryPlay(defCells, x * size + y, Y19_BLACK);
      if (!defended) continue;
      if (!y19RescueSurvivesLadder(
        defended.cells,
        x * size + y,
        Y19_BLACK
      )) continue;
      //Just HOW effective will this move be?  Counter attack if we can.
      count *= surround;

      if (count > highValue) {
        moveOptions.length = 0;
        moveOptions.push([x, y]);
        highValue = count;
      }
      else if (count === highValue) moveOptions.push([x, y]);
    }
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Lib Defend"
  } : [];
}

function getRandomCounterLib() {
  // Counter Lib: kill a trapped (1-lib) enemy group only when NECESSARY —
  // (1) the enemy has put one of our groups at 1 liberty, (2) that group can't
  // save itself by a plain extension (else libDefend handles it), (3) the enemy
  // stays trapped (its extension gains no liberty; a capture of our group = a
  // shared-liberty race we win by moving first), and (4) the kill leaves us with
  // 2+ liberties (no snapback). Largest endangered group first.
  const board = sphyxBoard, validMove = sphyxValidMove, validLibMoves = sphyxValidLibMoves, chains = sphyxChains, me = SPHYX_ME, you = SPHYX_YOU;
  const size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);

  //Condition 1: our groups in atari — found from the stones themselves, so a
  //group whose own liberty is suicide-to-fill (the most trapped kind) is
  //still seen. Sorted by stone count, largest first.
  const seenChains = new Set();
  const endangered = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== me || validLibMoves[x][y] !== 1 || seenChains.has(chains[x][y])) continue;
      seenChains.add(chains[x][y]);
      // Opening bait stones are sacrifices — never spend a kill or a
      // last-liberty rescue saving them.
      if (sphyxIsOpeningBaitChain(chains[x][y])) continue;
      const anchor = x * size + y;
      y19GroupLibs(cells, anchor);
      endangered.push({ anchor, stones: Y19_GROUP_LEN });
    }
  if (!endangered.length) return [];
  endangered.sort((a, b) => b.stones - a.stones);

  for (const group of endangered) {
    const anchor = group.anchor;
    //One flood fill up front: the group's stones AND its single liberty.
    y19GroupLibs(cells, anchor);
    const ownLib = Y19_LAST_LIB;
    const groupStones = [];
    for (let i = 0; i < Y19_GROUP_LEN; i++) groupStones.push(Y19_GROUP[i]);

    //Condition 2: if a plain liberty extension (no capture) already saves
    //this group, the kill is not necessary — leave the extension move for
    //getRandomLibDefend and move on to the next endangered group.
    if (ownLib >= 0) {
      const extend = y19TryPlay(cells, ownLib, Y19_BLACK);
      if (extend && extend.captured === 0 &&
        y19RescueSurvivesLadder(extend.cells, anchor, Y19_BLACK)) {
        continue;
      }
    }

    //Collect the 1-liberty enemy chains BORDERING this group (their capture
    //frees liberties directly onto our stones).
    const enemyAnchors = new Map(); // enemy chain id -> anchor point
    for (const p of groupStones) {
      const px = (p / size) | 0, py = p % size;
      for (const [nx, ny] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (board[nx][ny] === you && validLibMoves[nx][ny] === 1 && !enemyAnchors.has(chains[nx][ny]))
          enemyAnchors.set(chains[nx][ny], nx * size + ny);
      }
    }

    //Preferred: kill a bordering trapped group at ITS liberty — our group
    //keeps its own liberty plus the freed cells.
    for (const enemyAnchor of enemyAnchors.values()) {
      //A 1-liberty chain's only liberty is its capture point.
      y19GroupLibs(cells, enemyAnchor);
      const killPoint = Y19_LAST_LIB;
      if (killPoint < 0) continue;
      const kx = (killPoint / size) | 0, ky = killPoint % size;
      if (!validMove[kx][ky]) continue;

      //Condition 3: simulate THEIR extension at the liberty point.
      const enemyExtend = y19TryPlay(cells, killPoint, Y19_WHITE);
      if (enemyExtend) {
        const racesOurGroup = enemyExtend.cells[anchor] !== Y19_BLACK;
        if (!racesOurGroup && y19GroupLibs(enemyExtend.cells, killPoint) >= 2)
          continue; //the extension frees it — not this function's kill
      }
      //(enemyExtend === null means extending is suicide for them: fully trapped.)

      //Condition 4: simulate OUR kill and require the rescue to hold.
      const afterKill = y19TryPlay(cells, killPoint, Y19_BLACK);
      if (!afterKill || afterKill.captured === 0) continue;
      if (!y19RescueSurvivesLadder(
        afterKill.cells,
        anchor,
        Y19_BLACK
      ))
        continue; //snapback or ladder: the kill does not save us

      return {
        coords: [kx, ky],
        msg: "Counter Lib Attack - Necessary kill (" + afterKill.captured + " freed)"
      };
    }

    //LAST-LIBERTY RESCUE: play into our own final liberty when doing so
    //captures an enemy group and the merged group survives on the freed
    //cells. No trapped-ness gate is needed — an enemy group capturable at
    //our last liberty holds ITS last liberty there too, so this is always
    //the shared-liberty race. The 2-liberty floor still rejects snapbacks.
    if (ownLib >= 0) {
      const lx = (ownLib / size) | 0, ly = ownLib % size;
      if (validMove[lx][ly]) {
        const rescue = y19TryPlay(cells, ownLib, Y19_BLACK);
        if (rescue && rescue.captured > 0 &&
          y19RescueSurvivesLadder(rescue.cells, anchor, Y19_BLACK)) {
          return {
            coords: [lx, ly],
            msg: "Counter Lib Attack - Last liberty rescue (" + rescue.captured + " freed)"
          };
        }
      }
    }
  }
  return [];
}
function getRandomExpand() {
  const board = sphyxBoard, contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  const size = board[0].length;
  let highValue = 0;
  // Look through all the points on the board
  const moves = getAllValidMoves(true);
  for (const [x, y] of moves) {
    const surroundLibs = getSurroundLibs(x, y, me);
    const enemySurroundLibs = getSurroundLibs(x, y, you);
    if (contested[x][y] !== "?" || surroundLibs <= 2 || createsLib(x, y, me) || enemySurroundLibs <= 1) continue;
    let count = 0;
    //We are only checking up, down, left and right.  Don't expand if you're surrounded by friendlies
    if (x > 0 && board[x - 1][y] === me) count++;
    if (x < size - 1 && board[x + 1][y] === me) count++;
    if (y > 0 && board[x][y - 1] === me) count++;
    if (y < size - 1 && board[x][y + 1] === me) count++;
    if (count >= 3 || count <= 0) continue;

    const surroundSpace = getSurroundSpaceFull(x, y) + 1;
    const enemySurroundChains = getChainAttack(x, y) + 1;
    const myEyes = getEyeValueFull(x, y, me) + 1;
    const enemies = getSurroundEnemiesFull(x, y) + 1;
    const freeSpace = getFreeSpace(x, y);
    const rank = myEyes * enemySurroundLibs * enemies * enemySurroundChains * freeSpace * surroundSpace;

    if (rank > highValue) {
      moveOptions.length = 0;
      moveOptions.push([x, y]);
      highValue = rank;
    }
    else if (rank === highValue) moveOptions.push([x, y]);
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Expansion"
  } : [];
}

function getRandomBolster(libRequired, savedNodesMin, onlyContested = true) {
  const board = sphyxBoard, contested = sphyxContested, validLibMoves = sphyxValidLibMoves, chains = sphyxChains, me = SPHYX_ME;
  const moveOptions = [];
  const size = board[0].length;
  y19Configure(size);
  let highValue = 1;
  // Look through all the points on the board
  const moves = getAllValidMoves();
  for (const [x, y] of moves) {
    if ((onlyContested && contested[x][y] !== "?")) continue;
    if (createsLib(x, y, me)) continue;
    let right = 0;
    let left = 0;
    let up = 0;
    let down = 0;

    //We are only checking up, down, left and right
    //We are checking for linking chains of friendlies, filtering out those already checked
    let checkedChains = [];
    if (x < size - 1 && board[x + 1][y] === me && validLibMoves[x + 1][y] === libRequired && !sphyxIsOpeningBaitChain(chains[x + 1][y])) {
      right = getChainValue(x + 1, y, me);
      checkedChains.push(chains[x + 1][y]);
    }
    if (x > 0 && board[x - 1][y] === me && !checkedChains.includes(chains[x - 1][y]) && validLibMoves[x - 1][y] === libRequired && !sphyxIsOpeningBaitChain(chains[x - 1][y])) {
      left = getChainValue(x - 1, y, me);
      checkedChains.push(chains[x - 1][y]);
    }
    if (y < size - 1 && board[x][y + 1] === me && !checkedChains.includes(chains[x][y + 1]) && validLibMoves[x][y + 1] === libRequired && !sphyxIsOpeningBaitChain(chains[x][y + 1])) {
      up = getChainValue(x, y + 1, me);
      checkedChains.push(chains[x][y + 1]);
    }
    if (y > 0 && board[x][y - 1] === me && !checkedChains.includes(chains[x][y - 1]) && validLibMoves[x][y - 1] === libRequired && !sphyxIsOpeningBaitChain(chains[x][y - 1]))
      down = getChainValue(x, y - 1, me);

    let count = 0;
    let total = 0;
    if (right >= savedNodesMin) {
      count++;
      total += right;
    }
    if (left >= savedNodesMin) {
      count++;
      total += left;
    }
    if (up >= savedNodesMin) {
      count++;
      total += up;
    }
    if (down >= savedNodesMin) {
      count++;
      total += down;
    }
    if (count <= 0) continue;
    const surroundMulti = getSurroundLibSpread(x, y, me);
    const rank = total * count * surroundMulti;
    if (rank > highValue) {
      moveOptions.length = 0;
      moveOptions.push([x, y]);
      highValue = rank;
    }
    else if (rank === highValue) moveOptions.push([x, y]);
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Bolster - Libs: " + libRequired + "  Nodes: " + savedNodesMin + "  OnlyContested: " + onlyContested
  } : [];
}

function getRandomStrat() {
  const board = sphyxBoard, contested = sphyxContested, validLibMoves = sphyxValidLibMoves, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  const moveOptions2 = [];
  const size = board[0].length;

  // Look through all the points on the board
  let bestRank = 0;
  const moves = getAllValidMoves(true);
  for (const [x, y] of moves) {
    if (!["?", you].includes(contested[x][y]) || createsLib(x, y, me)) continue;
    let isSupport = ((x > 0 && board[x - 1][y] === me && validLibMoves[x - 1][y] >= 1) || (x < size - 1 && board[x + 1][y] === me && validLibMoves[x + 1][y] >= 1) || (y > 0 && board[x][y - 1] === me && validLibMoves[x][y - 1] >= 1) || (y < size - 1 && board[x][y + 1] === me && validLibMoves[x][y + 1] >= 1)) ? true : false;
    let isAttack = ((x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] >= 2) || (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] >= 2) || (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] >= 2) || (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] >= 2)) ? true : false;

    const surround = getSurroundSpace(x, y);
    if (isSupport || isAttack) {
      if (surround > bestRank) {
        moveOptions.length = 0;
        bestRank = surround;
        moveOptions.push([x, y]);
      }
      else if (surround === bestRank) {
        moveOptions.push([x, y]);
      }
    }
    else {
      moveOptions2.push([x, y]);
    }
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  const randomIndex2 = Math.floor(Math.random() * moveOptions2.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Random Safe"
  } : moveOptions2[randomIndex2] ? {
    coords: moveOptions2[randomIndex2],
    msg: "Random Unsafe"
  } : [];
}

function y19MoveStartsTwoLibertyChase(cells, analysis, point) {
  const played = y19TryPlay(cells, point, Y19_BLACK);
  if (!played) return false;
  const seen = new Uint8Array(analysis.groups.length);
  const base = point * 4;
  for (let k = 0; k < 4; k++) {
    const neighbor = Y19_NEIGH[base + k];
    if (neighbor < 0) break;
    const id = analysis.groupAt[neighbor];
    if (id < 0 || seen[id]) continue;
    seen[id] = 1;
    const group = analysis.groups[id];
    if (group.color !== Y19_WHITE || group.liberties.length !== 2) continue;
    const target = y19CollectCurrentGroup(
      played.cells,
      group.points,
      Y19_WHITE
    );
    if (target?.liberties.length === 1) return true;
  }
  return false;
}

function getAggroAttack(libsMin, libsMax, minSurround = 3, minChain = 1, minFreeSpace = 0) {
  const board = sphyxBoard, validLibMoves = sphyxValidLibMoves, chains = sphyxChains, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  const size = board[0].length;
  let highestValue = 0;
  // Look through all the points on the board
  const moves = getAllValidMoves(true);
  const checksTwoLibertyGroups = libsMin <= 2 && libsMax >= 2;
  let tacticalCells = null, tacticalAnalysis = null;

  // DOUBLE-ATARI PREFERENCE (permanent): when the tested liberty range includes
  // 2, a move that forks TWO distinct enemy two-liberty groups into atari at
  // once beats any single atari — the defender saves one, we take the other. It
  // must meet the SAME gates as a normal aggro move (createsLib / surround /
  // free space / chain), and is confirmed by simulation (both groups end at
  // exactly one liberty with DISTINCT last liberties, our stone keeps 2+). Among
  // valid forks, prefer the one threatening the most enemy stones. Only when no
  // gated double atari exists do we fall through to the single-target scoring.
  if (checksTwoLibertyGroups) {
    y19Configure(size);
    tacticalCells = y19CellsFromBoard(board);
    tacticalAnalysis = y19SourceAnalysis(tacticalCells);
    const forkOptions = [];
    let bestForkStones = 0;
    for (const [x, y] of moves) {
      if (createsLib(x, y, me)) continue;
      if (getSurroundLibs(x, y, me) < minSurround) continue;
      if (getFreeSpace(x, y) < minFreeSpace) continue;
      if (getChainAttack(x, y) < minChain) continue;
      // must border at least two DISTINCT enemy two-liberty chains
      const adjChains = new Set();
      for (const [ax, ay] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
        if (board[ax][ay] === you && validLibMoves[ax][ay] === 2) adjChains.add(chains[ax][ay]);
      }
      if (adjChains.size < 2) continue;
      // confirm the fork by simulation
      const sim = y19TryPlay(tacticalCells, x * size + y, Y19_BLACK);
      if (!sim || sim.captured > 0) continue;
      if (y19GroupLibs(sim.cells, x * size + y) < 2) continue;
      const lastLibs = new Set();
      const forkedChains = new Set();
      let forkStones = 0;
      for (const [ax, ay] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
        const p = ax * size + ay;
        if (sim.cells[p] !== Y19_WHITE || forkedChains.has(chains[ax][ay])) continue;
        if (y19GroupLibs(sim.cells, p) !== 1) continue;
        forkedChains.add(chains[ax][ay]);
        forkStones += Y19_GROUP_LEN;
        lastLibs.add(Y19_LAST_LIB);
      }
      if (forkedChains.size < 2 || lastLibs.size < 2) continue;
      if (forkStones > bestForkStones && forkStones / 2 > 1) {
        bestForkStones = forkStones;
        forkOptions.length = 0;
        forkOptions.push([x, y]);
      } else if (forkStones === bestForkStones) {
        forkOptions.push([x, y]);
      }
    }
    if (forkOptions.length) {
      const pick = forkOptions[Math.floor(Math.random() * forkOptions.length)];
      return { coords: pick, msg: "Double atari (aggro): " + bestForkStones + " stones" };
    }
  }

  for (const [x, y] of moves) {
    if (createsLib(x, y, me)) continue;
    const isAttack = (
      (x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] >= libsMin && validLibMoves[x - 1][y] <= libsMax) ||
      (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] >= libsMin && validLibMoves[x + 1][y] <= libsMax) ||
      (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] >= libsMin && validLibMoves[x][y - 1] <= libsMax) ||
      (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] >= libsMin && validLibMoves[x][y + 1] <= libsMax)) ? true : false;
    const surround = getSurroundLibs(x, y, me);
    const freeSpace = getFreeSpace(x, y);
    if (freeSpace < minFreeSpace) continue;
    if (!isAttack || surround < minSurround) continue;
    const chainAtk = getChainAttack(x, y);
    if (chainAtk < minChain) continue;
    // LadderMaker runs before this generic attack and owns every proven
    // two-liberty chase. Re-entering atari here means the proof rejected the
    // chase; continuing it is how boundary ladders grow until our stones die.
    // The verified double-atari path above remains allowed.
    /*if (checksTwoLibertyGroups && y19MoveStartsTwoLibertyChase(
      tacticalCells,
      tacticalAnalysis,
      x * size + y
    )) continue;*/
    let lowestLibs = 999;
    if (x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] < lowestLibs) lowestLibs = validLibMoves[x - 1][y];
    if (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] < lowestLibs) lowestLibs = validLibMoves[x + 1][y];
    if (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] < lowestLibs) lowestLibs = validLibMoves[x][y - 1];
    if (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] < lowestLibs) lowestLibs = validLibMoves[x][y + 1];

    const enemyLibs = getSurroundLibSpread(x, y, you);
    const startEyeValue = getEyeValue(x, y, you);
    const eyeValue = startEyeValue > 1 ? startEyeValue : 1;
    const atk = enemyLibs * chainAtk / eyeValue / lowestLibs;
    if (atk > highestValue) {
      highestValue = atk;
      moveOptions.length = 0;
      moveOptions.push([x, y]);
    }
    else if (Math.abs(atk - highestValue) < 1e-9) {
      highestValue = atk;
      moveOptions.push([x, y]);
    }
  }
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Aggro Attack " + libsMin + "-" + libsMax + ": Surround " + minSurround
  } : [];
}

function getDefAttack(libsMin, libsMax, minSurround = 3, minChain = 1, minFreeSpace = 0) {
  const board = sphyxBoard, validLibMoves = sphyxValidLibMoves, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  const size = board[0].length;
  let highestValue = 0;
  // Look through all the points on the board
  const moves = getAllValidMoves(true);
  for (const [x, y] of moves) {
    if (createsLib(x, y, me)) continue;
    const isAttack = (
      (x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] >= libsMin && validLibMoves[x - 1][y] <= libsMax) ||
      (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] >= libsMin && validLibMoves[x + 1][y] <= libsMax) ||
      (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] >= libsMin && validLibMoves[x][y - 1] <= libsMax) ||
      (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] >= libsMin && validLibMoves[x][y + 1] <= libsMax)) ? true : false;
    const surround = getSurroundLibs(x, y, me);
    const freeSpace = getFreeSpace(x, y);
    if (freeSpace < minFreeSpace) continue;
    if (!isAttack || surround < minSurround) continue;
    const chainAtk = getChainAttack(x, y);
    if (chainAtk < minChain) continue;
    let lowestLibs = 999;
    if (x > 0 && board[x - 1][y] === you && validLibMoves[x - 1][y] < lowestLibs) lowestLibs = validLibMoves[x - 1][y];
    if (x < size - 1 && board[x + 1][y] === you && validLibMoves[x + 1][y] < lowestLibs) lowestLibs = validLibMoves[x + 1][y];
    if (y > 0 && board[x][y - 1] === you && validLibMoves[x][y - 1] < lowestLibs) lowestLibs = validLibMoves[x][y - 1];
    if (y < size - 1 && board[x][y + 1] === you && validLibMoves[x][y + 1] < lowestLibs) lowestLibs = validLibMoves[x][y + 1];

    const friendlyLibs = getSurroundLibs(x, y, me);
    const startEyeValue = getEyeValue(x, y, you);
    const eyeValue = startEyeValue > 1 ? startEyeValue : 1;

    const atk = friendlyLibs * chainAtk / eyeValue * getHeatMap(x, y, me) / lowestLibs * (getEyeValue(x, y, me) + 1);

    if (atk > highestValue) {
      highestValue = atk;
      moveOptions.length = 0;
      moveOptions.push([x, y]);
    }
    else if (Math.abs(atk - highestValue) < 1e-9) {
      highestValue = atk;
      moveOptions.push([x, y]);
    }
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Defensive Attack: " + libsMin + "/" + libsMax + "  Surround: " + minSurround
  } : [];
}

function attackGrowDragon(requiredEyes, killLib = false) {
  const contested = sphyxContested, me = SPHYX_ME, you = SPHYX_YOU;
  const moveOptions = [];
  let highestValue = 0;
  // Look through all the points on the board
  const moves = getAllValidMoves(true);
  for (const [x, y] of moves) {
    if (contested[x][y] !== "?" || createsLib(x, y, me)) continue;
    const surround = getSurroundEnemiesFull(x, y);
    const myLibs = getSurroundLibs(x, y, me);
    if (surround < 1 || myLibs < 3) continue;
    const enemyLibs = getSurroundLibs(x, y, you);
    if (enemyLibs === 1 && !killLib) continue;
    const enemyChains = getChainAttackFull(x, y);
    const myEyes = getEyeValueFull(x, y, me);
    if (myEyes < requiredEyes) continue;
    const result = enemyLibs * enemyChains;

    if (result > highestValue) {
      highestValue = result;
      moveOptions.length = 0;
      moveOptions.push([x, y]);
    }
    else if (result === highestValue) {
      highestValue = result;
      moveOptions.push([x, y]);
    }
  }
  // Choose one of the found moves at random
  const randomIndex = Math.floor(Math.random() * moveOptions.length);
  return moveOptions[randomIndex] ? {
    coords: moveOptions[randomIndex],
    msg: "Attack/Grow Dragon: " + requiredEyes
  } : [];
}

//Known-good eyes of the chain containing `anchor` (Benson-flavored, not full
//Benson): an eye is a maximal empty region whose border consists exclusively
//of OUR stones and walls, with the target chain among the borderers, no
//larger than min(0.4 x playable, 11) points (the source's eye-region bound —
//without it a lone group on an open board would count the whole outside as
//an eye). A single-point region must additionally pass the classic false-eye
//diagonal rule (interior: 3+ friendly diagonals; edge/corner: every diagonal
//friendly or wall). Each qualifying region counts as one eye.
function y19ChainKnownGoodEyes(cells, anchor) {
  let wallCount = 0;
  for (let i = 0; i < Y19_NN; i++) if (cells[i] === Y19_WALL) wallCount++;
  const maxSize = Math.min((Y19_NN - wallCount) * 0.4, 11);
  const gen = y19NextGen();
  //mark the target chain on LIBMARK, region visits on MARK — one generation
  y19GroupLibs(cells, anchor);
  for (let i = 0; i < Y19_GROUP_LEN; i++) Y19_LIBMARK[Y19_GROUP[i]] = gen;
  let eyes = 0;
  for (let p = 0; p < Y19_NN; p++) {
    if (cells[p] !== Y19_EMPTY || Y19_MARK[p] === gen) continue;
    let top = 0, len = 0, touchesTarget = false, oursOnly = true;
    let single = p;
    Y19_STACK[top++] = p;
    Y19_MARK[p] = gen;
    while (top > 0) {
      const q = Y19_STACK[--top];
      len++;
      single = q;
      const base = q * 4;
      for (let k = 0; k < 4; k++) {
        const n = Y19_NEIGH[base + k];
        if (n < 0) break;
        const v = cells[n];
        if (v === Y19_EMPTY) {
          if (Y19_MARK[n] !== gen) { Y19_MARK[n] = gen; Y19_STACK[top++] = n; }
        } else if (v === Y19_BLACK) {
          if (Y19_LIBMARK[n] === gen) touchesTarget = true;
        } else if (v === Y19_WHITE) {
          oursOnly = false;
        }
        //walls are neutral border
      }
    }
    if (!oursOnly || !touchesTarget || len > maxSize) continue;
    if (len === 1) {
      //false-eye diagonal rule on the single point
      let friendly = 0, wall = 0, diagCount = 0;
      const base = single * 4;
      for (let k = 0; k < 4; k++) {
        const d = Y19_DIAG[base + k];
        if (d < 0) break;
        diagCount++;
        if (cells[d] === Y19_BLACK) friendly++;
        else if (cells[d] === Y19_WALL) wall++;
      }
      const onEdge = diagCount < 4;
      if (onEdge ? friendly + wall !== diagCount : friendly < 3) continue;
    }
    eyes++;
  }
  return eyes;
}

// Can the enemy group (identified by `ownerStones`) reach two real eyes now or
// with a single defender move into its own eyespace? Simulation-based, so it
// needs no shape table. Used to (a) confirm an eyespace is still alive-able
// before we bother killing it, and (b) confirm our vital point removed the life.
function y19CanGroupMakeTwoEyes(cells, ownerStones, defender) {
  const anchor = ownerStones.find(point => cells[point] === defender);
  if (anchor === undefined) return false;
  const base0 = y19SourceAnalysis(cells);
  const id0 = base0.groupAt[anchor];
  if (id0 < 0) return false;
  if ((y19SourceEyesByGroup(base0, defender).get(id0)?.length ?? 0) >= 2) return true;
  const group = base0.groups[id0];
  const seen = new Set();
  for (const stone of group.points) {
    const b = stone * 4;
    for (let k = 0; k < 4; k++) {
      const n = Y19_NEIGH[b + k];
      if (n < 0) break;
      if (cells[n] !== Y19_EMPTY || seen.has(n)) continue;
      seen.add(n);
      const played = y19TryPlay(cells, n, defender);
      if (!played) continue;
      const anchor2 = ownerStones.find(point => played.cells[point] === defender);
      if (anchor2 === undefined) continue;
      const a1 = y19SourceAnalysis(played.cells);
      const id1 = a1.groupAt[anchor2];
      if (id1 >= 0 &&
        (y19SourceEyesByGroup(a1, defender).get(id1)?.length ?? 0) >= 2) return true;
    }
  }
  return false;
}

// Does the AI's modeled reply on THIS position already reduce some group from
// two liberties to one (or capture)? If so it is already engaged in a forcing
// exchange and a fresh bait adds nothing — createBait stands down.
function y19OpponentForcingReplyReducesLiberties(cells, defender, history) {
  const legal = y19LegalChildren(cells, defender, history);
  const policy = y19ResolveUnknownOpponentPolicy(
    cells, legal.map(child => child.point), defender, false
  );
  if (!policy.forced) return false;
  const move = legal.find(child => child.point === policy.forcedPosition);
  if (!move) return false;
  if (move.captured > 0) return true;
  const enemy = defender === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const seen = new Uint8Array(Y19_NN);
  const base = policy.forcedPosition * 4;
  for (let k = 0; k < 4; k++) {
    const n = Y19_NEIGH[base + k];
    if (n < 0) break;
    if (cells[n] !== enemy || seen[n]) continue;
    const before = y19GroupLibs(cells, n);
    for (let i = 0; i < Y19_GROUP_LEN; i++) seen[Y19_GROUP[i]] = 1;
    if (before === 2 && y19GroupLibs(move.cells, n) === 1) return true;
  }
  return false;
}

// CREATE BAIT (proactive tempo): drop a lone 2-liberty bait the AI is forced to
// reduce then capture — two of its moves spent on ground we chose (never a
// 1-lib self-atari). contestedOnly=true baits only in enemy space; false baits
// in contested space. Guarded from libDefend so the sacrifice isn't rescued.
function createBait(contestedOnly = true) {
  if (y19BaitIsActive()) return [];
  const board = sphyxBoard, size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const attacker = Y19_BLACK, defender = Y19_WHITE;
  const validMove = sphyxValidMove, contested = sphyxContested;
  const history = new Set(sphyxHistorySet);
  history.add(y19Key(cells));
  // If the AI is already going to reduce a group/stone from two liberties to
  // one (or capture), it is engaged — do nothing.
  if (y19OpponentForcingReplyReducesLiberties(cells, defender, history)) return [];
  const enemyTerritory = contestedOnly
    ? y19EnemyTerritoryMask(cells, defender)
    : null;
  const maxTries = 16;
  const candidates = [];
  let tried = 0;
  for (let p = 0; p < Y19_NN && tried < maxTries; p++) {
    if (cells[p] !== Y19_EMPTY) continue;
    const px = (p / size) | 0, py = p % size;
    if (!validMove[px][py]) continue;
    // Arena filter + contested-space preference score.
    let openness = 0;
    if (contestedOnly) {
      if (!enemyTerritory[p]) continue;
    } else {
      if (contested[px][py] !== "?") continue;
      // Prefer ground the AI does not yet fully control: reward adjacent
      // contested/ours cells, penalise adjacent AI-controlled ones.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const c = contested[nx][ny];
          if (c === SPHYX_YOU) openness--;
          else if (c === "?" || c === SPHYX_ME) openness++;
        }
      }
    }
    // Single-stone bait only: never merge into one of our groups.
    let touchesFriendly = false;
    const base = p * 4;
    for (let k = 0; k < 4; k++) {
      const n = Y19_NEIGH[base + k];
      if (n < 0) break;
      if (cells[n] === attacker) { touchesFriendly = true; break; }
    }
    if (touchesFriendly) continue;
    const placed = y19TryPlay(cells, p, attacker);
    if (!placed || placed.captured > 0) continue;
    // TWO-liberty bait only: the AI is forced to reduce it to one liberty, then
    // capture next turn. A one-lib self-atari bait is never made here.
    if (y19GroupLibs(placed.cells, p) !== 2) continue;
    const baitKey = y19Key(placed.cells);
    if (history.has(baitKey)) continue;
    tried++;
    // The AI must be FORCED to reduce the bait to exactly one liberty.
    history.add(baitKey);
    const legal = y19LegalChildren(placed.cells, defender, history);
    const policy = y19ResolveUnknownOpponentPolicy(
      placed.cells, legal.map(child => child.point), defender, false
    );
    const reply = policy.forced
      ? legal.find(child => child.point === policy.forcedPosition)
      : null;
    const after = reply && reply.cells[p] === attacker
      ? y19CollectCurrentGroup(reply.cells, [p], attacker)
      : null;
    const forcedOk = !!after && after.liberties.length === 1;
    history.delete(baitKey);
    if (!forcedOk) continue;
    candidates.push({ point: p, openness });
  }
  if (!candidates.length) return [];
  // In contested mode, prefer the least AI-controlled ground.
  candidates.sort((a, b) => b.openness - a.openness || a.point - b.point);
  const best = candidates[0];
  BAITED = best.point;
  y19BaitOwner = "createBait";
  return {
    coords: [(best.point / size) | 0, best.point % size],
    msg: "Create bait: 2-lib " + (contestedOnly ? "enemy" : "contested"),
  };
}

// KILL THE EYESPACE (nakade / vital point): find an enemy group whose ONLY eye
// hope is a single 4-6 point eyespace that could still make two eyes, and play
// the vital point inside it so it never can. The offensive mirror of createEyes.
function killEyeSpace(minGroupSize = 4) {
  if (!Y19_KILL_EYESPACE) return [];
  const board = sphyxBoard, size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const attacker = Y19_BLACK, defender = Y19_WHITE;
  const analysis = y19SourceAnalysis(cells);
  const defenderEyes = y19SourceEyesByGroup(analysis, defender);
  const rootKey = y19Key(cells);
  const options = [];
  for (const candidate of y19SourcePotentialEyes(analysis, defender, 6)) {
    const region = candidate.group.points;
    if (region.length < 3 || region.length > 6) continue;
    const owners = new Set(candidate.neighbors.map(group => group.id));
    if (owners.size !== 1) continue;
    const owner = candidate.neighbors[0];
    if (owner.color !== defender ||
      owner.points.length < minGroupSize ||
      (defenderEyes.get(owner.id)?.length ?? 0) >= 2) continue;
    // Only nakade a shape that is still ALIVE-ABLE — a group already unable to
    // make two eyes needs no move.
    if (!y19CanGroupMakeTwoEyes(cells, owner.points, defender)) continue;
    // Vital point: our stone there and the group can no longer make two eyes.
    for (const vital of region) {
      const played = y19TryPlay(cells, vital, attacker);
      if (!played || played.captured > 0 || y19Key(played.cells) === rootKey) continue;
      if (!y19CanGroupMakeTwoEyes(played.cells, owner.points, defender)) {
        options.push({ point: vital, size: owner.points.length, region: region.length });
        break;
      }
    }
  }
  if (!options.length) return [];
  options.sort((a, b) =>
    b.size - a.size || a.region - b.region || a.point - b.point);
  const best = options[0];
  return {
    coords: [(best.point / size) | 0, best.point % size],
    msg: "Kill eyespace: " + best.size + " stones",
  };
}

// PREP LADDER (Y19_PREP_LADDER): stake a ladder for NEXT turn. Fill one
// liberty of the LARGEST three-liberty enemy group (no two eyes, not already
// dead) so it stands at two liberties — a ladder-maker target — but only when
// OUR fill stone is safe: at least `minSurround` empty orthogonal sides when
// it is a lone stone, or `minSurround` liberties on the merged group when it
// connects to one of our own chains. The offensive ladder maker (top of the
// cascade) re-proves and fires the actual ladder next turn.
function prepLadder(minSurround = 3) {
  if (!Y19_PREP_LADDER) return [];
  const board = sphyxBoard, validMove = sphyxValidMove;
  const size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);
  const attacker = Y19_BLACK, defender = Y19_WHITE;
  const analysis = y19SourceAnalysis(cells);
  const eyes = y19SourceEyesByGroup(analysis, defender);
  const history = new Set(sphyxHistorySet);
  history.add(y19Key(cells));
  const minStones = Math.max(1, Math.floor(Y19_PREP_LADDER_MIN_STONES));
  const prepGroups = analysis.groups
    .filter(group =>
      group.color === defender &&
      group.points.length >= minStones &&
      group.liberties.length === 3 &&
      (eyes.get(group.id)?.length ?? 0) < 2 &&
      !y19TargetIsEffectivelyDead(
        cells,
        { stones: group.points, liberties: group.liberties },
        defender,
        history
      ))
    .sort((a, b) => b.points.length - a.points.length);
  for (const group of prepGroups) {
    let best = null;
    for (const liberty of group.liberties) {
      const lx = (liberty / size) | 0, ly = liberty % size;
      if (!validMove[lx][ly]) continue;
      const fill = y19TryPlay(cells, liberty, attacker);
      if (!fill || fill.captured > 0) continue;
      // the fill must leave the enemy group at exactly two liberties
      const reduced = y19CollectCurrentGroup(fill.cells, group.points, defender);
      if (!reduced || reduced.liberties.length !== 2) continue;
      // is our fill stone connected to one of our own chains?
      let connects = false;
      const base = liberty * 4;
      for (let k = 0; k < 4; k++) {
        const n = Y19_NEIGH[base + k];
        if (n < 0) break;
        if (cells[n] === attacker) { connects = true; break; }
      }
      // safety: merged liberties when connected, else empty sides (the lone
      // stone's own liberties). getSurroundSpace reads the pre-fill board, so
      // it counts exactly the empty neighbours the placed stone will hold.
      const safety = connects
        ? y19GroupLibs(fill.cells, liberty)
        : getSurroundSpace(lx, ly);
      if (safety < minSurround) continue;
      if (!best || safety > best.safety) {
        best = { x: lx, y: ly, safety };
      }
    }
    if (best) {
      return {
        coords: [best.x, best.y],
        msg: "Prep ladder: " + group.points.length + " stones",
      };
    }
  }
  return [];
}

function createEyes(currentEyes = -1, minGroupSize = 6, contestedOnly = true, liberties = -1) {
  // Eye builder: on our largest group holding exactly `currentEyes` known good
  // eyes, play the stone that makes the most new eyes (two if it partitions an
  // eye space). Groups with more eyes, or smaller than minGroupSize, are skipped.
  // Gains are simulation-verified and never leave the group or stone in atari.
  // contestedOnly (default) confines the stone to contested ('?') space — no
  // filling our own territory to manufacture eyes.
  const board = sphyxBoard, validMove = sphyxValidMove, chains = sphyxChains, me = SPHYX_ME;
  const contested = sphyxContested;
  const size = board[0].length;
  y19Configure(size);
  const cells = y19CellsFromBoard(board);

  //Our chains holding exactly currentEyes known good eyes, largest first.
  const seenChains = new Set();
  const groups = [];
  for (let x = 0; x < size; x++)
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== me || seenChains.has(chains[x][y])) continue;
      seenChains.add(chains[x][y]);
      const anchor = x * size + y;
      const libs = y19GroupLibs(cells, anchor);
      if (liberties > 0 && liberties !== libs) continue
      const stones = Y19_GROUP_LEN;
      if (stones < minGroupSize) continue;
      const knownGoodEyes = y19ChainKnownGoodEyes(cells, anchor)
      if (currentEyes > 0 && knownGoodEyes !== currentEyes) continue;
      else if (currentEyes === -1) currentEyes = knownGoodEyes
      groups.push({ anchor, stones });
    }
  if (!groups.length) return [];
  groups.sort((a, b) => b.stones - a.stones);

  for (const group of groups) {
    //Candidates: legal empties within Chebyshev 2 of the group's stones.
    y19GroupLibs(cells, group.anchor);
    const stones = [];
    for (let i = 0; i < Y19_GROUP_LEN; i++) stones.push(Y19_GROUP[i]);
    const candidates = new Set();
    const targetChainId = chains[(group.anchor / size) | 0][group.anchor % size];
    for (const p of stones) {
      const px = (p / size) | 0, py = p % size;
      //normal build zone, plus a one-step-wider ring for CONNECTORS: a point
      //out there qualifies only when it touches a DIFFERENT friendly chain,
      //so merging that chain (and its eyes) into the group stays reachable.
      for (let dx = -3; dx <= 3; dx++) {
        for (let dy = -3; dy <= 3; dy++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (board[nx][ny] !== "." || !validMove[nx][ny]) continue;
          //contestedOnly: never spend a stone building eyes inside territory
          //we already control — only contested points qualify.
          if (contestedOnly && contested[nx][ny] !== "?") continue;
          if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) {
            candidates.add(nx * size + ny);
            continue;
          }
          let touchesOtherChain = false;
          for (const [ax, ay] of [[nx - 1, ny], [nx + 1, ny], [nx, ny - 1], [nx, ny + 1]]) {
            if (ax < 0 || ay < 0 || ax >= size || ay >= size) continue;
            if (board[ax][ay] === me && chains[ax][ay] !== targetChainId) {
              touchesOtherChain = true;
              break;
            }
          }
          if (touchesOtherChain) candidates.add(nx * size + ny);
        }
      }
    }
    let bestGain = 0;
    const moveOptions = [];
    for (const p of candidates) {
      const sim = y19TryPlay(cells, p, Y19_BLACK);
      if (!sim) continue;
      //never buy an eye with atari: the group and the placed stone must both
      //hold 2+ liberties afterwards
      if (y19GroupLibs(sim.cells, group.anchor) < 2) continue;
      if (y19GroupLibs(sim.cells, p) < 2) continue;
      const gain = y19ChainKnownGoodEyes(sim.cells, group.anchor) - currentEyes;
      if (gain <= 0) continue;
      if (gain > bestGain) {
        bestGain = gain;
        moveOptions.length = 0;
        moveOptions.push([(p / size) | 0, p % size]);
      }
      else if (gain === bestGain) {
        moveOptions.push([(p / size) | 0, p % size]);
      }
    }
    if (moveOptions.length) {
      const pick = moveOptions[Math.floor(Math.random() * moveOptions.length)];
      return {
        coords: pick,
        msg: "Create Eyes: " + currentEyes + " -> " + (currentEyes + bestGain) + " (" + group.stones + " stones)"
      };
    }
  }
  return [];
}



// OPENING BAIT points: the far-left and far-right one-cell corridors whose
// top cell is a dead end — the second-from-top cell connects only up and
// down. Detected structurally (never fires on boards without the corridor
// shape) and only offered while the cell itself AND the cells above and
// below are free.
function y19OpeningBaitPoints() {
  const board = sphyxBoard, size = board[0].length;
  const tops = [];
  for (const x of [0, size - 1]) {
    const inner = x === 0 ? 1 : size - 2;
    let top = -1;
    for (let y = size - 1; y >= 0; y--) {
      if (board[x][y] !== "#") { top = y; break; }
    }
    if (top >= 2) {
      const bait = top - 1;
      // corridor shape: the inner column is offline beside both cells (they
      // connect only vertically), so the top cell is a dead end
      if (board[inner][top] === "#" && board[inner][bait] === "#" &&
        board[x][top] === "." && board[x][bait] === "." &&
        board[x][bait - 1] === ".") {
        tops.push([x, bait]);
      }
    }
  }
  return tops;
}

// The bitverse board is a FIXED shape with offline (#) nodes, so 9 of the 17
// classic star points can't pass the four-empty-neighbours test. Each ideal is
// resolved against the WALL LAYOUT ONLY (stones ignored -> deterministic) by
// sliding ring by ring (Chebyshev <= 2, toward centre) to the nearest clean
// spot; the live occupied/cramped test then applies to that resolved point.
function y19OpeningPointIsStructural(x, y) {
  const board = sphyxBoard, size = board[0].length;
  if (x <= 0 || y <= 0 || x >= size - 1 || y >= size - 1) return false;
  return board[x][y] !== "#" &&
    board[x - 1][y] !== "#" &&
    board[x + 1][y] !== "#" &&
    board[x][y - 1] !== "#" &&
    board[x][y + 1] !== "#";
}

function y19ResolveOpeningPoint(idealX, idealY) {
  const size = sphyxBoard[0].length;
  const center = (size - 1) / 2;
  for (let radius = 0; radius <= 2; radius++) {
    const ring = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = idealX + dx, y = idealY + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        ring.push([x, y]);
      }
    }
    ring.sort((a, b) =>
      (Math.abs(a[0] - center) + Math.abs(a[1] - center)) -
      (Math.abs(b[0] - center) + Math.abs(b[1] - center)) ||
      a[0] - b[0] ||
      a[1] - b[1]);
    for (const [x, y] of ring) {
      if (y19OpeningPointIsStructural(x, y)) return [x, y];
    }
  }
  return null;
}

// Are any of our chains ENGAGED? A framework (opening) stone waits only while
// a chain is genuinely short of breath: <= Y19_OPENING_ENGAGED_LIBS liberties
// (default 2). A three-liberty attachment exchange no longer pauses the
// opening — the win rate rises with completed opening stones, and the cascade
// answers real pressure once it reaches two liberties.
// Is this chain one of our OPENING BAIT sacrifices? Bait stones must NEVER be
// saved — not by libDefend, not by counterLib, not by bolster: rescuing them
// un-baits the trap and wastes the move (the in-game leak showed up as 8
// "Last liberty rescue (1 freed)" fires in the first bait run).
function sphyxIsOpeningBaitChain(chainId) {
  if (chainId == null || chainId < 0 || !sphyxOpeningBaitPlaced.length) {
    return false;
  }
  const board = sphyxBoard, chains = sphyxChains, me = SPHYX_ME;
  const size = board[0].length;
  for (const point of sphyxOpeningBaitPlaced) {
    const bx = (point / size) | 0, by = point % size;
    if (board[bx]?.[by] === me && chains[bx][by] === chainId) return true;
  }
  return false;
}

function sphyxOpeningEngaged() {
  const threshold = Math.max(0, Math.floor(Y19_OPENING_ENGAGED_LIBS));
  if (!threshold) return false;
  const board = sphyxBoard, validLibMoves = sphyxValidLibMoves, chains = sphyxChains, me = SPHYX_ME;
  const size = board[0].length;
  // The corridor bait chains never pause the opening: they are sacrifices,
  // and their whole purpose is to be attacked while we open elsewhere.
  const baitChains = new Set();
  for (const point of sphyxOpeningBaitPlaced) {
    const bx = (point / size) | 0, by = point % size;
    if (board[bx]?.[by] === me) baitChains.add(chains[bx][by]);
  }
  const seen = new Set();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      if (board[x][y] !== me || seen.has(chains[x][y])) continue;
      seen.add(chains[x][y]);
      if (baitChains.has(chains[x][y])) continue;
      if (validLibMoves[x][y] <= threshold) return true;
    }
  }
  return false;
}

function getOpeningMove() {
  const validMove = sphyxValidMove;
  const size = sphyxBoard[0].length;
  if (size !== 19) return getRandomStrat();
  // The corridor BAIT stones come first for any/all opening styles and sets:
  // left corridor, then right. Each is offered only while its cell and the
  // cells above and below are free (occupied later = consumed, like a list
  // entry).
  if (Y19_OPENING_BAIT) {
    for (const [x, y] of y19OpeningBaitPoints()) {
      if (validMove[x][y]) {
        return { coords: [x, y], msg: "Opening bait", bait: true };
      }
    }
  }
  // Claim the first star point (classic list) that is empty with all four
  // orthogonal neighbours empty (a clean, uncontested framework stone). The
  // "original" style tests the RAW ideal points (the 89.6% baseline
  // behavior); the other styles slide each ideal to the bitverse layout
  // first. Return null once none remain so the fighting cascade takes over.
  const useRawPoints = Y19_OPENING_STYLE === "original";
  for (const [idealX, idealY] of Y19_OPENING_POINTS) {
    const point = useRawPoints
      ? [idealX, idealY]
      : y19ResolveOpeningPoint(idealX, idealY);
    if (!point) continue;
    const [x, y] = point;
    if (getSurroundSpace(x, y) === 4 && validMove[x][y]) {
      return { coords: [x, y], msg: "Opening Move: " + sphyxTurn };
    }
  }
  return null;
}

// --- executors: play the chosen action through the real game API ---
async function sphyxMovePiece(ns, attack) {
  if (!attack || attack.coords === undefined) return null;
  const [x, y] = attack.coords;
  if (x === undefined) return null;
  try {
    return await ns.go.makeMove(x, y, !isBlack);
  } catch {
    return null; // rejected move: let the cascade continue
  }
}
async function sphyxSnakeEyes(ns, attack) {
  if (!attack || attack.coords === undefined || !CHEATS_ENABLED) return null;
  const [s1x, s1y, s2x, s2y] = attack.coords;
  if (s1x === undefined) return null;
  try {
    // Framework gate: the original accepted >= 0.7 — here the shared
    // CHEAT_MIN_SUCCESS_CHANCE floor governs all cheat use.
    const playAsWhite = !isBlack;
    const chanceBefore = readCheatSuccessChance(ns, playAsWhite);
    if (chanceBefore < CHEAT_MIN_SUCCESS_CHANCE) return null;
    const countBefore = await readCheatCount(ns, playAsWhite);
    const response = await proxy(ns, "go.cheat.playTwoMoves",
      s1x,
      s1y,
      s2x,
      s2y,
      playAsWhite
    );
    return {
      response,
      telemetry: {
        type: "cheat",
        kind: "playTwoMoves/SnakeEyes",
        coords: [s1x, s1y, s2x, s2y],
        countBefore,
        countAfter: await readCheatCount(ns, playAsWhite),
        chanceBefore,
        chanceAfter: readCheatSuccessChance(ns, playAsWhite),
      },
    };
  }
  catch { return null; }
}
async function sphyxWallBreaker(ns, attack) {
  if (!attack || attack.coords === undefined || !CHEATS_ENABLED) return null;
  const [s1x, s1y] = attack.coords;
  if (s1x === undefined) return null;
  const playAsWhite = !isBlack;
  const chanceBefore = readCheatSuccessChance(ns, playAsWhite);
  if (chanceBefore < CHEAT_MIN_SUCCESS_CHANCE) return null;
  const countBefore = await readCheatCount(ns, playAsWhite);
  // removeRouter clears an enemy STONE (cell -> '.'); destroyNode makes an
  // empty node permanently dead (cell -> '#'). getWallBreaker tags which.
  const useRouter = attack.action === "removeRouter";
  const response = useRouter
    ? await proxy(ns, "go.cheat.removeRouter", s1x, s1y, playAsWhite)
    : await proxy(ns, "go.cheat.destroyNode", s1x, s1y, playAsWhite);
  if (!response) return null
  const boardState = await proxy(ns, "go.getBoardState")
  const afterCell = boardState[s1x]?.[s1y];
  return {
    response,
    telemetry: {
      type: "cheat",
      kind: useRouter ? "removeRouter/WallBreaker" : "destroyNode/WallBreaker",
      coords: [s1x, s1y],
      countBefore,
      countAfter: await readCheatCount(ns, playAsWhite),
      chanceBefore,
      chanceAfter: readCheatSuccessChance(ns, playAsWhite),
      // At our 100% gate the cheat always applies. removeRouter's cell then
      // reads '.' unless the AI's reply refilled it (which the forced
      // follow-up abandons); destroyNode's target is a permanent '#'.
      verified: useRouter
        ? afterCell !== (isBlack ? "O" : "X")
        : afterCell === "#",
    },
  };
}

function sphyxBuildCascadeSteps() {
  const steps = [
    { routerKillFollowUp: true },
    () => getRandomCounterLib(),
    () => getRandomLibAttack(88),
    () => getRandomLibDefend(),
    { ladderContinuation: true },
    { baitFollowUp: true },
    { semeai: true, followUpOnly: true },
    { ladderMaker: true }, //Super strong
    { snakeEyes: () => getSnakeEyes(12) },
    () => getAggroAttack(2, 2, 2),
    { semeai: true },
    () => createBait(true),
    () => killEyeSpace(),
    () => createEyes(1),
    () => prepLadder(3),
    () => getDefPattern(),
    () => getAggroAttack(3, 4, 3),
    () => getRandomBolster(2, 1),
    () => getDefAttack(5, 7, 3),
    () => attackGrowDragon(1),
    () => getRandomExpand(),
    () => getRandomBolster(2, 1, false),
    () => getRandomLibAttack(1, 0),
    () => getRandomStrat(),
    { routerKill: true },
    { comboCheat: () => comboCheat(1) },
  ];
  return steps;
}

// The "??????" style cascade, in the original priority order. Each step that
// yields an executable action ends the turn; nothing left means pass.
async function sphyxPlayTurn(
  ns,
  historyKeys,
  readSemeai = null,
  semeaiActive = false,
  y19Reads = null
) {
  sphyxTurn++;
  const rows = await proxy(ns, "go.getBoardState")
  if (sphyxTurn === 1) {
    // Resumed mid-game: skip the whole opening phase (we already have stones).
    for (const row of rows) {
      if (row.includes(SPHYX_ME)) {
        sphyxTurn = Y19_OPENING_MOVES + 1;
        sphyxOpeningPlaced = Y19_OPENING_MOVES;
        break;
      }
    }
  }
  sphyxAnalyzeBoard(rows, new Set(historyKeys));
  // Release a stale createBait guard early each turn: the sacrifice has no fill
  // follow-up, so keep BAITED only while it is a live one-liberty provocation
  // to shield from libDefend. Once the AI took it (gone) or ignored it (still
  // >= 2 liberties, nothing to shield), clear the guard so a fresh bait — of any
  // kind — can start again.
  if (BAITED != null && y19BaitOwner === "createBait") {
    const size = rows.length;
    const bx = (BAITED / size) | 0, by = BAITED % size;
    let libs = -1;
    if (rows[bx]?.[by] === SPHYX_ME) {
      libs = 0;
      if (bx > 0 && rows[bx - 1][by] === ".") libs++;
      if (bx < size - 1 && rows[bx + 1][by] === ".") libs++;
      if (by > 0 && rows[bx][by - 1] === ".") libs++;
      if (by < size - 1 && rows[bx][by + 1] === ".") libs++;
    }
    if (libs !== 1) { BAITED = null; y19BaitOwner = null; }
  }
  // A higher-priority rescue may be the exact stored ladder response. Peek
  // without changing the plan so that move can still be recorded as the
  // ladder terminal after it executes.
  const pendingLadder = y19LadderPlan
    ? y19ResolveLadderContinuation(rows, historyKeys, false)
    : null;
  let result;
  // Opening gate by style: "original"/"resolved" attempt one opening move per
  // turn for the first Y19_OPENING_MOVES turns (the baseline gating);
  // "engaged" counts PLACEMENTS and yields to fights (any own chain at
  // <= Y19_OPENING_ENGAGED_LIBS liberties), resuming when safe within a 2x
  // turn window.
  const openingWanted = Y19_OPENING_STYLE === "engaged"
    ? sphyxOpeningPlaced < Y19_OPENING_MOVES &&
    sphyxTurn <= Y19_OPENING_MOVES * 2 &&
    !sphyxOpeningEngaged()
    : sphyxTurn <= Y19_OPENING_MOVES;
  if (openingWanted) {
    const opening = getOpeningMove();
    if (opening && (result = await sphyxMovePiece(ns, opening))) {
      sphyxOpeningPlaced++;
      if (opening.bait) {
        sphyxOpeningBaitPlaced.push(
          opening.coords[0] * rows.length + opening.coords[1]
        );
      }
      return {
        response: result,
        msg: (opening.bait ? "Opening bait: " : "Opening Move: ") +
          sphyxOpeningPlaced,
      };
    }
  }
  const steps = sphyxBuildCascadeSteps();
  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const step = steps[stepIndex];
    if (typeof step === "function") {
      const attack = step();
      if (result = await sphyxMovePiece(ns, attack)) {
        const followsLadder = pendingLadder &&
          attack?.coords?.[0] === pendingLadder.coords[0] &&
          attack?.coords?.[1] === pendingLadder.coords[1]
          ? y19ResolveLadderContinuation(rows, historyKeys, true)
          : null;
        const ladderTerminal = followsLadder?.telemetry?.terminal;
        return {
          response: result,
          coords: attack.coords,
          msg: ladderTerminal ? followsLadder.msg : attack.msg,
          detail: ladderTerminal
            ? attack.msg
            : semeaiActive && stepIndex < Y19_OWN_FORCED_PREFIX
              ? "semeai forced continuation"
              : null,
          telemetry: followsLadder?.telemetry ?? null,
        };
      }
    } else if (step.ladderContinuation) {
      const attack = y19ResolveLadderContinuation(rows, historyKeys);
      if (attack && (result = await sphyxMovePiece(ns, attack))) {
        return {
          response: result,
          coords: attack.coords,
          msg: attack.msg,
          telemetry: attack.telemetry,
        };
      }
    } else if (step.baitFollowUp) {
      const attack = y19ResolveBaitFollowUp(rows);
      if (attack && (result = await sphyxMovePiece(ns, attack))) {
        return {
          response: result,
          coords: attack.coords,
          msg: attack.msg,
          telemetry: attack.telemetry,
        };
      }
    } else if (step.routerKillFollowUp) {
      const attack = y19ResolveRouterKill(rows);
      if (attack && (result = await sphyxMovePiece(ns, attack))) {
        return {
          response: result,
          coords: attack.coords,
          msg: attack.msg,
          telemetry: attack.telemetry,
        };
      }
    } else if (step.semeai) {
      if (!readSemeai) continue;
      const attack = await readSemeai(rows, historyKeys, step.followUpOnly);
      if (attack && (result = await sphyxMovePiece(ns, attack))) {
        return {
          response: result,
          coords: attack.coords,
          msg: attack.msg,
          telemetry: attack.telemetry ?? null,
        };
      }
    } else if (step.ladderMaker) {
      if (semeaiActive) continue;
      const attackerColor = isBlack ? Y19_BLACK : Y19_WHITE;
      // While our createBait sits in atari with the AI committed to capturing
      // it next turn, this move is FREE — spend it converting a 3-liberty
      // group into tomorrow's winning ladder instead of skipping the step.
      const capturePending = Y19_LADDER_BAIT
        ? y19CreateBaitCapturePending(rows, historyKeys)
        : null;
      if (y19BaitIsActive() && !capturePending) continue;
      const ladder = capturePending
        ? await y19FindLadderFillConversion(
          rows,
          historyKeys,
          attackerColor,
          capturePending,
          y19Reads
        )
        : await y19FindLadderMoveBalanced(
          rows,
          historyKeys,
          attackerColor,
          y19Reads
        );
      if (!ladder) continue;
      if (ladder.fillConversion) {
        const attack = {
          coords: [
            (ladder.firstMove / rows.length) | 0,
            ladder.firstMove % rows.length,
          ],
          msg: "Ladder bait fill: " + ladder.targetSize +
            " stones, ladder after the capture",
          telemetry: {
            type: "ladderBaitFill",
            targetStones: ladder.targetStones,
            targetSize: ladder.targetSize,
          },
        };
        if (result = await sphyxMovePiece(ns, attack)) {
          return {
            response: result,
            coords: attack.coords,
            msg: attack.msg,
            telemetry: attack.telemetry,
          };
        }
        continue;
      }
      if (ladder.bait && y19BaitIsActive()) continue;
      const ladderPlan = ladder.bait
        ? null
        : y19BuildLadderContinuationPlan(
          rows,
          historyKeys,
          ladder,
          isBlack ? Y19_BLACK : Y19_WHITE
        );
      if (!ladder.bait && !ladderPlan) continue;
      const attack = {
        coords: [
          (ladder.firstMove / rows.length) | 0,
          ladder.firstMove % rows.length,
        ],
        msg: ladder.bait
          ? "Ladder bait: " + ladder.targetSize + " stones, fill (" +
          ((ladder.followUpMove / rows.length) | 0) + "," +
          (ladder.followUpMove % rows.length) + ")"
          : "Ladder maker: " + ladder.targetSize +
          " stones, " + ladder.extensions + " forced extensions",
        telemetry: {
          type: ladder.bait ? "ladderBait" : "ladderMaker",
          targetStones: ladder.targetStones,
          targetSize: ladder.targetSize,
          predictedLine: ladder.line,
          predictedCapture: ladder.capturedInRead,
        },
      };
      if (result = await sphyxMovePiece(ns, attack)) {
        if (ladderPlan) y19LadderPlan = ladderPlan;
        if (ladder.bait) y19ArmBait(
          "ladder",
          ladder.firstMove,
          ladder.expectKey,
          ladder.followUpMove
        );
        return {
          response: result,
          coords: attack.coords,
          msg: attack.msg,
          telemetry: attack.telemetry,
        };
      }
    } else if (step.snakeEyes) {
      const attack = step.snakeEyes();
      const cheat = await sphyxSnakeEyes(ns, attack);
      if (cheat) {
        return {
          response: cheat.response,
          msg: attack.msg,
          telemetry: cheat.telemetry,
        };
      }
    } else if (step.wallBreaker) {
      const attack = step.wallBreaker();
      const cheat = await sphyxWallBreaker(ns, attack);
      if (cheat) {
        return {
          response: cheat.response,
          msg: attack.msg,
          telemetry: cheat.telemetry,
        };
      }
    } else if (step.comboCheat) {
      const attack = step.comboCheat();
      if (!attack || !attack.coords) continue;
      const cheat = attack.kind === "snakeEyes"
        ? await sphyxSnakeEyes(ns, attack)
        : await sphyxWallBreaker(ns, attack);
      if (cheat) {
        return {
          response: cheat.response,
          msg: attack.msg,
          telemetry: cheat.telemetry,
        };
      }
    } else if (step.routerKill) {
      const cut = y19FindRouterEyeKill();
      if (!cut) continue;
      const size = rows.length;
      const attack = {
        coords: [(cut.removeAt / size) | 0, cut.removeAt % size],
        action: "removeRouter",
        stones: cut.groupSize,
        msg: "WallBreaker Cheat: eye-kill setup (removeRouter), " +
          cut.groupSize + "-stone " + cut.eyes + "-eye group",
      };
      const cheat = await sphyxWallBreaker(ns, attack);
      if (cheat) {
        // MUST occupy the vacated point next turn (top-of-list follow-up).
        y19RouterKill = cut.removeAt;
        return {
          response: cheat.response,
          msg: attack.msg,
          telemetry: cheat.telemetry,
        };
      }
    }
  }
  result = await ns.go.passTurn(!isBlack);
  return { response: result, msg: "Turn Passed" };
}

// Balanced ladder move: the direct 2-liberty reads are split evenly across the
// worker pool (round-robin, no read duplicated); the sequential host reader is
// the drop-in fallback whenever distribution is unavailable. The self-made
// bait scan keeps its existing host-side tail behavior.
async function y19FindLadderMoveBalanced(board, historyKeys, attacker, y19Reads) {
  if (!y19Reads || !y19Reads.available()) {
    return y19FindLadderMaker(
      board,
      historyKeys,
      attacker,
      Y19_LADDER_MAKER_MAX_MOVES,
      Y19_LADDER_MAKER_NODE_LIMIT,
      Y19_LADDER_MAKER_CASCADE_POSITION
    );
  }
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const analysis = y19SourceAnalysis(cells);
  const eyes = y19SourceEyesByGroup(analysis, defender);
  const tasks = [];
  const groupsByTask = [];
  const ladderGroups = analysis.groups
    .filter(group =>
      group.color === defender &&
      group.liberties.length === 2 &&
      (eyes.get(group.id)?.length ?? 0) < 2)
    .sort((a, b) => b.points.length - a.points.length);
  for (const group of ladderGroups) {
    for (const liberty of group.liberties) {
      groupsByTask.push(group);
      tasks.push({
        kind: "ladder",
        index: tasks.length,
        groupPoints: group.points.slice(),
        liberty,
        // weight fields for the semeai-style bucket builder: bigger targets
        // read longer lines and get spare lanes first.
        targetSize: group.points.length,
        ownSize: 0,
        targetLiberties: 2,
        ownLiberties: 1,
      });
    }
  }
  if (tasks.length) {
    // SAME LANE STRUCTURE AS SEMEAI when readLanes=on: lanes engage only when
    // tasks < workers, so every bucket is a single lane item with its own
    // request and full node budget (a packed bucket shares budgets
    // first-come-first-served and starves lanes — the first lanes
    // regression). readLanes=off (default) = plain round-robin.
    const workerCount = Math.max(1, y19Reads.workerCount?.() ?? 1);
    const buckets = Y19_READ_LANES && tasks.length < workerCount
      ? y19BuildSemeaiWorkerBuckets(tasks, workerCount)
      : null;
    const laneItems = buckets ? buckets.flat() : tasks;
    const replies = await y19Reads.tactical(
      board,
      historyKeys,
      attacker,
      laneItems,
      buckets
    );
    // Lane join is OR (chases are our choice): any winning lane proves the
    // task; prefer the captured/shortest lane line, then sort as before.
    const lanesByTask = new Map();
    for (const reply of replies) {
      for (const result of reply?.results ?? []) {
        if (!result.ok || result.kind !== "ladder") continue;
        let list = lanesByTask.get(result.index);
        if (!list) lanesByTask.set(result.index, list = []);
        list.push(result);
      }
    }
    const candidates = [];
    for (const [taskIndex, laneHits] of lanesByTask) {
      laneHits.sort((a, b) =>
        +b.captured - +a.captured ||
        (Y19_LADDER_MAXIMIZE
          ? b.line.length - a.line.length
          : a.line.length - b.line.length) ||
        (a.laneIndex ?? 0) - (b.laneIndex ?? 0)
      );
      const best = laneHits[0];
      const group = groupsByTask[taskIndex];
      candidates.push({
        firstMove: best.firstMove,
        targetStones: group.points.slice(),
        targetSize: group.points.length,
        line: best.line,
        extensions: best.extensions,
        capturedInRead: best.captured,
      });
    }
    candidates.sort(y19LadderCandidateCompare);
    if (candidates.length) return candidates[0];
  }
  // No direct ladder: self-made bait scan, unchanged from the sequential
  // reader (host-side — it already verifies every reachable defender reply).
  if (Y19_LADDER_BAIT && !y19BaitIsActive()) {
    const budget = { nodes: Math.max(1, Math.floor(Y19_LADDER_MAKER_NODE_LIMIT)) };
    const ownForcedPrefix = Math.max(
      0,
      Math.min(3, Math.floor(Y19_LADDER_MAKER_CASCADE_POSITION))
    );
    const baitGroups = analysis.groups
      .filter(group =>
        group.color === defender &&
        group.points.length >= 2 &&
        group.liberties.length === 3 &&
        (eyes.get(group.id)?.length ?? 0) < 2)
      .sort((a, b) => b.points.length - a.points.length);
    for (const group of baitGroups) {
      if (budget.nodes <= 0) break;
      if (y19TargetIsEffectivelyDead(
        cells,
        { stones: group.points, liberties: group.liberties },
        defender,
        history
      )) continue;
      const bait = y19FindLadderBait(
        cells, group, attacker, defender, history,
        Y19_LADDER_MAKER_MAX_MOVES, budget, ownForcedPrefix
      );
      if (bait) return bait;
    }
  }
  return null;
}

// Bait-capture ladder conversion (gated by Y19_LADDER_BAIT at the call site):
// the AI is committed to capturing our live bait stone next turn, so THIS
// stone is free — fill one liberty of a 3-liberty group (3 -> 2) whenever the
// post-capture group is a proven winning ladder. The checks are distributed
// across the worker pool; each verifies the AI still captures the bait after
// our fill before reading the ladder.
async function y19FindLadderFillConversion(
  board,
  historyKeys,
  attacker,
  pending,
  y19Reads
) {
  y19Configure(board.length);
  const cells = y19CellsFromBoard(board);
  const defender = attacker === Y19_BLACK ? Y19_WHITE : Y19_BLACK;
  const history = new Set(historyKeys);
  history.add(y19Key(cells));
  const analysis = y19SourceAnalysis(cells);
  const eyes = y19SourceEyesByGroup(analysis, defender);
  const tasks = [];
  const groupsByTask = [];
  const fillGroups = analysis.groups
    .filter(group =>
      group.color === defender &&
      group.liberties.length === 3 &&
      (eyes.get(group.id)?.length ?? 0) < 2 &&
      !y19TargetIsEffectivelyDead(
        cells,
        { stones: group.points, liberties: group.liberties },
        defender,
        history
      ))
    .sort((a, b) => b.points.length - a.points.length);
  for (const group of fillGroups) {
    if (tasks.length >= 24) break;
    for (const liberty of group.liberties) {
      if (tasks.length >= 24) break;
      groupsByTask.push(group);
      tasks.push({
        kind: "ladderFill",
        index: tasks.length,
        groupPoints: group.points.slice(),
        liberty,
        baitPoint: pending.baitPoint,
      });
    }
  }
  if (!tasks.length) return null;
  const replies = y19Reads
    ? await y19Reads.tactical(board, historyKeys, attacker, tasks)
    : [y19RunTacticalReadTasks({
      type: "y19TacticalRead",
      board,
      historyKeys,
      attackerColor: attacker,
      ownForcedPrefix: Math.max(
        0,
        Math.min(3, Math.floor(Y19_LADDER_MAKER_CASCADE_POSITION))
      ),
      maximumMoves: Y19_LADDER_MAKER_MAX_MOVES,
      nodeLimit: Y19_LADDER_MAKER_NODE_LIMIT,
      tasks,
    })];
  const hits = [];
  for (const reply of replies) {
    for (const result of reply?.results ?? []) {
      if (!result.ok) continue;
      const group = groupsByTask[result.index];
      hits.push({
        firstMove: result.firstMove,
        targetStones: group.points.slice(),
        targetSize: group.points.length,
      });
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.targetSize - a.targetSize || a.firstMove - b.firstMove);
  return { fillConversion: true, ...hits[0] };
}

/** @param {NS} ns */
async function getCommands(ns, oneCycleOnly = false) {
  while (true) {
    let changed = false
    let silent = false
    while (ns.peek(15) !== "NULL PORT DATA") {
      changed = true
      const command = ns.readPort(15)
      if (command.startsWith("Effort:")) {
        setIPvGoEffort(ns, command.slice("Effort:".length))
        if (!silent) ns.tprintf("IPvGo: Effort set to %s.", EFFORT)
        continue
      }
      else if (command.startsWith("Memory:")) {
        setIPvGoMemory(ns, command.slice("Memory:".length))
        if (!silent) ns.tprintf("IPvGo: Memory set to %s.", MEMORY_USE)
        continue
      }
      else if (command.startsWith("Threads:")) {
        setIPvGoThreads(ns, command.slice("Threads:".length))
        if (!silent) ns.tprintf("IPvGo: Threads set to %s; applies at the next move boundary.", THREAD_SETTING)
        continue
      }
      else if (command === "Silent") silent = true
      else if (command === "popout") { await setIPvGoPopout(ns, true); if (!silent) ns.tprintf("IPvGo:  Popout On!") }
      else if (command === "nopopout") { await setIPvGoPopout(ns, false); if (!silent) ns.tprintf("IPvGo:  Popout Off!") }
      else if (commandHandlers[command]) commandHandlers[command](ns, silent)
      else ns.tprintf("Invalid response received in Go: %s", command);
    }
    if (changed || oneCycleOnly) buildOpponents()
    if (oneCycleOnly) break
    await ns.asleep(200)
  }
}
const commandHandlers = {
  "Cheats On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Cheats enabled!"); setIPvGoCheats(ns, true) },
  "Cheats Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Cheats disabled!"); setIPvGoCheats(ns, false) },
  "Repeat On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Repeat enabled!"); setIPvGoRepeat(ns, true) },
  "Repeat Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Repeat disabled!"); setIPvGoRepeat(ns, false) },
  "Net On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Netburners enabled!"); setIPvGoOpponent(ns, "net", true) },
  "Net Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Netburners disabled!"); setIPvGoOpponent(ns, "net", false) },
  "Slum On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Slum Snakes enabled!"); setIPvGoOpponent(ns, "slum", true) },
  "Slum Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Slum Snakes disabled!"); setIPvGoOpponent(ns, "slum", false) },
  "BH On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: The Black Hand enabled!"); setIPvGoOpponent(ns, "bh", true) },
  "BH Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: The Black Hand disabled!"); setIPvGoOpponent(ns, "bh", false) },
  "Tetrad On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Tetrads enabled!"); setIPvGoOpponent(ns, "tetrad", true) },
  "Tetrad Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Tetrads disabled!"); setIPvGoOpponent(ns, "tetrad", false) },
  "Daed On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Daedalus enabled!"); setIPvGoOpponent(ns, "daed", true) },
  "Daed Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Daedalus disabled!"); setIPvGoOpponent(ns, "daed", false) },
  "Illum On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Illuminati enabled!"); setIPvGoOpponent(ns, "illum", true) },
  "Illum Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Illuminati disabled!"); setIPvGoOpponent(ns, "illum", false) },
  "???? On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: ???????? enabled!"); setIPvGoOpponent(ns, "????", true) },
  "???? Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: ???????? disabled!"); setIPvGoOpponent(ns, "????", false) },
  "No AI On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: No AI enabled!"); setIPvGoOpponent(ns, "noai", true) },
  "No AI Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: No AI disabled!"); setIPvGoOpponent(ns, "noai", false) },
  "SlowMode On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: SlowMode enabled!"); setIPvGoSlowMode(ns, true) },
  "SlowMode Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: SlowMode disabled!"); setIPvGoSlowMode(ns, false) },
  "Play as White On": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Play as White enabled!"); setIPvGoPlayWhite(ns, true) },
  "Play as White Off": (ns, silent) => { if (!silent) ns.tprintf("IPvGo: Play as White disabled!"); setIPvGoPlayWhite(ns, false) }
}
/** @param {NS} ns */
function buildOpponents() {
  opponent.length = 0
  opponent2.length = 0
  if (PLAY_AS_WHITE || oppNoAi) {
    opponent.push("No AI")
    opponent2.push("No AI")
    return
  }
  else {
    if (oppBlackHand) {
      opponent.push("The Black Hand")
      opponent2.push("The Black Hand")
    }
    if (oppDaedalus) {
      opponent.push("Daedalus")
      opponent2.push("Daedalus")
    }
    if (oppIlluminati) {
      opponent.push("Illuminati")
      opponent2.push("Illuminati")
    }
    if (oppNetburners) {
      opponent.push("Netburners")
      opponent2.push("Netburners")
    }
    if (oppRedPill) {
      opponent2.push("????????????")
    }
    if (oppSlumSnakes) {
      opponent.push("Slum Snakes")
      opponent2.push("Slum Snakes")
    }
    if (oppTetrads) {
      opponent.push("Tetrads")
      opponent2.push("Tetrads")
    }
  }
}
// Thanks to omuretsu, jeek and sphyxis
async function makeNewWindow(title = "Default Window Title", theme) {
  let slp = ms => new Promise(r => setTimeout(r, ms));
  //  let win = open("", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  let win = open("main.bundle.js", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  let good = false;
  let doc = 0;
  while (!good) {
    await slp(1000);
    try {
      doc = win["document"];
      doc.head.innerHTML = "No.";
      good = true;
    } catch {
      good = false;
    }
  }
  await slp(200);
  doc.head.innerHTML = `
  <title>${title}</title>
  <style>
    *{
      margin:0;
    }
    body{
      background:` + theme['backgroundprimary'] + `;
      color:` + theme['primary'] + `;
      overflow:hidden;
      height:100vh;
      width:100vw;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
      display:flex;
      flex-direction:column;
    }
    td{
      background:` + theme['backgroundsecondary'] + `;
      color:` + theme['primary'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    a{
      color:` + theme['primary'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    warning{
      color:` + theme['error'] + `;
      font-family: "Hack Regular Nerd Font Complete", "Lucida Console", "Lucida Sans Unicode", "Fira Mono", Consolas, "Courier New", Courier, monospace, "Times New Roman";
    }
    .title{
      font-size:20px;
      text-align:center;
      flex: 0 0;
      display:flex;
      align-items:center;
      border-bottom:1px solid white;
    }
    .scrollQuery{
      font-size:12px;
      margin-left:auto;
    }
    .logs{
      width:100%;
      flex: 1;
      overflow-y:scroll;
      font-size:14px;
      white-space:normal;
    }
    .logs::-webkit-scrollbar,::-webkit-scrollbar-corner{
      background:` + theme['button'] + `;
      width:10px;
      height:10px;
    }
    .logs::-webkit-scrollbar-button{
      width:0px;
      height:0px;
    }
    .logs::-webkit-scrollbar-thumb{
      background:` + theme['primary'] + `;
    }
  </style>`;
  doc.body.innerHTML = `<div class=title>${title}</div><div class=logs><p></p></div>`;
  win.clear = () => {
    win["document"].body.querySelector(".logs").innerHTML = "";
  }
  win.header = (content) => {
    win["document"].body.innerHTML = `<div class=title>${content}</div><div class=logs><p></p></div>`;
  }
  win.update = (content) => {
    win["document"].body.querySelector(".logs").innerHTML = win["document"].body.querySelector(".logs").innterHTML === "" ? content.replaceAll(" ", "&nbsp;").replaceAll("\r", "<br>").replaceAll("\n", "<br>") : win["document"].body.querySelector(".logs").innerHTML + `<br>` + content.replaceAll(" ", "&nbsp;").replaceAll("\r", "<br>").replaceAll("\n", "<br>");
  }
  // Set (replace) the raw innerHTML of a target element by selector. Unlike
  // win.update (which appends and escapes spaces/newlines), this writes markup
  // verbatim — use it for live views like the IPvGo board. A missing "#id"
  // target is auto-created inside the content area so callers need no setup.
  win.setHTML = (selector, html) => {
    const doc = win["document"];
    let el = doc.querySelector(selector);
    if (!el && selector.charAt(0) === "#") {
      el = doc.createElement("div");
      el.id = selector.slice(1);
      (doc.querySelector(".logs") || doc.body).appendChild(el);
    }
    if (el) el.innerHTML = html;
  }
  win.reopen = () => open("", title.replaceAll(" ", "_"), "popup=yes,height=200,width=500,left=100,top=100,resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,directories=no,status=no");
  win.focus()
  return win;
}
function getReactLib() {
  return globalThis["React"] ?? globalThis["window"]?.React
}
function normalizeIPvGoResourceLevel(value, added = []) {
  return IPVGO_RESOURCE_LEVELS.concat(...added).includes(value) ? value : "Med"
}
function getMaximumIPvGoThreads() {
  return Math.max(1, Math.floor(globalThis["navigator"]?.hardwareConcurrency || 2))
}
function normalizeIPvGoThreadSetting(value) {
  const maximum = getMaximumIPvGoThreads()
  if (String(value).toLowerCase() === "max") return maximum
  const count = Math.floor(Number(value))
  if (!Number.isFinite(count) || count < 1)
    return Number.isFinite(THREAD_SETTING) ? THREAD_SETTING : maximum
  return Math.min(count, maximum)
}
function resolveIPvGoThreadCount(setting = THREAD_SETTING) {
  return Math.max(1, Math.min(getMaximumIPvGoThreads(), Math.floor(Number(setting) || 1)))
}
function applyIPvGoSearchSettings(currentOpponent) {
  THREADS = resolveIPvGoThreadCount()
  const totalNodeCap = BOARD_SIZE === 5
    ? MEMORY_NODE_CAPS[MEMORY_USE]
    : Y19MEMORY_NODE_CAPS[MEMORY_USE]
  MAX_ACTIVE_SEARCH_NODES_PER_WORKER = Math.max(
    1,
    Math.ceil(totalNodeCap / THREADS)
  )
  Y19_LADDER_MAKER_NODE_LIMIT = MAX_ACTIVE_SEARCH_NODES_PER_WORKER
  PLAYOUTS = Math.ceil(PLAYOUTS_BY_OPPONENT[currentOpponent][EFFORT] / THREADS)
  publishIPvGoUiState()
}
function getIPvGoUiSnapshot() {
  return {
    playWhite: PLAY_AS_WHITE,
    repeat: REPEAT,
    cheats: CHEATS_ENABLED,
    logging: LOGINFO,
    netburners: oppNetburners,
    slumSnakes: oppSlumSnakes,
    blackHand: oppBlackHand,
    tetrads: oppTetrads,
    daedalus: oppDaedalus,
    illuminati: oppIlluminati,
    unknown: oppRedPill,
    noAI: oppNoAi,
    slowMode,
    popout: !!win && !win.closed,
    effort: EFFORT,
    memory: MEMORY_USE,
    threadSetting: THREAD_SETTING,
    threads: THREADS,
    maximumThreads: getMaximumIPvGoThreads(),
  }
}
function publishIPvGoUiState() {
  const snapshot = getIPvGoUiSnapshot()
  for (const listener of ipvGoUiListeners) listener(snapshot)
}
function syncIPvGoLoader(ns, command) {
  if (command && ns.peek(14) !== "NULL PORT DATA") ns.writePort(1, command)
}
function setIPvGoPlayWhite(ns, enabled, syncLoader = false) {
  PLAY_AS_WHITE = !!enabled
  if (PLAY_AS_WHITE) oppNoAi = true
  buildOpponents()
  if (syncLoader) {
    syncIPvGoLoader(ns, "ipvgo playaswhite " + (PLAY_AS_WHITE ? "on" : "off"))
    if (PLAY_AS_WHITE) syncIPvGoLoader(ns, "ipvgo noai on")
  }
  publishIPvGoUiState()
}
function setIPvGoRepeat(ns, enabled, syncLoader = false) {
  REPEAT = !!enabled
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo repeat " + (REPEAT ? "on" : "off"))
  publishIPvGoUiState()
}
function setIPvGoCheats(ns, enabled, syncLoader = false) {
  CHEATS_ENABLED = !!enabled
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo cheats " + (CHEATS_ENABLED ? "on" : "off"))
  publishIPvGoUiState()
}
async function setIPvGoOpponent(ns, faction, enabled, syncLoader = false) {
  const value = !!enabled
  if (faction === "????") {
    const resetInfo = await proxy(ns, "getResetInfo")
    if (resetInfo.ownedAugs.get("The Red Pill")) {
      oppRedPill = value
    }
    else {
      oppRedPill = false
      ns.toast("The ???? AI is unlocked in Mid Game")
    }
  }
  else if (faction === "net") {
    oppNetburners = value
  }
  else if (faction === "slum") {
    oppSlumSnakes = value
  }
  else if (faction === "bh") {
    oppBlackHand = value
  }
  else if (faction === "tetrad") {
    oppTetrads = value
  }
  else if (faction === "daed") {
    oppDaedalus = value
  }
  else if (faction === "illum") {
    oppIlluminati = value
  }
  else if (faction === "noai") {
    oppNoAi = value
    if (!oppNoAi) {
      PLAY_AS_WHITE = false
    }
    else {
      if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, optionsDB["IPvGoPlayAsWhite"] ? "Play as White On" : "Play as White Off")
      if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "No AI On")
    }
  }
  if (!oppRedPill
    && !oppNetburners
    && !oppSlumSnakes
    && !oppBlackHand
    && !oppTetrads
    && !oppDaedalus
    && !oppIlluminati
    && !optionsDB["IPvGoNoAI"]) {
    optionsDB["IPvGoNetburners"] = true
    if (ns.peek(5) !== "NULL PORT DATA") ns.writePort(15, "Net On")
  }
  buildOpponents()
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo " + faction + " " + (value ? "on" : "off"))
  publishIPvGoUiState()
}
function setIPvGoSlowMode(ns, enabled, syncLoader = false) {
  slowMode = !!enabled
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo slowmode " + (slowMode ? "on" : "off"))
  publishIPvGoUiState()
}
async function setIPvGoPopout(ns, enabled, syncLoader = false) {
  if (enabled && (!win || win.closed)) {
    win = await makeNewWindow("Jump3rs Ghost", ns.ui.getTheme())
    win.resizeTo(460, 560)
  } else if (!enabled && win) {
    win.close()
    win = false
  }
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo popout " + (enabled ? "on" : "off"))
  publishIPvGoUiState()
}
function setIPvGoEffort(ns, value, syncLoader = false) {
  EFFORT = normalizeIPvGoResourceLevel(value, ["Ultra"])
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo effort:" + EFFORT)
  publishIPvGoUiState()
}
function setIPvGoMemory(ns, value, syncLoader = false) {
  MEMORY_USE = normalizeIPvGoResourceLevel(value)
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo memory:" + MEMORY_USE)
  publishIPvGoUiState()
}
function setIPvGoThreads(ns, value, syncLoader = false) {
  THREAD_SETTING = normalizeIPvGoThreadSetting(value)
  if (syncLoader) syncIPvGoLoader(ns, "ipvgo threads:" + THREAD_SETTING)
  publishIPvGoUiState()
}

// Named UI entry points. Each control has its own function so custom behavior
// can be added without changing the React layout or the loader protocol.
function buttonIPvGoPlayWhite(ns) { setIPvGoPlayWhite(ns, !PLAY_AS_WHITE, true) }
function buttonIPvGoRepeat(ns) { setIPvGoRepeat(ns, !REPEAT, true) }
function buttonIPvGoCheats(ns) { setIPvGoCheats(ns, !CHEATS_ENABLED, true) }
function buttonIPvGoNetburners(ns) { setIPvGoOpponent(ns, "net", !oppNetburners, true) }
function buttonIPvGoSlumSnakes(ns) { setIPvGoOpponent(ns, "slum", !oppSlumSnakes, true) }
function buttonIPvGoTheBlackHand(ns) { setIPvGoOpponent(ns, "bh", !oppBlackHand, true) }
function buttonIPvGoTetrads(ns) { setIPvGoOpponent(ns, "tetrad", !oppTetrads, true) }
function buttonIPvGoDaedalus(ns) { setIPvGoOpponent(ns, "daed", !oppDaedalus, true) }
function buttonIPvGoIlluminati(ns) { setIPvGoOpponent(ns, "illum", !oppIlluminati, true) }
function buttonIPvGoUnknown(ns) { setIPvGoOpponent(ns, "????", !oppRedPill, true) }
function buttonIPvGoNoAI(ns) { setIPvGoOpponent(ns, "noai", !oppNoAi, true) }
function buttonIPvGoSlowMode(ns) { setIPvGoSlowMode(ns, !slowMode, true) }
async function buttonIPvGoPopout(ns) {
  await setIPvGoPopout(ns, !win || win.closed, true)
}
function buttonIPvGoEffort(ns, value) { setIPvGoEffort(ns, value, true) }
function buttonIPvGoMemory(ns, value) { setIPvGoMemory(ns, value, true) }
function buttonIPvGoThreads(ns, value) { setIPvGoThreads(ns, value, true) }

function IPvGoButton({ text, enabled, onClick }) {
  return <button
    style={{
      ...ipvGoButtonStyle,
      ...(enabled ? ipvGoGreenStyle : ipvGoRedStyle),
    }}
    onClick={onClick}
  >{text}</button>
}
function IPvGoControlPanel({ ns }) {
  const React = getReactLib()
  const [state, setState] = React.useState(getIPvGoUiSnapshot())
  const [threadDraft, setThreadDraft] = React.useState(String(state.threadSetting))

  React.useEffect(() => {
    ipvGoUiListeners.add(setState)
    return () => ipvGoUiListeners.delete(setState)
  }, [])
  React.useEffect(() => {
    setThreadDraft(String(state.threadSetting))
  }, [state.threadSetting])

  const commitThreads = () => {
    if (threadDraft.trim() === "") {
      setThreadDraft(String(state.threadSetting))
      return
    }
    buttonIPvGoThreads(ns, threadDraft)
  }

  return (
    <div style={ipvGoAppStyle}>
      <IPvGoButton text={"Play White"} enabled={state.playWhite} onClick={() => buttonIPvGoPlayWhite(ns)}></IPvGoButton>
      <IPvGoButton text={"Repeat"} enabled={state.repeat} onClick={() => buttonIPvGoRepeat(ns)}></IPvGoButton>
      <span style={{ flexBasis: "100%", height: 0 }}></span>
      <IPvGoButton text={"Cheats"} enabled={state.cheats} onClick={() => buttonIPvGoCheats(ns)}></IPvGoButton>
      <IPvGoButton text={"SlowMode"} enabled={state.slowMode} onClick={() => buttonIPvGoSlowMode(ns)}></IPvGoButton>
      <IPvGoButton text={"Pop Out"} enabled={state.popout} onClick={() => buttonIPvGoPopout(ns)}></IPvGoButton>
      <span style={{ flexBasis: "100%", height: 0 }}></span>
      <IPvGoButton text={"Netburners"} enabled={state.netburners} onClick={() => buttonIPvGoNetburners(ns)}></IPvGoButton>
      <IPvGoButton text={"Slum Snakes"} enabled={state.slumSnakes} onClick={() => buttonIPvGoSlumSnakes(ns)}></IPvGoButton>
      <IPvGoButton text={"The Black Hand"} enabled={state.blackHand} onClick={() => buttonIPvGoTheBlackHand(ns)}></IPvGoButton>
      <IPvGoButton text={"Tetrads"} enabled={state.tetrads} onClick={() => buttonIPvGoTetrads(ns)}></IPvGoButton>
      <span style={{ flexBasis: "100%", height: 0 }}></span>
      <IPvGoButton text={"Daedalus"} enabled={state.daedalus} onClick={() => buttonIPvGoDaedalus(ns)}></IPvGoButton>
      <IPvGoButton text={"Illuminati"} enabled={state.illuminati} onClick={() => buttonIPvGoIlluminati(ns)}></IPvGoButton>
      <IPvGoButton text={"????????"} enabled={state.unknown} onClick={() => buttonIPvGoUnknown(ns)}></IPvGoButton>
      <IPvGoButton text={"No AI"} enabled={state.noAI} onClick={() => buttonIPvGoNoAI(ns)}></IPvGoButton>
      <span style={{ flexBasis: "100%", height: 0 }}></span>
      <label style={ipvGoFieldStyle}>
        <span style={ipvGoFieldLabelStyle}>{"Effort"}</span>
        <select
          style={ipvGoSelectStyle}
          value={state.effort}
          onChange={(event) => buttonIPvGoEffort(ns, event.target.value)}
        >
          {IPVGO_RESOURCE_LEVELS.concat("Ultra").map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </label>
      <label style={ipvGoFieldStyle}>
        <span style={ipvGoFieldLabelStyle}>{"Memory"}</span>
        <select
          style={ipvGoSelectStyle}
          value={state.memory}
          onChange={(event) => buttonIPvGoMemory(ns, event.target.value)}
        >
          {IPVGO_RESOURCE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </label>
      <label style={ipvGoFieldStyle}>
        <span style={ipvGoFieldLabelStyle}>{"Threads"}</span>
        <input
          style={ipvGoInputStyle}
          type="number"
          min="1"
          max={state.maximumThreads}
          step="1"
          placeholder={String(state.maximumThreads)}
          value={threadDraft}
          onChange={(event) => setThreadDraft(event.target.value)}
          onBlur={commitThreads}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        ></input>
      </label>
    </div>
  )
}

const ipvGoAppStyle = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "flex-end",
  flexWrap: "wrap",
  gap: 4,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
}
const ipvGoButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 82,
  height: 28,
  padding: "2px 6px",
  marginRight: 4,
  marginBottom: 4,
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.08)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
  textAlign: "center",
  whiteSpace: "normal",
  fontSize: 12,
  lineHeight: 1.05,
  overflow: "hidden",
  verticalAlign: "middle",
}
const ipvGoGreenStyle = {
  backgroundColor: "var(--bb-theme-primarydark)",
  color: "var(--bb-theme-backgroundprimary)",
}
const ipvGoRedStyle = {
  backgroundColor: "var(--bb-theme-error)",
  color: "var(--bb-theme-backgroundprimary)",
}
const ipvGoFieldStyle = {
  display: "inline-flex",
  flexDirection: "column",
  gap: 2,
}
const ipvGoFieldLabelStyle = {
  color: "var(--bb-theme-secondary)",
  fontSize: 11,
  lineHeight: 1,
}
const ipvGoSelectStyle = {
  width: 82,
  height: 28,
  padding: "2px 5px",
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.16)",
  backgroundColor: "var(--bb-theme-backgroundsecondary)",
  color: "var(--bb-theme-primary)",
  fontFamily: "inherit",
  fontSize: 12,
}
const ipvGoInputStyle = {
  ...ipvGoSelectStyle,
  width: 68,
  boxSizing: "border-box",
}
//Ram dodged functions below and their file writes
async function proxy(ns, func, ...argmnts) { return await runIt(ns, "SphyxOS/extras/nsProxy.js", ns.getFunctionRamCost(func) + 1.6, [func, ...argmnts]) }
/** @param {NS} ns */
async function runIt(ns, script, scriptOverride, argmnts) {
  let thispid = 0
  let threads = 1
  thispid = ns.exec(script, "home", { threads: 1, temporary: true, ramOverride: scriptOverride }, ...argmnts)
  if (thispid > 0)
    threads--
  else {
    thispid = ns.exec(script, ns.self().server, { threads: 1, temporary: true, ramOverride: scriptOverride }, ...argmnts)
    if (thispid > 0)
      threads--
  }
  if (threads >= 1) throw new Error("Failed to run " + script)
  await ns.nextPortWrite(thispid)
  const result = ns.readPort(thispid)
  return result
}
function writeProxy(ns) {
  const data = `/** @param {NS} ns */
export async function main(ns) {
  ns.disableLog("ALL")
  let [func, ...argmnts] = ns.args
  let nsFunction = ns
  for (let prop of func.split(".")) nsFunction = nsFunction[prop]
  let finalResult
  try {
    const result = nsFunction(...argmnts)
    if (result instanceof Promise) finalResult = await result
    else if (result instanceof Object) {
      promiseRemoval(result)
      finalResult = result
    }
    else finalResult = result
  } catch { } //finalResult is undefined if it failed to run.
  ns.atExit(() => ns.writePort(ns.pid, finalResult))
}
function promiseRemoval(object) {
  for (const key in object)
    if (object[key] instanceof Promise) delete object[key]
    else if (object[key] instanceof Object) promiseRemoval(object[key])
}`
  ns.write("SphyxOS/extras/nsProxy.js", data, "w")
}
