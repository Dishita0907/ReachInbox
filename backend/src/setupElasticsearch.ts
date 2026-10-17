import "dotenv/config";
import { Client } from "@elastic/elasticsearch";

const client = new Client({
  node: process.env.ELASTICSEARCH_URL ??
    "http://127.0.0.1:9200"
});

const INDEX_NAME = "reachinbox-email-jobs-v1";

async function main() {
  try {
    const info = await client.info();

    console.log("Elasticsearch connected successfully!");
    console.log("Version:", info.version.number);

    const exists = await client.indices.exists({
      index: INDEX_NAME
    });

    if (!exists) {
      await client.indices.create({
        index: INDEX_NAME,
        mappings: {
          dynamic: "strict",
          properties: {
            emailJobId: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipientEmail: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            createdAt: { type: "date" }
          }
        }
      });

      console.log("Email search index created!");
    } else {
      console.log("Email search index already exists.");
    }

    await client.indices.getMapping({
      index: INDEX_NAME
    });

    console.log("Index:", INDEX_NAME);
    console.log("Index mapping verified!");
    console.log("SUCCESS: Elasticsearch setup complete!");
  } catch (error) {
    console.error("Elasticsearch setup failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
