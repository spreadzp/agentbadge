export function ok(payload) {
    return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}
export function fail(message) {
    return { isError: true, content: [{ type: "text", text: message }] };
}
