/**
 * PC2 Micro-Language — Hardened Encoder/Parser
 * 
 * Formalizuje mikro-jazyk deduktivní aplikace: <sys>log>apply
 * Axiomy A1–A5. Striktní validace. Žádný soft-fail.
 * 
 * Grammar (BNF):
 *   Expr  ::= <sys:Atom> Chain
 *   Chain ::= log>Atom
 *           | log>Atom>apply>Atom
 *           | log>Atom>apply>bind>Atom
 *           | log>Atom>apply>shift>Atom
 *           | log>Atom>apply>null
 *   Atom  ::= [a-z_][a-z0-9_=]*
 */

'use strict';

// ─── OPERATORS ───────────────────────────────────────
const OPS = Object.freeze({
  SYS:   { token: 'sys',   fn: 'systémový_rámec',    desc: 'sets axiom set and context validity' },
  LOG:   { token: 'log',   fn: 'inferenční_vrstva',  desc: 'derives meaning via inference rules' },
  APPLY: { token: 'apply', fn: 'exekuční_vrstva',    desc: 'applies derived meaning to system state' },
  BIND:  { token: 'bind',  fn: 'vazba',              desc: 'binds meaning to role/object/function' },
  SHIFT: { token: 'shift', fn: 'přepnutí_režimu',    desc: 'changes interpretation plane without changing base tokens' },
  NULL:  { token: 'null',  fn: 'nulový_výsledek',    desc: 'legitimate non-applicability, not error' }
});

// ─── AXIOMS ──────────────────────────────────────────
const AXIOMS = Object.freeze([
  { id: 'A1', rule: 'Every token has meaning only inside <sys>.', check: (expr) => expr.sys !== undefined },
  { id: 'A2', rule: 'log> may only derive statements compatible with system axioms.', check: (expr) => expr.log !== undefined },
  { id: 'A3', rule: 'apply> must not create an effect not inferentially prepared.', check: (expr) => !expr.apply || expr.log !== undefined },
  { id: 'A4', rule: 'bind> stabilizes meaning for reuse.', check: (expr) => !expr.bind || expr.apply !== undefined },
  { id: 'A5', rule: 'null is legitimate output of non-applicability.', check: () => true }
]);

// ─── ATOM PATTERN ────────────────────────────────────
const ATOM_RE = /^[a-z_][a-z0-9_=]*$/;

// ─── TOKENIZER ───────────────────────────────────────
function tokenize(raw) {
  const s = raw.trim();
  
  // Extract <sys:ATOM>
  const sysMatch = s.match(/^<sys:\s*([^>]+)\s*>/);
  if (!sysMatch) throw new Error('PARSE_FAIL: missing <sys:Atom> prefix');
  
  const sysAtom = sysMatch[1].trim();
  if (!ATOM_RE.test(sysAtom)) throw new Error(`PARSE_FAIL: invalid sys atom "${sysAtom}"`);
  
  const rest = s.slice(sysMatch[0].length);
  
  // Split chain on >
  const parts = rest.split('>').filter(p => p.length > 0);
  if (parts.length === 0) throw new Error('PARSE_FAIL: empty chain after <sys>');
  
  return { sysAtom, parts };
}

// ─── PARSER ──────────────────────────────────────────
function parse(raw) {
  const { sysAtom, parts } = tokenize(raw);
  
  const expr = { sys: sysAtom, log: null, apply: null, bind: null, shift: null, isNull: false };
  
  let i = 0;
  
  // Must start with log
  if (parts[i] !== 'log') throw new Error(`PARSE_FAIL: expected "log" after <sys>, got "${parts[i]}"`);
  i++;
  
  // log>Atom
  if (i >= parts.length) throw new Error('PARSE_FAIL: missing atom after log>');
  if (!ATOM_RE.test(parts[i])) throw new Error(`PARSE_FAIL: invalid log atom "${parts[i]}"`);
  expr.log = parts[i];
  i++;
  
  // Optional: apply>...
  if (i < parts.length) {
    if (parts[i] !== 'apply') throw new Error(`PARSE_FAIL: expected "apply" or end, got "${parts[i]}"`);
    i++;
    
    if (i >= parts.length) throw new Error('PARSE_FAIL: missing target after apply>');
    
    // apply>null
    if (parts[i] === 'null') {
      expr.isNull = true;
      expr.apply = 'null';
      i++;
    }
    // apply>bind>Atom
    else if (parts[i] === 'bind') {
      i++;
      if (i >= parts.length) throw new Error('PARSE_FAIL: missing atom after bind>');
      if (!ATOM_RE.test(parts[i])) throw new Error(`PARSE_FAIL: invalid bind atom "${parts[i]}"`);
      expr.bind = parts[i];
      expr.apply = `bind>${parts[i]}`;
      i++;
    }
    // apply>shift>Atom
    else if (parts[i] === 'shift') {
      i++;
      if (i >= parts.length) throw new Error('PARSE_FAIL: missing atom after shift>');
      if (!ATOM_RE.test(parts[i])) throw new Error(`PARSE_FAIL: invalid shift atom "${parts[i]}"`);
      expr.shift = parts[i];
      expr.apply = `shift>${parts[i]}`;
      i++;
    }
    // apply>Atom
    else {
      if (!ATOM_RE.test(parts[i])) throw new Error(`PARSE_FAIL: invalid apply atom "${parts[i]}"`);
      expr.apply = parts[i];
      i++;
    }
  }
  
  // Nothing should remain
  if (i < parts.length) throw new Error(`PARSE_FAIL: unexpected trailing tokens: "${parts.slice(i).join('>')}"`);
  
  return expr;
}

