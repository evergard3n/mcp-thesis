import type { ConnectionStatus } from "~/hooks/useHITLSession";

interface ConnectionBadgeProps {
  status: ConnectionStatus;
}

const CONFIG: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: "bg-green-500", label: "Live" },
  connecting: { dot: "bg-yellow-400 animate-pulse", label: "Connecting" },
  disconnected: { dot: "bg-gray-300", label: "Offline" },
};

export function ConnectionBadge({ status }: ConnectionBadgeProps) {
  const { dot, label } = CONFIG[status];

  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
