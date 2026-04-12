import type { Route } from "./+types/home";
import { Link } from "react-router";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "MCP Thesis FE" },
    { name: "description", content: "HITL frontend demo" },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-start justify-center gap-4 p-6">
      <h1 className="text-3xl font-semibold">MCP Thesis Frontend Demo</h1>
      <p className="text-gray-600">
        Start an interactive HITL session using URL-based session management.
      </p>
      <Link className="rounded bg-black px-4 py-2 text-white" to="/chat">
        Open Chat Demo
      </Link>
    </main>
  );
}
