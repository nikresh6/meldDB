import { lt } from "drizzle-orm";
import { db } from "../src/db/index";
import { auditEvents, oauthStates, recentQueryLogs, sessions } from "../src/db/schema";

const now = new Date();
const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? "90");
const auditBefore = new Date(now.getTime() - auditDays * 86_400_000);

const [queries, oauth, expiredSessions, audits] = await db.transaction(async (transaction) => Promise.all([
  transaction.delete(recentQueryLogs).where(lt(recentQueryLogs.expiresAt, now)).returning({ id: recentQueryLogs.id }),
  transaction.delete(oauthStates).where(lt(oauthStates.expiresAt, now)).returning({ id: oauthStates.id }),
  transaction.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id }),
  transaction.delete(auditEvents).where(lt(auditEvents.createdAt, auditBefore)).returning({ id: auditEvents.id }),
]));

console.log(JSON.stringify({ pruned: { queryLogs: queries.length, oauthStates: oauth.length, sessions: expiredSessions.length, auditEvents: audits.length } }));
process.exit(0);
