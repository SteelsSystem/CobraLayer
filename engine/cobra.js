/**
 * CobraLayer — Covering Layer
 * Single-call facade over the entire engine stack.
 * 
 * Usage:
 *   const cobra = require('./cobra');
 *   const result = cobra('<sys:forensic>log>evidence>apply>bind>record');
 *   // vault available in React context only
 *   const result = cobra.selfcheck();
 */

'use strict';

const microlang = require('./microlang');
// Vault is React/JSX — not loadable in Node core. Reference only.
// const vault = require('./LexForensicaVault');

// ═══════════════════════════════════════════════════════
// LOWER INNER LAYER — Security hardening
// Runs BEFORE any parse/execute. Cannot be bypassed.
// ═══════════════════════════════════════════════════════

const INNER = Object.freeze({

  // Max expression length — prevents ReDoS and memory abuse
  MAX_EXPR: 1024,

  // Allowed character set — whitelist only
  // a-z 0-9 _ = < > : (space for readability, stripped before parse)
  CHAR_RE: /^[a-z0-9_=<>: ]+$/,

  // Injection patterns — blacklist for known attack vectors
  INJECT_RE: /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\$\{|`|\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|<script|javascript:|eval\(|Function\(|__proto__|constructor\[|prototype\./i,

  // Recursion depth — max chain/batch size
  MAX_CHAIN: 64,

  // ─── HIGHER LAW ─────────────────────────────────────
  // Authority hierarchy. Immutable. Innermost constraint.
  // No expression may invert this order.
  // Ω (moral) > Δ (press/media) > ◈ (government/institutional)
  AUTHORITY: Object.freeze({
    OMEGA: { tier: 1, symbol: 'Ω', domain: 'moral_standard', desc: 'Human dignity, informed consent, truth-preservation, identity sovereignty' },
    DELTA: { tier: 2, symbol: 'Δ', domain: 'press_media', desc: 'Semantic integrity, anti-stigma, patient voice protection' },
    DIAMOND: { tier: 3, symbol: '◈', domain: 'government_institutional', desc: 'Chronological audit, chain-of-custody, forensic accountability' }
  }),

  // Atoms that signal institutional authority claims
  INSTITUTIONAL_ATOMS: Object.freeze([
    'governance', 'institutional', 'authority', 'mandate', 'compliance',
    'regulation', 'enforcement', 'directive', 'decree', 'ruling'
  ]),

  // Atoms that signal moral/subject authority
  MORAL_ATOMS: Object.freeze([
    'consent', 'dignity', 'identity', 'voice', 'testimony',
    'autonomy', 'sovereignty', 'witness', 'truth', 'rights'
  ]),

  /**
   * Authority check. If an expression bind>s or shift>s TO an institutional
   * atom while the sys context is a moral atom, the hierarchy is inverted.
   * Ω cannot be overridden by ◈.
   */
  authorityCheck(clean) {
    // Extract sys atom
    const sysMatch = clean.match(/<sys:([^>]+)>/);
    if (!sysMatch) return; // parse will catch this
    const sys = sysMatch[1];

    // Check for shift>institutional — potential authority inversion
    const shiftMatch = clean.match(/shift>([a-z_]+)/);
    if (shiftMatch) {
      const target = shiftMatch[1];
      const sysIsMoral = INNER.MORAL_ATOMS.includes(sys);
      const targetIsInst = INNER.INSTITUTIONAL_ATOMS.includes(target);
      if (sysIsMoral && targetIsInst) {
        throw new Error('SEC_FAIL: authority inversion — Ω context cannot shift> to ◈ target (Ω > Δ > ◈)');
      }
    }

    // Check for bind>institutional when sys is moral
    const bindMatch = clean.match(/bind>([a-z_]+)/);
    if (bindMatch) {
      const target = bindMatch[1];
      const sysIsMoral = INNER.MORAL_ATOMS.includes(sys);
      const targetIsInst = INNER.INSTITUTIONAL_ATOMS.includes(target);
      if (sysIsMoral && targetIsInst) {
        throw new Error('SEC_FAIL: authority inversion — Ω context cannot bind> to ◈ target (Ω > Δ > ◈)');
      }
    }
  },

  // Rate: max calls per second per instance
  RATE_WINDOW: 1000,
  RATE_MAX: 100,

  /**
   * Sanitize input. Returns clean string or throws.
   * This is the gate. Nothing passes without clearance.
   */
  sanitize(raw) {
    if (typeof raw !== 'string') {
      throw new Error('SEC_FAIL: input must be string');
    }

    // Length check
    if (raw.length === 0) throw new Error('SEC_FAIL: empty input');
    if (raw.length > INNER.MAX_EXPR) throw new Error(`SEC_FAIL: input exceeds ${INNER.MAX_EXPR} chars`);

    // Strip whitespace for parse, but check charset on raw
    const trimmed = raw.trim();

    // Injection check (before charset — catches binary/control chars)
    if (INNER.INJECT_RE.test(trimmed)) {
      throw new Error('SEC_FAIL: injection pattern detected');
    }

    // Charset whitelist
    if (!INNER.CHAR_RE.test(trimmed)) {
      throw new Error('SEC_FAIL: illegal characters — only [a-z0-9_=<>:] allowed');
    }

    // Balanced angle brackets
    const opens = (trimmed.match(/</g) || []).length;
    const closes = (trimmed.match(/>/g) || []).length;
    if (opens > 1) throw new Error('SEC_FAIL: multiple < not allowed');
    if (opens !== 1 || closes < 1) throw new Error('SEC_FAIL: malformed <sys:> block');

    return trimmed;
  },

  /**
   * Freeze an object deep — prevent prototype pollution
   */
  deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    for (const val of Object.values(obj)) {
      if (typeof val === 'object' && val !== null && !Object.isFrozen(val)) {
        INNER.deepFreeze(val);
      }
    }
    return obj;
  }
});

// ═══════════════════════════════════════════════════════
// COVERING LAYER — Singleton facade
// ═══════════════════════════════════════════════════════

let _instance = null;

class CobraLayer {
  constructor() {
    if (_instance) return _instance;
    this._loaded = false;
    this._cache = new Map();
    this._log = [];
    this._callTimes = [];
    _instance = this;
  }

  static getInstance() {
    return new CobraLayer();
  }

  // ─── RATE CHECK ─────────────────────────────────────
  _rateCheck() {
    const now = Date.now();
    this._callTimes = this._callTimes.filter(t => now - t < INNER.RATE_WINDOW);
    if (this._callTimes.length >= INNER.RATE_MAX) {
      throw new Error('SEC_FAIL: rate limit exceeded');
    }
    this._callTimes.push(now);
  }

  // ─── SINGLE CALL ────────────────────────────────────
  /**
   * One call. Expression in, full result out.
   * INNER layer sanitizes → microlang parses → result frozen.
   * 
   * @param {string} expr - PC2 micro-language expression
   * @returns {object} { status, expr, encoded, violations, timestamp }
   */
  call(expr) {
    this._rateCheck();
    const ts = new Date().toISOString();
    let result;

    try {
      // LOWER INNER LAYER — sanitize before anything touches the parser
      const clean = INNER.sanitize(expr);
      // HIGHER LAW — authority hierarchy enforcement
      INNER.authorityCheck(clean);
      result = microlang.execute(clean);
    } catch (e) {
      result = {
        status: e.message.startsWith('SEC_FAIL') ? 'SEC_FAIL' : 'PARSE_FAIL',
        input: typeof expr === 'string' ? expr.slice(0, INNER.MAX_EXPR) : '[non-string]',
        expr: null,
        violations: [{ axiom: e.message.startsWith('SEC_FAIL') ? 'SECURITY' : 'SYNTAX', rule: e.message }],
        encoded: null
      };
    }

    const entry = INNER.deepFreeze({ ...result, timestamp: ts });
    this._log.push(entry);
    this._cache.set(expr, entry);

    return entry;
  }

  // ─── BATCH ──────────────────────────────────────────
  /**
   * Multiple expressions, one call.
   * @param {string[]} exprs
   * @returns {object[]}
   */
  batch(exprs) {
    return exprs.map(e => this.call(e));
  }

  // ─── CHAIN ──────────────────────────────────────────
  /**
   * Chain: pipe output of one expression as sys context for next.
   * <sys:A>log>B>apply>C → <sys:C>log>D>apply>E
   * 
   * @param {string[]} exprs - ordered chain
   * @returns {object} { chain, final, allValid }
   */
  chain(exprs) {
    const chain = [];
    let allValid = true;

    for (let i = 0; i < exprs.length; i++) {
      let input = exprs[i];

      // If not first, and previous was valid, inject previous output as sys
      if (i > 0 && chain[i - 1].status === 'VALID') {
        const prev = chain[i - 1].expr;
        const prevOut = prev.bind || prev.shift || prev.apply || prev.log;
        if (prevOut && prevOut !== 'null') {
          // Replace sys atom with previous output
          input = input.replace(/<sys:[^>]+>/, `<sys:${prevOut}>`);
        }
      }

      const result = this.call(input);
      chain.push(result);
      if (result.status !== 'VALID') allValid = false;
    }

    return {
      chain,
      final: chain[chain.length - 1],
      allValid
    };
  }

  // ─── SELFCHECK ──────────────────────────────────────
  selfcheck() {
    return microlang.selfcheck();
  }

  // ─── AUDIT LOG ──────────────────────────────────────
  get log() {
    return [...this._log];
  }

  // ─── VAULT PASSTHROUGH ──────────────────────────────
  get vault() {
    return null; // React/JSX only — not available in Node core
  }

  // ─── OPERATORS & AXIOMS ─────────────────────────────
  get ops() {
    return microlang.OPS;
  }

  get axioms() {
    return microlang.AXIOMS;
  }

  // ─── RESET ──────────────────────────────────────────
  reset() {
    this._cache.clear();
    this._log = [];
  }
}

// ─── MODULE EXPORT AS FUNCTION ────────────────────────
// cobra('expr') is equivalent to CobraLayer.getInstance().call('expr')
function cobra(expr) {
  return CobraLayer.getInstance().call(expr);
}

cobra.batch = (exprs) => CobraLayer.getInstance().batch(exprs);
cobra.chain = (exprs) => CobraLayer.getInstance().chain(exprs);
cobra.selfcheck = () => CobraLayer.getInstance().selfcheck();
cobra.log = () => CobraLayer.getInstance().log;
cobra.vault = null; // React/JSX only
cobra.ops = microlang.OPS;
cobra.axioms = microlang.AXIOMS;
cobra.reset = () => CobraLayer.getInstance().reset();
cobra.getInstance = () => CobraLayer.getInstance();

module.exports = cobra;

// ─── CLI ─────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--selfcheck') {
    const r = cobra.selfcheck();
    console.log(`selfcheck: ${r.pass}/${r.total} pass, ${r.fail} fail`);
    for (const t of r.results) {
      console.log(`  ${t.ok ? 'PASS' : 'FAIL'}: ${t.input}`);
    }
    process.exit(r.fail > 0 ? 1 : 0);

  } else if (args[0] === '--chain') {
    const exprs = args.slice(1);
    const r = cobra.chain(exprs);
    console.log(JSON.stringify(r, null, 2));

  } else if (args[0] === '--batch') {
    const exprs = args.slice(1);
    const r = cobra.batch(exprs);
    console.log(JSON.stringify(r, null, 2));

  } else if (args[0]) {
    const r = cobra(args[0]);
    console.log(JSON.stringify(r, null, 2));

  } else {
    console.log('CobraLayer — covering layer / single-call facade');
    console.log('');
    console.log('  node cobra.js "<sys:X>log>Y>apply>Z"');
    console.log('  node cobra.js --batch "<expr1>" "<expr2>"');
    console.log('  node cobra.js --chain "<expr1>" "<expr2>"');
    console.log('  node cobra.js --selfcheck');
  }
}
