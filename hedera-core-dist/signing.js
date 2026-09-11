import { Transaction, PrivateKey } from "@hashgraph/sdk";
export function signTransactionBytes(txBytesBase64, privateKeyHex) {
    if (!txBytesBase64)
        throw new Error("txBytesBase64 is required");
    if (!privateKeyHex)
        throw new Error("privateKeyHex is required");
    const txBytes = Buffer.from(txBytesBase64, "base64");
    const tx = Transaction.fromBytes(txBytes);
    const privateKey = PrivateKey.fromString(privateKeyHex);
    const signatureBytes = privateKey.signTransaction(tx, true);
    const publicKey = privateKey.publicKey.toStringDer();
    const sigArray = Array.isArray(signatureBytes) ? signatureBytes : [signatureBytes];
    return {
        publicKey,
        signature: JSON.stringify(sigArray.map((sb) => Buffer.from(sb).toString("base64"))),
    };
}
