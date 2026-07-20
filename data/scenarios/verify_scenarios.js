const fs = require('fs');
const path = require('path');

const DIR = '/home/claude/data/scenarios';
const EXPECTED_FILES = [
  'bnk_v1.json','bnk_v2.json','edu_v1.json','edu_v2.json',
  'trv_v1.json','trv_v2.json','vas_v1.json','vas_v2.json',
];

// Expected per taxonomy spec: BNK 11 in-scope +1 OOS, others 10 +1
const EXPECTED_INTENTS = { BNK: 12, EDU: 11, TRV: 11, VAS: 11 };
const EXPECTED_TOTALS  = { scenarios: 198, examples: 594 };

let pass = 0, fail = 0;
const problems = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; problems.push(`${name}${detail ? ' — ' + detail : ''}`); }
}

// ---------- load ----------
const docs = {};
for (const f of EXPECTED_FILES) {
  const p = path.join(DIR, f);
  check(`FILE EXISTS ${f}`, fs.existsSync(p));
  if (!fs.existsSync(p)) continue;
  try {
    docs[f] = JSON.parse(fs.readFileSync(p, 'utf8'));
    check(`VALID JSON ${f}`, true);
  } catch (e) {
    check(`VALID JSON ${f}`, false, e.message);
  }
}

console.log('='.repeat(72));
console.log('  SCENARIO JSON VERIFICATION');
console.log('='.repeat(72));

// ---------- per-file structural checks ----------
const allScenarioIds = [];
const allExamplesGlobal = [];
const perDomainExamples = {};   // code -> {v1:[], v2:[]}
const perDomainScenTexts = {};  // code -> {v1:[], v2:[]}

for (const f of EXPECTED_FILES) {
  const d = docs[f];
  if (!d) continue;
  const code = d.domain;
  const ver = d.scenario_set;

  check(`${f}: has schema_version`, d.schema_version === '1.0');
  check(`${f}: domain matches filename`, f.startsWith(code.toLowerCase() + '_'), `domain=${code}`);
  check(`${f}: scenario_set matches filename`, f.endsWith(`_${ver}.json`), `set=${ver}`);
  check(`${f}: intents count = ${EXPECTED_INTENTS[code]}`,
        d.intents.length === EXPECTED_INTENTS[code],
        `got ${d.intents.length}`);
  check(`${f}: counts.scenarios matches array`,
        d.counts.scenarios === d.scenarios.length,
        `${d.counts.scenarios} vs ${d.scenarios.length}`);

  const exTotal = d.scenarios.reduce((a, s) => a + s.examples.length, 0);
  check(`${f}: counts.examples matches sum`, d.counts.examples === exTotal,
        `${d.counts.examples} vs ${exTotal}`);

  perDomainExamples[code] = perDomainExamples[code] || {};
  perDomainScenTexts[code] = perDomainScenTexts[code] || {};
  perDomainExamples[code][ver] = [];
  perDomainScenTexts[code][ver] = [];

  const idsInFile = new Set();
  const intentSet = new Set(d.intents);

  d.scenarios.forEach(s => {
    // required fields
    const req = ['scenario_id','domain','intent','scenario_set','register','text_scenario','examples'];
    req.forEach(k => check(`${f}:${s.scenario_id} has ${k}`, s[k] !== undefined && s[k] !== null && s[k] !== ''));

    // exactly 3 examples
    check(`${f}:${s.scenario_id} has exactly 3 examples`, s.examples.length === 3,
          `got ${s.examples.length}`);

    // no empty examples
    s.examples.forEach((e, i) =>
      check(`${f}:${s.scenario_id} example ${i+1} non-empty`, typeof e === 'string' && e.trim().length > 0));

    // scenario_id format & uniqueness within file
    check(`${f}:${s.scenario_id} id format`,
          /^[A-Z]{3}\.[a-z_]+\.(v1|v2)\.s\d+$/.test(s.scenario_id), s.scenario_id);
    check(`${f}:${s.scenario_id} unique in file`, !idsInFile.has(s.scenario_id));
    idsInFile.add(s.scenario_id);

    // intent consistency
    check(`${f}:${s.scenario_id} intent in intents list`, intentSet.has(s.intent), s.intent);
    check(`${f}:${s.scenario_id} intent prefix matches domain`,
          s.intent.startsWith(code + '.'), s.intent);
    check(`${f}:${s.scenario_id} scenario_id embeds intent`,
          s.scenario_id.startsWith(s.intent + '.'), s.scenario_id);
    check(`${f}:${s.scenario_id} domain field matches`, s.domain === code);
    check(`${f}:${s.scenario_id} set field matches`, s.scenario_set === ver);

    // OOS flag correctness
    const isOOS = s.intent.endsWith('.out_of_scope');
    check(`${f}:${s.scenario_id} is_out_of_scope flag correct`, s.is_out_of_scope === isOOS);

    allScenarioIds.push(s.scenario_id);
    s.examples.forEach(e => {
      allExamplesGlobal.push(e);
      perDomainExamples[code][ver].push(e);
    });
    perDomainScenTexts[code][ver].push(s.text_scenario);
  });

  // every intent must have at least 2 scenarios
  const byIntent = {};
  d.scenarios.forEach(s => { byIntent[s.intent] = (byIntent[s.intent] || 0) + 1; });
  Object.entries(byIntent).forEach(([intent, n]) =>
    check(`${f}: ${intent} has >=2 scenarios`, n >= 2, `got ${n}`));
  check(`${f}: all intents present in scenarios`,
        Object.keys(byIntent).length === d.intents.length,
        `${Object.keys(byIntent).length}/${d.intents.length}`);
}

