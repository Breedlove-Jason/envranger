import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseDocument,values,encode,update,safePath} from '../dist/index.js';
const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
function fixture(t, files={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'envranger-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,text] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text);}
 return {root,read:name=>fs.readFileSync(path.join(root,name),'utf8'),run:(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:{...process.env,ENVRANGER_SENTINEL:'do-not-copy-me'}})};
}
test('literal parser handles export, CRLF, comments, multiline and empty values',()=>{
 const env=values(parseDocument('export A = "one # two"\r\nB=bare # comment\nC=\'line1\nline2\'\nEMPTY=\n'));
 assert.deepEqual({...env},{A:'one # two',B:'bare',C:'line1\nline2',EMPTY:''});
});
test('values round-trip without interpolation or shell evaluation',()=>{
 for(const value of ['abc','a#b','two words','line1\nline2','literal\\n','both\'and"','${SECRET}','$(whoami)','`quote`']) assert.equal(values(parseDocument(`KEY=${encode(value)}\n`)).KEY,value);
 assert.throws(()=>encode('a\'"`b'));
});
test('malformed input fails closed and does not echo its contents',()=>{
 for(const text of ['this is a secret','KEY="secret\n','KEY="x" trailing-secret']) assert.throws(()=>parseDocument(text),e=>!e.message.includes('secret'));
});
test('updates preserve unrelated comments and multiline values',()=>{
 const text='# header\nA=old\n# keep\nB=\'one\ntwo\'\n';
 assert.equal(update(parseDocument(text),'A','new'),'# header\nA=new\n# keep\nB=\'one\ntwo\'\n');
 assert.equal(update(parseDocument(text),'B',undefined),'# header\nA=old\n# keep\n');
 assert.throws(()=>update(parseDocument('A=1\nA=2\n'),'A','3'),/duplicate/i);
});
test('set previews, applies privately and creates a restorable backup',t=>{
 const f=fixture(t,{'.env':'TOKEN=before\n'});
 assert.equal(f.run('set','TOKEN','after').status,0);assert.equal(f.read('.env'),'TOKEN=before\n');
 const result=f.run('set','TOKEN','after','--write');assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes('after'));
 assert.equal(f.read('.env'),'TOKEN=after\n');
 const backups=fs.readdirSync(path.join(f.root,'.envranger/backups'));assert.equal(backups.length,1);
 assert.equal(f.read('.envranger/backups/'+backups[0]),'TOKEN=before\n');
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(f.root,'.env')).mode & 0o777,0o600);
});
test('stdin input is exact and never printed',t=>{
 const f=fixture(t);const result=spawnSync(process.execPath,[cli,'set','TOKEN','--stdin','--write'],{cwd:f.root,input:'private\nvalue',encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes('private'));assert.equal(values(parseDocument(f.read('.env'))).TOKEN,'private\nvalue');
});
test('get masks short secrets completely unless explicitly revealed',t=>{
 const f=fixture(t,{'.env':'TOKEN=abc\n'});assert.equal(f.run('get','TOKEN').stdout.trim(),'[REDACTED]');assert.equal(f.run('get','TOKEN','--reveal').stdout.trim(),'abc');
});
test('AST scan finds bracket and Vite references, ignores comments and strings',t=>{
 const f=fixture(t,{'src/main.ts':'// process.env.FAKE\nconst a="process.env.STRING"; const b=process.env["TOKEN"]; const c=import.meta.env.VITE_URL; const d=process.env[key];'});
 const result=f.run('scan');assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).keys,['TOKEN','VITE_URL']);
});
test('checks detect empty and missing required values but respect optional keys',t=>{
 const f=fixture(t,{'.env':'TOKEN=\n','src/main.ts':'process.env.TOKEN; process.env.OPTIONAL; process.env.MISSING;','envranger.config.json':JSON.stringify({optional:['OPTIONAL']})});
 const result=f.run('check');assert.equal(result.status,1);const data=JSON.parse(result.stdout);assert.deepEqual(data.empty,['TOKEN']);assert.deepEqual(data.missing,['MISSING']);
});
test('examples never inherit shell values or copy source values',t=>{
 const f=fixture(t,{'.env':'TOKEN=private-secret\n'});assert.equal(f.run('example','--write').status,0);
 const text=f.read('.env.example');assert.ok(text.includes('TOKEN='));assert.ok(!text.includes('private-secret'));assert.ok(!text.includes('ENVRANGER_SENTINEL'));
});
test('profile precedence is explicit and provenance matches winning file',t=>{
 const f=fixture(t,{'.env':'A=first\n','.env.local':'A=second\n','envranger.config.json':JSON.stringify({profiles:{dev:['.env','.env.local']}})});
 assert.equal(f.run('get','A','--profile','dev','--reveal').stdout.trim(),'second');assert.equal(JSON.parse(f.run('list','--profile','dev').stdout)[0].source,'.env.local');
 assert.equal(f.run('list','--profile','missing').status,1);assert.equal(f.run('list','--profile','dev','--env','.env').status,1);
});
test('route preflights all destinations, preserves sources and refuses conflicts',t=>{
 const cfg={routes:{'apps/web/.env.local':['VITE_URL'],'apps/api/.env':['TOKEN']}};
 const f=fixture(t,{'.env':'VITE_URL=https://example.test\nTOKEN=private\n','apps/api/.env':'TOKEN=existing\n','envranger.config.json':JSON.stringify(cfg)});
 assert.equal(f.run('route','--write').status,1);assert.ok(!fs.existsSync(path.join(f.root,'apps/web/.env.local')));assert.equal(f.read('apps/api/.env'),'TOKEN=existing\n');
 assert.equal(f.run('route','--overwrite').status,0);assert.ok(!fs.existsSync(path.join(f.root,'apps/web/.env.local')));
 const result=f.run('route','--overwrite','--write');assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes('private'));assert.equal(f.read('apps/api/.env'),'TOKEN=private\n');assert.ok(f.read('.env').includes('TOKEN=private'));
});
test('missing source keys prevent all routing writes',t=>{
 const f=fixture(t,{'.env':'A=1\n','envranger.config.json':JSON.stringify({routes:{'out/.env':['A','B']}})});
 assert.equal(f.run('route','--write').status,1);assert.ok(!fs.existsSync(path.join(f.root,'out')));
});
test('path escapes and symbolic links are refused',t=>{
 const f=fixture(t);assert.throws(()=>safePath(f.root,'../outside'),/inside/);
 if(process.platform!=='win32'){fs.symlinkSync(os.tmpdir(),path.join(f.root,'link'));assert.throws(()=>safePath(f.root,'link/.env'),/Symbolic/);}
 assert.equal(f.run('set','A','1','--env','../outside','--write').status,1);
});
test('init preserves existing configuration and values, adds ignore rules',t=>{
 const f=fixture(t,{'.env':'TOKEN=keep\n','.env.example':'TOKEN=\n','envranger.config.json':'{}\n'});
 assert.equal(f.run('init','--write').status,0);assert.equal(f.read('.env'),'TOKEN=keep\n');assert.equal(f.read('envranger.config.json'),'{}\n');assert.ok(f.read('.gitignore').includes('.envranger/'));
});
test('merge uses later precedence and refuses accidental destination overwrite',t=>{
 const f=fixture(t,{'a.env':'A=one\n','b.env':'A=two\nB=three\n'});
 assert.equal(f.run('merge','out.env','a.env','b.env','--write').status,0);assert.equal(f.read('out.env'),'A=two\nB=three\n');assert.equal(f.run('merge','out.env','a.env','--write').status,1);
});
test('run supplies values, preserves inherited env and propagates child status',t=>{
 const f=fixture(t,{'.env':'ENVRANGER_SENTINEL=from-file\n'});
 const code='console.log(process.env.ENVRANGER_SENTINEL);process.exit(7)';
 const result=f.run('run','--env','.env','--',process.execPath,'-e',code);assert.equal(result.status,7,result.stderr);assert.equal(result.stdout.trim(),'do-not-copy-me');
 const over=f.run('run','--override','--',process.execPath,'-e',code);assert.equal(over.status,7);assert.equal(over.stdout.trim(),'from-file');
});
test('JSON reports contain only key information',t=>{
 const f=fixture(t,{'.env':'TOKEN=secret-12345\n'});const result=f.run('doctor','--report');assert.equal(result.status,0,result.stderr);assert.ok(!f.read('.envranger/report.json').includes('secret-12345'));
});
