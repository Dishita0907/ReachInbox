import "dotenv/config";

import { Router } from "express";
import { Client } from "@elastic/elasticsearch";
import type { estypes } from "@elastic/elasticsearch";

export const emailSearchRouter = Router();

const INDEX_NAME = "reachinbox-email-jobs-v1";

const client = new Client({
  node: process.env.ELASTICSEARCH_URL ??
    "http://127.0.0.1:9200"
});

interface EmailDocument {
  emailJobId: string;
  userId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

// GET /api/emails/search
emailSearchRouter.get("/emails/search", async (req, res) => {
  try {
    // Only authenticated users can search.
    const userId = req.session?.userId;

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Please sign in first"
      });
    }

    const q =
      typeof req.query.q === "string"
        ? req.query.q.trim()
        : "";

    const status =
      typeof req.query.status === "string"
        ? req.query.status.trim()
        : "";

    const recipient =
      typeof req.query.recipient === "string"
        ? req.query.recipient.trim()
        : "";

    // Prevent excessively large search requests.
    if (q.length > 120 || recipient.length > 254) {
      return res.status(400).json({
        status: "error",
        message: "Search input is too long"
      });
    }

    const validStatuses = [
      "scheduled",
      "processing",
      "sent",
      "failed"
    ];

    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({
        status: "error",
        message: "Invalid email status"
      });
    }

    // Always restrict results to the logged-in user.
    const filters: estypes.QueryDslQueryContainer[] = [
      {
        term: {
          userId
        }
      }
    ];

    if (status) {
      filters.push({
        term: {
          status
        }
      });
    }

    if (recipient) {
      filters.push({
        term: {
          recipientEmail: {
            value: recipient,
            case_insensitive: true
          }
        }
      });
    }

    const must: estypes.QueryDslQueryContainer[] = [];

    if (q) {
      must.push({
        bool: {
          should: [
            {
              multi_match: {
                query: q,
                fields: ["subject^3", "body"]
              }
            },
            {
              term: {
                recipientEmail: {
                  value: q,
                  case_insensitive: true
                }
              }
            }
          ],
          minimum_should_match: 1
        }
      });
    }

    const result = await client.search<EmailDocument>({
      index: INDEX_NAME,
      size: 25,
      query: {
        bool: {
          filter: filters,
          must
        }
      },
      sort: [
        {
          createdAt: {
            order: "desc"
          }
        }
      ]
    });

    const emails = result.hits.hits
      .filter((hit) => hit._source)
      .map((hit) => ({
        id: hit._source!.emailJobId,
        recipientEmail: hit._source!.recipientEmail,
        subject: hit._source!.subject,
        status: hit._source!.status,
        scheduledAt: hit._source!.scheduledAt,
        sentAt: hit._source!.sentAt
      }));

    return res.status(200).json({
      status: "ok",
      count: emails.length,
      emails
    });

  } catch (error) {
    console.error("Email search failed:", error);

    return res.status(503).json({
      status: "error",
      message: "Email search is temporarily unavailable"
    });
  }
});
