export interface SignatureResult {
    publicKey: string;
    signature: string;
}
export declare function signTransactionBytes(txBytesBase64: string, privateKeyHex: string): SignatureResult;