// ─── AXIOM VALIDATOR ─────────────────────────────────
function validate(expr) {
  const violations = [];
  for (const ax of AXIOMS) {
    if (!ax.check(expr)) {
      violations.push({ axiom: ax.id, rule: ax.rule });
    }
  }
  return { valid: violations.length === 0, violations };
}

// ─── ENCODER ─────────────────────────────────────────
function encode(expr) {
  let s = `<sys:${expr.sys}>log>${expr.log}`;
  if (expr.apply) s += `>apply>${expr.apply}`;
  return s;
}

// ─── HARDENED EXECUTE ────────────────────────────────
function execute(raw) {
  const expr = parse(raw);
  const { valid, violations } = validate(expr);
  
  if (!valid) {
    return {
      status: 'AXIOM_VIOLATION',
      input: raw,
      expr,
      violations,
      encoded: null
    };
  }
  
  return {
    status: 'VALID',
    input: raw,
    expr,
    violations: [],
    encoded: encode(expr)
  };
}

// ─── BATCH SELFCHECK ─────────────────────────────────
function selfcheck() {
  const tests = [
    // Should PASS
    { input: '<sys:alignment=axiom>log>universal_applicability>apply>bind>core', expect: 'VALID' },
    { input: '<sys:secret_law>log>opaque_norm>apply>shift>governance', expect: 'VALID' },
    { input: '<sys:context_a>log>inference_b', expect: 'VALID' },
    { input: '<sys:test>log>derive>apply>null', expect: 'VALID' },
    { input: '<sys:forensic>log>evidence>apply>record', expect: 'VALID' },
    
    // Should FAIL
    { input: 'log>something>apply>result', expect: 'FAIL' },              // missing <sys>
    { input: '<sys:test>apply>result', expect: 'FAIL' },                  // missing log>
    { input: '<sys:test>log>', expect: 'FAIL' },                          // missing atom after log>
    { input: '<sys:UPPER>log>test', expect: 'FAIL' },                     // uppercase atom
    { input: '<sys:test>log>a>apply>b>extra>junk', expect: 'FAIL' },      // trailing tokens
  ];
  
  const results = [];
  let pass = 0;
  let fail = 0;
  
  for (const t of tests) {
    let status;
    try {
      const r = execute(t.input);
      status = r.status === 'VALID' ? 'VALID' : 'AXIOM_VIOLATION';
    } catch (e) {
      status = 'FAIL';
    }
    
    const expected = t.expect;
    const got = status === 'VALID' ? 'VALID' : 'FAIL';
    const ok = got === expected;
    
    results.push({ input: t.input, expected, got, ok });
    if (ok) pass++; else fail++;
  }
  
  return { pass, fail, total: tests.length, results };
}

// ─── EXPORTS ─────────────────────────────────────────
module.exports = { OPS, AXIOMS, parse, validate, encode, execute, selfcheck };

// ─── CLI ─────────────────────────────────────────────
if (require.main === module) {
  const arg = process.argv[2];
  
  if (arg === '--selfcheck') {
    const r = selfcheck();
    console.log(`selfcheck: ${r.pass}/${r.total} pass, ${r.fail} fail`);
    for (const t of r.results) {
      console.log(`  ${t.ok ? 'PASS' : 'FAIL'}: ${t.input} (expected=${t.expected}, got=${t.got})`);
    }
    process.exit(r.fail > 0 ? 1 : 0);
  } else if (arg) {
    const r = execute(arg);
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log('Usage: node microlang.js "<sys:X>log>Y>apply>Z"');
    console.log('       node microlang.js --selfcheck');
  }
}
