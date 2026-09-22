declare module '@dotenvx/primitives' {
  export function encrypt(publicKey: string, value: string): string;
  export function decrypt(privateKey: string, value: string): string;
  export function derive(privateKey: string): string;
  export function keypair(): {publicKey:string; privateKey:string};
}
