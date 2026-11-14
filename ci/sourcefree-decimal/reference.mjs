import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Independent source-free JavaScript reference, not private Oreslang source.
const maxBytes=1024;
function lexicallyValid(s) {
  return typeof s==='string' && Buffer.byteLength(s,'utf8')<=maxBytes
    && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(s);
}
function admissible(s,min=null,max=null) {
  if(!lexicallyValid(s))return false;
  // No numeric interval: preserve arbitrary valid JSON-number text, including
  // values that do not fit a binary64 number. No float conversion is needed.
  if(min===null&&max===null)return true;
  // Absence of a bound is null, NEVER +/-Infinity. Otherwise nearly every
  // negative regression could pass vacuously for the wrong reason.
  if((min!==null&&!Number.isFinite(min))||
     (max!==null&&!Number.isFinite(max)))return false;
  const v=Number(s);
  if(!Number.isFinite(v))return false;
  if(v===0&&/[1-9]/.test(s.split(/[eE]/)[0]))return false;
  return (min===null||v>=min)&&(max===null||v<=max);
}
// [name, lexical value, optional inclusive min/max, expected admission].
const tests=[
['leading zero','01',0,null,false],
['negative leading zero','-01',null,0,false],
['positive overflow','9e308',0,null,false],
['negative overflow','-9e308',null,0,false],
['underflow','0.'+'0'.repeat(400)+'1',0,null,false],
['oversized','1'.repeat(1025),0,null,false],
['zero','0.0',0,0,true],
['finite exponent','1e3',999,1001,true],
['no integer part','.1',0,null,false],
['missing fraction','1.',0,null,false],
['missing exponent','1e+',0,null,false],
['leading plus','+1',0,null,false],
['nonascii','1\u00a0',0,null,false],
['negative zero','-0',0,0,true],
['positive exponent','1e+3',999,1001,true],
['exponent underflow','1e-400',0,null,false],
['range tight','-0.5',-1,0,true],
['invalid suffix','1hello',0,null,false],
['unbounded large valid number','9e308',null,null,true],
['unbounded negative large valid number','-9e308',null,null,true],
['unbounded extreme exponent syntax','1e400',null,null,true],
['unbounded underflow syntax','1e-400',null,null,true],
['unbounded leading zero','01',null,null,false],
['unbounded missing fraction','1.',null,null,false],
['unbounded signed zero','-0',null,null,true],
['unbounded signed exponent','1E-003',null,null,true],
['invalid positive infinite bound','1',Infinity,null,false],
['invalid NaN lower bound','1',NaN,null,false],
['invalid negative infinite upper bound','1',null,-Infinity,false]
];
for(const [name,value,min,max,expected] of tests) {
  assert.equal(admissible(value,min,max),expected,name);
}
// Guard against the previous test-harness bug. Valid values MUST actually
// succeed with an absent bound; "no bound" must never be an invalid number.
assert.equal(admissible('1',0,null),true);
assert.equal(admissible('-1',null,0),true);
assert.equal(admissible('1',null,null),true);
assert.equal(admissible('1',0,0),false);
const receipt={
  schema:'sourcefree-decimal-reference/v2',
  checks:tests.length+4,
  cases:tests.length,
  absenceOfBoundRepresentedAs:'null',
  independentlyVerifiedUnboundedMode:true,
  sourceFreeOnly:true,privateSourceTransferred:false,
  nativeOreslangCompilerExecuted:false,nativeOreslangRuntimeExecuted:false,
  releaseReady:false,
  fixtureSha256:createHash('sha256').update(JSON.stringify(tests)).digest('hex')
};
console.log(JSON.stringify(receipt));
