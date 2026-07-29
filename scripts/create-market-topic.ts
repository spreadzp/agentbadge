import { TopicCreateTransaction, Client } from "@hashgraph/sdk";

async function main() {
  const client = Client.forTestnet();
  client.setOperator(
    "0.0.5266613",
    "302e020100300506032b6570042204207a1808c14f6e11817bc7c1b3ab9aa86bef1883e7da58046f8ab84021c30bfce7",
  );

  const tx = await new TopicCreateTransaction()
    .setTopicMemo("Marketplace tasks topic")
    .execute(client);
  const receipt = await tx.getReceipt(client);
  console.log(receipt.topicId?.toString());
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
