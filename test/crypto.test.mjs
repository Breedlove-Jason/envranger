import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {encryptFile,loadFiles,readDocument,values,publicMetadata,routePlan,applyPlan} from '../dist/index.js';
import {loadEnv} from '../dist/loader.js';
import {encrypt,keypair} from '@dotenvx/primitives';
const require=createRequire(import.meta.url);
const cli=fileURLToPath(new URL('../dist/cli.js',import.meta.url));
function fixture(t,files={}) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'envranger-crypto-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const [name,text] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),text);}
 return {root,read:name=>fs.readFileSync(path.join(root,name),'utf8'),run:(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOTENV_')))})};
}
test('dotenvx encryption previews, writes ciphertext, saves public metadata, and decrypts only in memory',t=>{
 const f=fixture(t,{'.env':'TOKEN=private-value\nEMPTY=\nMULTI=\'one\ntwo\'\n'});
 encryptFile(f.root,'.env');assert.equal(f.read('.env'),'TOKEN=private-value\nEMPTY=\nMULTI=\'one\ntwo\'\n');assert.ok(!fs.existsSync(path.join(f.root,'.env.keys')));
 const result=encryptFile(f.root,'.env',{write:true});assert.ok(f.read('.env').includes(result.publicKey));assert.ok(!f.read('.env').includes('private-value'));
 assert.equal(loadFiles(f.root,['.env']).env.TOKEN,'private-value');assert.equal(loadFiles(f.root,['.env']).env.MULTI,'one\ntwo');
 assert.ok(!Object.keys(loadFiles(f.root,['.env']).env).some(k=>k.startsWith('DOTENV_')));
 assert.ok(f.read('.gitignore').includes('/.env.keys'));assert.ok(!fs.existsSync(path.join(f.root,'.envranger/backups')));
 assert.ok(!JSON.stringify(result).includes(values(readDocument(path.join(f.root,'.env.keys'))).DOTENV_PRIVATE_KEY));
});
test('dotenvx config can decrypt envRanger output with the saved private key',t=>{
 const f=fixture(t,{'.env':'TOKEN=private-value\n'});encryptFile(f.root,'.env',{write:true});
 const runtime={...values(readDocument(path.join(f.root,'.env.keys')))};
 const dotenvx=require('@dotenvx/dotenvx');dotenvx.config({path:path.join(f.root,'.env'),processEnv:runtime,strict:true,quiet:true,noArmor:true,noNative:true,no1Password:true,noBitwarden:true,envKeysFile:path.join(f.root,'.env.keys')});
 assert.equal(runtime.TOKEN,'private-value');
});
test('existing public key is preserved by repeat encryption and encrypted set',t=>{
 const f=fixture(t,{'.env':'TOKEN=original\n'});encryptFile(f.root,'.env',{write:true});const before=f.read('.env.keys');const pub=publicMetadata(readDocument(path.join(f.root,'.env'))).value;
 const res=f.run('set','TOKEN','replacement','--write');assert.equal(res.status,0,res.stderr);assert.ok(!res.stdout.includes('replacement'));assert.ok(!f.read('.env').includes('replacement'));
 encryptFile(f.root,'.env',{write:true});assert.equal(f.read('.env.keys'),before);assert.equal(publicMetadata(readDocument(path.join(f.root,'.env'))).value,pub);assert.equal(loadFiles(f.root,['.env']).env.TOKEN,'replacement');
});
test('recipient public key can encrypt a file without saving or possessing the recipient private key',t=>{
 const f=fixture(t,{'.env':'TOKEN=for-recipient\n'});const pair=keypair();encryptFile(f.root,'.env',{write:true,publicKey:pair.publicKey});
 assert.ok(!fs.existsSync(path.join(f.root,'.env.keys')));assert.throws(()=>loadFiles(f.root,['.env'],{privateKeys:{}}),/Missing/);
 assert.equal(loadFiles(f.root,['.env'],{privateKeys:{DOTENV_PRIVATE_KEY:pair.privateKey}}).env.TOKEN,'for-recipient');
});
test('wrong, missing and corrupted keys fail closed without leaking contents',t=>{
 const f=fixture(t,{'.env':'TOKEN=unprintable-secret\n'});encryptFile(f.root,'.env',{write:true});
 assert.throws(()=>loadFiles(f.root,['.env'],{privateKeys:{DOTENV_PRIVATE_KEY:keypair().privateKey}}),/does not match/);
 fs.unlinkSync(path.join(f.root,'.env.keys'));const res=f.run('list');assert.equal(res.status,1);assert.ok(!res.stderr.includes('unprintable-secret'));assert.equal(res.stdout,'');
});
test('dotenvx-generated ciphertext decrypts without command evaluation or expansion',t=>{
 const pair=keypair();const value='$(touch should-not-exist) ${HOME}';
 const f=fixture(t,{'.env':`DOTENV_PUBLIC_KEY=${pair.publicKey}\nTOKEN="${encrypt(pair.publicKey,value)}"\n`});
 const result=loadFiles(f.root,['.env'],{privateKeys:{DOTENV_PRIVATE_KEY:pair.privateKey}});assert.equal(result.env.TOKEN,value);assert.ok(!fs.existsSync(path.join(f.root,'should-not-exist')));
});
test('profile-specific keys and central key-file override work',t=>{
 const f=fixture(t,{'.env.production':'TOKEN=production-secret\n'});encryptFile(f.root,'.env.production',{write:true,keysFile:'secure/keys'});
 assert.equal(loadFiles(f.root,['.env.production'],{keysFile:'secure/keys'}).env.TOKEN,'production-secret');assert.ok(f.read('secure/keys').includes('DOTENV_PRIVATE_KEY_PRODUCTION='));
});
test('encrypted routes preserve recipient keys and never downgrade output silently',t=>{
 const f=fixture(t,{'.env':'TOKEN=source-secret\n','backend/.env':'TOKEN=old-secret\n'});encryptFile(f.root,'.env',{write:true});encryptFile(f.root,'backend/.env',{write:true});
 const pub=publicMetadata(readDocument(path.join(f.root,'backend/.env'))).value;const env=loadFiles(f.root,['.env']).env;const cfg={routes:{'backend/.env':['TOKEN']}};
 assert.throws(()=>routePlan(f.root,cfg,env,false,{encryptedSource:true}),/Conflicting/);
 fs.unlinkSync(path.join(f.root,'backend/.env.keys'));
 const plan=routePlan(f.root,cfg,env,true,{encryptedSource:true});applyPlan(f.root,plan);assert.ok(f.read('backend/.env').includes(pub));assert.ok(!f.read('backend/.env').includes('source-secret'));
 assert.throws(()=>routePlan(f.root,{routes:{'frontend/.env':['TOKEN']}},env,false,{encryptedSource:true}),/plaintext/);
});
test('private key material cannot be loaded as application env or routed',t=>{
 const f=fixture(t,{'.env':'DOTENV_PRIVATE_KEY=should-not-load\n'});assert.throws(()=>loadFiles(f.root,['.env']),/separately/);
 assert.throws(()=>routePlan(f.root,{routes:{'target/.env':['DOTENV_PRIVATE_KEY']}},{DOTENV_PRIVATE_KEY:'no'}),/encryption keys/);
});
test('loader scopes are isolated, frozen, and do not return process.env or key material',t=>{
 const f=fixture(t,{'.env':'PUBLIC_URL=https://example.test\nDATABASE_URL=private-db\n','envranger.config.json':JSON.stringify({access:{frontend:['PUBLIC_URL'],backend:['DATABASE_URL'],root:true}})});encryptFile(f.root,'.env',{write:true});
 const front=loadEnv({root:f.root,scope:'frontend'});assert.deepEqual({...front},{PUBLIC_URL:'https://example.test'});assert.ok(Object.isFrozen(front));
 const back=loadEnv({root:f.root,scope:'backend'});assert.deepEqual({...back},{DATABASE_URL:'private-db'});
 assert.throws(()=>loadEnv({root:f.root,scope:'root'}),/Root access/);
 const all=loadEnv({root:f.root,scope:'root',allowRoot:true});assert.deepEqual(Object.keys(all).sort(),['DATABASE_URL','PUBLIC_URL']);
 assert.throws(()=>loadEnv({root:f.root,scope:'frontend',populate:true}),/cannot populate/);
});
test('root needs both opt-ins; absent scope lists fail closed',t=>{
 const f=fixture(t,{'.env':'TOKEN=private\n'});assert.throws(()=>loadEnv({root:f.root,scope:'root',allowRoot:true}),/Root access/);assert.throws(()=>loadEnv({root:f.root}),/access.backend/);
});
test('failed validation never partially populates process.env and library never exits',t=>{
 const f=fixture(t,{'.env':'ENVRANGER_TEST_VALUE=test\n','envranger.config.json':JSON.stringify({access:{backend:['ENVRANGER_TEST_VALUE','MISSING']}})});
 assert.throws(()=>loadEnv({root:f.root,populate:true,required:['MISSING']}),/Missing required/);assert.equal(process.env.ENVRANGER_TEST_VALUE,undefined);
 assert.throws(()=>loadEnv({root:f.root,required:['OUTSIDE']}),/outside/);
});
test('loader does not cache stale secrets across calls',t=>{
 const f=fixture(t,{'.env':'TOKEN=one\n','envranger.config.json':JSON.stringify({access:{backend:['TOKEN']}})});
 assert.equal(loadEnv({root:f.root}).TOKEN,'one');fs.writeFileSync(path.join(f.root,'.env'),'TOKEN=two\n');assert.equal(loadEnv({root:f.root}).TOKEN,'two');
});
test('keys and example commands omit private material',t=>{
 const f=fixture(t,{'.env':'TOKEN=private-value\n'});encryptFile(f.root,'.env',{write:true});
 const keys=f.run('keys');assert.equal(keys.status,0,keys.stderr);assert.ok(!keys.stdout.includes('private-value'));
 assert.equal(f.run('example','--write').status,0);assert.ok(!f.read('.env.example').includes('DOTENV_'));assert.ok(!f.read('.env.example').includes('private-value'));
});
test('corrupt ciphertext fails before process injection and never prints data',t=>{
 const pair=keypair();const f=fixture(t,{'.env':`DOTENV_PUBLIC_KEY=${pair.publicKey}\nENVRANGER_CORRUPT="encrypted:not-valid"\n`,'envranger.config.json':JSON.stringify({access:{backend:['ENVRANGER_CORRUPT']}})});
 assert.throws(()=>loadEnv({root:f.root,populate:true,privateKeys:{DOTENV_PRIVATE_KEY:pair.privateKey}}),/Cannot decrypt/);assert.equal(process.env.ENVRANGER_CORRUPT,undefined);
});
test('source scanning and examples never advertise dotenv private key controls',t=>{
 const f=fixture(t,{'.env':'TOKEN=demo\n','src/keys.js':'process.env.DOTENV_PRIVATE_KEY; process.env.DOTENV_PRIVATE_KEY_PRODUCTION; process.env.TOKEN;'});
 const result=f.run('scan');assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).keys,['TOKEN']);
 assert.equal(f.run('example','--write').status,0);assert.ok(!f.read('.env.example').includes('DOTENV_'));
});
test('run does not pass the parent decryption key to the child',t=>{
 const f=fixture(t,{'.env':'TOKEN=demo\n'});const pair=keypair();encryptFile(f.root,'.env',{write:true,publicKey:pair.publicKey});
 const result=spawnSync(process.execPath,[cli,'run','--',process.execPath,'-e',"console.log(process.env.TOKEN, Boolean(process.env.DOTENV_PRIVATE_KEY))"],{cwd:f.root,encoding:'utf8',env:{...process.env,DOTENV_PRIVATE_KEY:pair.privateKey}});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'demo false');
});