// ---------- global uniqueness ----------
const dupIds = allScenarioIds.filter((v, i, a) => a.indexOf(v) !== i);
check('GLOBAL: all scenario_ids unique', dupIds.length === 0, dupIds.join(', '));

const seen = {};
allExamplesGlobal.forEach(e => { seen[e] = (seen[e] || 0) + 1; });
const dupEx = Object.entries(seen).filter(([, n]) => n > 1).map(([e]) => e);
check('GLOBAL: all 594 examples unique', dupEx.length === 0,
      dupEx.length ? `${dupEx.length} dupes: ${dupEx.slice(0,5).join(' | ')}` : '');

// ---------- label conflict: same text as positive intent AND as out_of_scope ----------
const positiveTexts = new Map();  // text -> intent
const oosTexts = new Map();       // text -> intent
Object.values(docs).forEach(d => {
  d.scenarios.forEach(s => {
    s.examples.forEach(e => {
      const key = e.trim().toLowerCase();
      if (s.is_out_of_scope) { if (!oosTexts.has(key)) oosTexts.set(key, s.intent); }
      else { if (!positiveTexts.has(key)) positiveTexts.set(key, s.intent); }
    });
  });
});
const conflicts = [...positiveTexts.keys()].filter(k => oosTexts.has(k));
check('GLOBAL: no text is both a positive label and out_of_scope',
      conflicts.length === 0,
      conflicts.map(c => `"${c}" (${positiveTexts.get(c)} vs ${oosTexts.get(c)})`).join(' | '));

// ---------- v1 vs v2 non-overlap (the core requirement) ----------
console.log('\n--- v1 vs v2 non-overlap ---');
for (const code of Object.keys(EXPECTED_INTENTS)) {
  const exV1 = perDomainExamples[code].v1, exV2 = perDomainExamples[code].v2;
  const scV1 = perDomainScenTexts[code].v1, scV2 = perDomainScenTexts[code].v2;
  const exOverlap = exV1.filter(e => exV2.includes(e));
  const scOverlap = scV1.filter(s => scV2.includes(s));
  check(`${code}: v1/v2 example overlap = 0`, exOverlap.length === 0, exOverlap.join(' | '));
  check(`${code}: v1/v2 scenario-text overlap = 0`, scOverlap.length === 0, scOverlap.join(' | '));
  console.log(`  ${code}: v1 ${scV1.length} scen/${exV1.length} ex | v2 ${scV2.length} scen/${exV2.length} ex | overlap ${scOverlap.length}/${exOverlap.length}`);
}

// ---------- totals ----------
const totScen = Object.values(docs).reduce((a, d) => a + d.scenarios.length, 0);
const totEx = Object.values(docs).reduce((a, d) => a + d.counts.examples, 0);
check(`TOTAL scenarios = ${EXPECTED_TOTALS.scenarios}`, totScen === EXPECTED_TOTALS.scenarios, `got ${totScen}`);
check(`TOTAL examples = ${EXPECTED_TOTALS.examples}`, totEx === EXPECTED_TOTALS.examples, `got ${totEx}`);

// ---------- cross-check intent sets v1 vs v2 ----------
console.log('\n--- intent parity between v1 and v2 ---');
for (const code of Object.keys(EXPECTED_INTENTS)) {
  const a = new Set(docs[`${code.toLowerCase()}_v1.json`].intents);
  const b = new Set(docs[`${code.toLowerCase()}_v2.json`].intents);
  const onlyA = [...a].filter(x => !b.has(x));
  const onlyB = [...b].filter(x => !a.has(x));
  check(`${code}: v1 and v2 cover identical intents`, onlyA.length === 0 && onlyB.length === 0,
        `onlyV1=${onlyA} onlyV2=${onlyB}`);
  console.log(`  ${code}: ${a.size} intents, identical across versions: ${onlyA.length === 0 && onlyB.length === 0}`);
}

// ---------- taxonomy alignment ----------
console.log('\n--- taxonomy alignment ---');
const TAX = {
  BNK: ['check_balance','mini_statement','transfer_money','block_card','report_fraud','card_status','reset_pin','loan_enquiry','bill_payment','branch_atm_locate','account_open','out_of_scope'],
  EDU: ['explain_concept','solve_problem','define_term','give_example','quiz_me','translate_text','study_plan','assignment_help','recommend_resource','check_answer','out_of_scope'],
  TRV: ['book_ticket','cancel_ticket','check_pnr','live_status','fare_enquiry','seat_availability','reschedule_trip','refund_ticket','book_cab','schedule_enquiry','out_of_scope'],
  VAS: ['set_reminder','set_alarm','play_music','navigate','weather_query','make_call','send_message','search_info','set_timer','control_device','out_of_scope'],
};
for (const [code, expected] of Object.entries(TAX)) {
  const got = docs[`${code.toLowerCase()}_v1.json`].intents.map(i => i.split('.')[1]).sort();
  const exp = [...expected].sort();
  const missing = exp.filter(x => !got.includes(x));
  const extra = got.filter(x => !exp.includes(x));
  check(`${code}: matches taxonomy intent set`, missing.length === 0 && extra.length === 0,
        `missing=${missing} extra=${extra}`);
  console.log(`  ${code}: ${got.length} intents — missing ${missing.length}, unexpected ${extra.length}`);
}

// ---------- report ----------
console.log('\n' + '='.repeat(72));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(72));
if (fail) {
  console.log('\nFAILURES:');
  problems.slice(0, 40).forEach(p => console.log('  ✗ ' + p));
  if (problems.length > 40) console.log(`  ... and ${problems.length - 40} more`);
  process.exit(1);
} else {
  console.log('  All checks passed.');
}
