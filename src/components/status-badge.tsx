import type { ListItemStatus } from "@prisma/client";

const labels: Partial<Record<ListItemStatus, string>> = {
  purchased: "Purchased",
  substituted: "Substituted",
  rejected: "Rejected",
  carried_forward: "Moved to next list"
};

export function StatusBadge({ status }: { status: ListItemStatus }) {
  if (status === "pending") return null;
  return <span className={`status-badge status-${status}`}>{labels[status]}</span>;
}
