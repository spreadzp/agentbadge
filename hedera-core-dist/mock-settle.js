export async function mockSettle(_payTo, _amount) {
    const accountId = process.env.HEDERA_OPERATOR_ID ?? "0.0.2";
    const seconds = Math.floor(Date.now() / 1000);
    const nanos = Math.floor(Math.random() * 1_000_000_000);
    return `${accountId}@${seconds}.${nanos}`;
}
