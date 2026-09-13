export function validateWorkflowSpec(spec) {
    const errors = [];
    const seen = new Set();
    for (const node of spec.nodes) {
        if (seen.has(node.id)) {
            errors.push({ node: node.id, field: "id", message: "duplicate node id" });
        }
        seen.add(node.id);
    }
    const nodeIds = new Set(spec.nodes.map((n) => n.id));
    const triggers = spec.nodes.filter((n) => n.type === "trigger");
    if (triggers.length === 0) {
        errors.push({ field: "nodes", message: "missing trigger node" });
    }
    else if (triggers.length > 1) {
        errors.push({ field: "nodes", message: `expected 1 trigger, found ${triggers.length}` });
    }
    for (const edge of spec.edges) {
        if (!nodeIds.has(edge.source)) {
            errors.push({ field: "edges", message: `edge ${edge.id}: source "${edge.source}" not found` });
        }
        if (!nodeIds.has(edge.target)) {
            errors.push({ field: "edges", message: `edge ${edge.id}: target "${edge.target}" not found` });
        }
    }
    const triggerHasOutgoing = spec.edges.some((e) => triggers.some((t) => t.id === e.source));
    if (triggers.length === 1 && !triggerHasOutgoing) {
        errors.push({ node: triggers[0].id, field: "edges", message: "trigger has no outgoing edge" });
    }
    for (const node of spec.nodes) {
        if (node.type !== "action")
            continue;
        const config = node.data?.config;
        if (!config)
            continue;
        const actionType = config.actionType;
        if (actionType === "web3/write-contract") {
            if (typeof config.network !== "string") {
                errors.push({ node: node.id, field: "network", message: "network must be string" });
            }
            if (typeof config.abi !== "string") {
                errors.push({ node: node.id, field: "abi", message: "abi must be a JSON string" });
            }
            else {
                try {
                    JSON.parse(config.abi);
                }
                catch {
                    errors.push({ node: node.id, field: "abi", message: "abi is not valid JSON" });
                }
            }
            if (!config.abiFunction || typeof config.abiFunction !== "string") {
                errors.push({ node: node.id, field: "abiFunction", message: "abiFunction must be a non-empty string" });
            }
            if (config.functionArgs !== undefined) {
                if (typeof config.functionArgs !== "string") {
                    errors.push({ node: node.id, field: "functionArgs", message: "functionArgs must be a string" });
                }
                else {
                    try {
                        const substituted = config.functionArgs.replace(/{{[^}]+}}/g, "0");
                        const parsed = JSON.parse(substituted);
                        if (!Array.isArray(parsed)) {
                            errors.push({ node: node.id, field: "functionArgs", message: "functionArgs must parse to an array (positional args)" });
                        }
                    }
                    catch {
                        errors.push({ node: node.id, field: "functionArgs", message: "functionArgs is not valid JSON" });
                    }
                }
            }
            if (config.gasLimitMultiplier !== undefined && typeof config.gasLimitMultiplier !== "string") {
                errors.push({ node: node.id, field: "gasLimitMultiplier", message: "gasLimitMultiplier must be a string" });
            }
        }
        if (actionType === "webhook/send-webhook") {
            if (config.webhookUrl !== undefined) {
                try {
                    new URL(config.webhookUrl);
                }
                catch {
                    errors.push({ node: node.id, field: "webhookUrl", message: "webhook url is not a valid URL" });
                }
            }
            if (config.webhookPayload !== undefined) {
                if (typeof config.webhookPayload !== "string") {
                    errors.push({ node: node.id, field: "webhookPayload", message: "webhookPayload must be a JSON string" });
                }
                else {
                    try {
                        JSON.parse(config.webhookPayload);
                    }
                    catch {
                        errors.push({ node: node.id, field: "webhookPayload", message: "webhookPayload is not valid JSON" });
                    }
                }
            }
        }
    }
    return errors;
}
export function assertValidWorkflowSpec(spec) {
    const errors = validateWorkflowSpec(spec);
    if (errors.length > 0) {
        throw new Error(`Invalid workflow spec:\n${errors.map((e) => `- ${e.node ? `[${e.node}] ` : ""}${e.field}: ${e.message}`).join("\n")}`);
    }
}
