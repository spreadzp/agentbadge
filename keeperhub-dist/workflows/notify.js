import { WEBHOOK_SEND_ACTION_TYPE } from "./record-scan.js";
export function buildNotifyWorkflow(opts) {
    return {
        name: "agentbadge-notify",
        description: "Send a notification (Discord/Slack/external) on scan events",
        nodes: [
            {
                id: "trigger",
                type: "trigger",
                data: { label: "Notification", type: "trigger", config: { triggerType: "Webhook" } },
            },
            {
                id: "send-notification",
                type: "action",
                data: {
                    label: "Send Notification",
                    type: "action",
                    config: {
                        actionType: WEBHOOK_SEND_ACTION_TYPE,
                        webhookUrl: opts.notifyUrl,
                        webhookMethod: "POST",
                        webhookHeaders: JSON.stringify(opts.secret ? { "X-AgentBadge-Secret": opts.secret, "Content-Type": "application/json" } : { "Content-Type": "application/json" }),
                        webhookPayload: JSON.stringify({
                            source: "agentbadge",
                            message: "{{ $trigger.input.message }}",
                            timestamp: "{{ $trigger.input.ts }}",
                        }),
                    },
                },
            },
        ],
        edges: [
            { id: "e1", source: "trigger", target: "send-notification" },
        ],
    };
}
