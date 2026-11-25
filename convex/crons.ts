import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "prune abandoned pending listing image uploads",
  { minuteUTC: 15 },
  internal.listings.retention.pruneAbandonedPendingUploads,
  {},
);

crons.daily(
  "prune terminal automation activities older than 90 days",
  { hourUTC: 2, minuteUTC: 0 },
  internal.automation.retention.pruneTerminalActivities,
  {},
);

crons.daily(
  "prune audit logs older than 365 days",
  { hourUTC: 3, minuteUTC: 0 },
  internal.audit.retention.pruneExpiredAuditLogs,
  {},
);

export default crons;
