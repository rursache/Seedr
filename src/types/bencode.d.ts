declare module 'bencode' {
  function encode(data: any): Buffer;
  function decode(data: Buffer | Uint8Array): any;
  export default { encode, decode };
}
