import { HederaChainAdapter } from "./hedera-chain-adapter";
let _instance = null;
export const hederaChainAdapter = new Proxy({}, {
    get(_target, prop) {
        if (!_instance) {
            _instance = new HederaChainAdapter();
        }
        return Reflect.get(_instance, prop);
    },
});
