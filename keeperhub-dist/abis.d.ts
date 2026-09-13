export declare const TRUST_REGISTRY_RECORD_SCAN_ABI: readonly [{
    readonly type: "function";
    readonly name: "recordScan";
    readonly inputs: readonly [{
        readonly name: "siteUrl";
        readonly type: "string";
    }, {
        readonly name: "score";
        readonly type: "uint8";
    }, {
        readonly name: "rulesPassed";
        readonly type: "uint16";
    }, {
        readonly name: "rulesTotal";
        readonly type: "uint16";
    }];
    readonly outputs: readonly [{
        readonly name: "id";
        readonly type: "uint256";
    }];
    readonly stateMutability: "nonpayable";
}];
export declare const TRUST_BADGE_MINT_ABI: readonly [{
    readonly type: "function";
    readonly name: "mint";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "siteUrl";
        readonly type: "string";
    }, {
        readonly name: "score";
        readonly type: "uint8";
    }, {
        readonly name: "uri";
        readonly type: "string";
    }];
    readonly outputs: readonly [{
        readonly name: "id";
        readonly type: "uint256";
    }];
    readonly stateMutability: "nonpayable";
}];
export declare const AGENT_PASSPORT_MINT_ABI: readonly [{
    readonly type: "function";
    readonly name: "mint";
    readonly inputs: readonly [{
        readonly name: "to";
        readonly type: "address";
    }, {
        readonly name: "uri";
        readonly type: "string";
    }, {
        readonly name: "tier";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "id";
        readonly type: "uint256";
    }];
    readonly stateMutability: "nonpayable";
}];
export declare function toAbiJson(fragment: readonly unknown[]): string;
