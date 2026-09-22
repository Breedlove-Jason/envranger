import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt, derive, keypair } from '@dotenvx/primitives';
import { duplicates, parseDocument, readDocument, safePath, update, values, writeFile, type Entry } from './files.js';
export const isPublicKey = (key: string) => /^DOTENV_PUBLIC_KEY(?:_[A-Z0-9_]+)?$/.test(key);
export const isPrivateKey = (key: string) => key.startsWith('DOTENV_PRIVATE_KEY') || key === 'DOTENV_KEY';
export const isMetadata = (key: string) => isPublicKey(key) || isPrivateKey(key);
export const encrypted = (value: string) => value.startsWith('encrypted:');
export type KeyOptions = { keysFile?: string; privateKeys?: Readonly<Record<string,string | undefined>> };
export function publicMetadata(doc: Entry[]) {
  const data = values(doc);
  if (Object.keys(data).some(isPrivateKey)) throw new Error('Private keys must be stored separately from application environment files.');
  const names = Object.keys(data).filter(isPublicKey);
  if (names.length > 1) throw new Error('Use one dotenvx public key per environment file.');
  if (!names.length) return null;
  if (!/^(02|03)[a-fA-F0-9]{64}$/.test(data[names[0]])) throw new Error('Invalid dotenvx public key.');
  return {name:names[0],value:data[names[0]],privateName:names[0].replace('PUBLIC','PRIVATE')};
}
function keyFile(root: string, file: string, opts: KeyOptions) {
  return safePath(root,opts.keysFile ?? path.join(path.dirname(file),'.env.keys'));
}
function localKeys(root: string, file: string, opts: KeyOptions) {
  const target = keyFile(root,file,opts);
  const doc = readDocument(target,true);
  if (duplicates(doc).length) throw new Error('Duplicate names in private key file.');
  return values(doc);
}
function privateFor(root: string, file: string, meta: NonNullable<ReturnType<typeof publicMetadata>>, opts: KeyOptions): string {
  // An explicitly supplied key takes precedence; wrong keys never silently fall back.
  const supplied = (opts.privateKeys ?? process.env)[meta.privateName];
  const privateKey = supplied ?? localKeys(root,file,opts)[meta.privateName];
  if (!privateKey) throw new Error(`Missing ${meta.privateName}; provide it through the environment or a private key file.`);
  try { if (derive(privateKey) !== meta.value.toLowerCase()) throw new Error(); }
  catch { throw new Error(`Private key does not match the public key for ${file}.`); }
  return privateKey;
}
export function decodeDocument(root: string, file: string, doc: Entry[], opts: KeyOptions = {}) {
  const meta = publicMetadata(doc); const data = values(doc);
  const secret = Object.entries(data).some(([k,v])=>!isMetadata(k)&&encrypted(v));
  if (secret && !meta) throw new Error(`Encrypted values in ${file} need dotenvx public-key metadata.`);
  const key = secret ? privateFor(root,file,meta!,opts) : undefined;
  const result: Record<string,string> = Object.create(null);
  for (const [name,value] of Object.entries(data)) {
    if (isMetadata(name)) continue;
    try { result[name] = encrypted(value) ? decrypt(key!,value) : value; }
    catch { throw new Error(`Cannot decrypt ${name} in ${file}; no values were loaded.`); }
  }
  return result;
}
export function encryptedEdit(doc: Entry[], key: string, value?: string) {
  if (isMetadata(key)) throw new Error('Encryption metadata cannot be edited as an application variable.');
  const meta = publicMetadata(doc);
  if (!meta && Object.values(values(doc)).some(encrypted)) throw new Error('Encrypted file is missing public-key metadata.');
  let stored = value;
  if (value !== undefined && meta) {
    try { stored = encrypt(meta.value,value); } catch { throw new Error('Cannot encrypt the new value with this public key.'); }
  }
  return update(doc,key,stored);
}
export function encryptFile(root: string, file: string, opts: KeyOptions & {write?:boolean; publicKey?:string} = {}) {
  const target = safePath(root,file); const doc = readDocument(target);
  if (duplicates(doc).length) throw new Error('Resolve duplicate keys before encrypting.');
  const meta = publicMetadata(doc); const data = values(doc);
  if (meta && opts.publicKey && meta.value !== opts.publicKey) throw new Error('The supplied public key differs from the file key. Key rotation must be performed separately.');
  if (!meta && Object.values(data).some(encrypted)) throw new Error('Cannot encrypt a file with orphaned ciphertext. Restore its public key first.');
  const basename = path.basename(file);
  if (!meta && !/^\.env(?:\.[A-Za-z0-9_]+)*$/.test(basename)) throw new Error('Use a .env or .env.environment filename for dotenvx encryption.');
  if (basename === '.env.keys' || basename.endsWith('.example')) throw new Error('Do not encrypt private-key files or blank examples.');
  const suffix = basename === '.env' ? '' : '_'+basename.slice(5).replace(/\./g,'_').toUpperCase();
  const publicName = meta?.name ?? 'DOTENV_PUBLIC_KEY'+suffix;
  const privateName = meta?.privateName ?? 'DOTENV_PRIVATE_KEY'+suffix;
  let publicKey = meta?.value ?? opts.publicKey;
  let keysText: string | undefined;
  if (!publicKey) {
    const existing = localKeys(root,file,opts)[privateName];
    if (existing) {
      try { publicKey = derive(existing); } catch { throw new Error('Invalid existing private key; nothing changed.'); }
    } else {
      const pair = keypair(); publicKey = pair.publicKey;
      keysText = update(readDocument(keyFile(root,file,opts),true),privateName,pair.privateKey);
    }
  }
  // Validate supplied public keys through dotenvx even for an empty file.
  try { encrypt(publicKey,''); } catch { throw new Error('Invalid dotenvx public key.'); }
  let next = doc.map(e=>e.raw).join('');
  if (!meta) next = update(parseDocument(next),publicName,publicKey);
  const keys = Object.keys(data).filter(k=>!isMetadata(k));
  for (const key of keys) if (!encrypted(data[key])) next = update(parseDocument(next),key,encrypt(publicKey,data[key]));
  if (opts.write) {
    // Preflight all paths before writes, including the backup location.
    const keyTarget=keyFile(root,file,opts); safePath(root,'.envranger/backups');
    if(keyTarget===target) throw new Error('Private-key file must differ from the encrypted environment file.');
    const ignorePath=safePath(root,'.gitignore');
    const ignored=fs.existsSync(ignorePath)?fs.readFileSync(ignorePath,'utf8'):'';
    const relKey=path.relative(fs.realpathSync(root),keyTarget).split(path.sep).join('/');
    if(/[\n\r!\[\]*?\\]/.test(relKey)) throw new Error('Use a simple private-key file path without glob characters.');
    const rules=`\n# envRanger private material\n/${relKey}\n.env.keys\n.envranger/\n`;
    if(!ignored.includes(rules)) writeFile('.gitignore',ignored+rules,root);
    if(keysText!==undefined) writeFile(path.relative(root,keyTarget),keysText,root);
    // Do not leave a new plaintext backup behind when encrypting a file.
    writeFile(file,next,root,false);
  }
  return {action:opts.write?'encrypted':'preview',file,keys,publicKeyName:publicName,publicKey,privateKeyFile:keysText===undefined?undefined:path.relative(root,keyFile(root,file,opts))};
}
