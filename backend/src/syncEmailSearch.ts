import "dotenv/config";

import { randomUUID } from "node:crypto";
import { Client } from "@elastic/elasticsearch";
import { pool } from "./db.js";

const INDEX_NAME = "reachinbox-email-jobs-v1";

const client = new Client({
  node: process.env.ELASTICSEARCH_URL ??
    "http://127.0.0.1:9200"
});

interface EmailRow {
  id: string;
  user_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: Date;
  sent_at: Date | null;
  created_at: Date;
}

async function main() {
  try {
    // Step 1: Read existing emails from PostgreSQL.
    const result = await pool.query<EmailRow>(
      `SELECT
         id,
         user_id,
         sender_id,
         recipient_email,
         subject,
         body,
         status,
         scheduled_at,
         sent_at,
         created_at
       FROM email_jobs
       ORDER BY created_at DESC`
    );

    const emails = result.rows;

    console.log("PostgreSQL emails found:", emails.length);

    // Step 2: Copy emails into Elasticsearch.
    for (const email of emails) {
      await client.index({
        index: INDEX_NAME,
        id: email.id,
        document: {
          emailJobId: email.id,
          userId: email.user_id,
          senderId: email.sender_id,
          recipientEmail: email.recipient_email,
          subject: email.subject,
          body: email.body,
          status: email.status,
          scheduledAt: email.scheduled_at,
          sentAt: email.sent_at,
          createdAt: email.created_at
        }
      });
    }

    await client.indices.refresh({
      index: INDEX_NAME
    });

    console.log("Emails indexed:", emails.length);

    const count = await client.count({
      index: INDEX_NAME
    });

    console.log("Total search documents:", count.count);

    if (emails.length === 0) {
      console.log("No emails available for search testing.");
      return;
    }

    // Step 3: Test searching by subject.
    const sample = emails[0];

    const searchResult = await client.search({
      index: INDEX_NAME,
      size: 10,
      query: {
        bool: {
          must: [
            {
              match: {
                subject: sample.subject
              }
            }
          ],
          filter: [
            {
              term: {
                userId: sample.user_id
              }
            }
          ]
        }
      }
    });

    const matchingEmail = searchResult.hits.hits.some(
      (hit) => hit._id === sample.id
    );

    console.log(
      "Subject search successful:",
      matchingEmail ? "YES" : "NO"
    );

    // Step 4: Verify results are scoped to user ID.
    const otherUserResult = await client.search({
      index: INDEX_NAME,
      query: {
        bool: {
          filter: [
            {
              term: {
                userId: randomUUID()
              }
            }
          ]
        }
      }
    });

    console.log(
      "Unrelated user returned records:",
      otherUserResult.hits.hits.length
    );

    if (
      !matchingEmail ||
      otherUserResult.hits.hits.length !== 0
    ) {
      throw new Error("Elasticsearch search test failed");
    }

    console.log(
      "SUCCESS: PostgreSQL emails indexed and searchable!"
    );
  } catch (error) {
    console.error("Search synchronization failed:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
    await pool.end();
  }
}

main();
