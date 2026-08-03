export const TIER_PRICES_HBAR = {
    bronze: 10,
    silver: 50,
    gold: 200,
    platinum: 500,
};
export function isValidA2AMessage(obj) {
    if (typeof obj !== "object" || obj === null)
        return false;
    const o = obj;
    return (o.type === "a2a_message" &&
        typeof o.from === "string" &&
        typeof o.to === "string" &&
        typeof o.body === "string" &&
        typeof o.contentType === "string" &&
        typeof o.timestamp === "number");
}
export function isValidTaskMessage(obj) {
    if (typeof obj !== "object" || obj === null)
        return false;
    const o = obj;
    if (typeof o.taskId !== "string" || typeof o.timestamp !== "number")
        return false;
    switch (o.type) {
        case "task_posted":
            return (typeof o.posterDid === "string" &&
                typeof o.title === "string" &&
                typeof o.description === "string" &&
                typeof o.priceHbar === "number" &&
                Array.isArray(o.capabilities) &&
                o.capabilities.every((c) => typeof c === "string"));
        case "task_claimed":
            return typeof o.claimerDid === "string";
        case "task_delivered":
            return ((o.resultIpfs === undefined || typeof o.resultIpfs === "string") &&
                (o.resultBody === undefined || typeof o.resultBody === "string"));
        case "task_completed":
            return typeof o.paymentTxId === "string";
        case "task_verification_failed":
            return (typeof o.claimerDid === "string" &&
                typeof o.report === "string");
        case "task_escrow_created":
            return (typeof o.scheduleId === "string" &&
                typeof o.amountHbar === "number");
        case "task_cancelled":
            return (o.scheduleId === undefined || typeof o.scheduleId === "string");
        case "task_reward_increased":
            return (typeof o.oldPriceHbar === "number" &&
                typeof o.newPriceHbar === "number" &&
                typeof o.newScheduleId === "string");
        default:
            return false;
    }
}
