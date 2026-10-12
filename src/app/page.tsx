import { listProjects } from "@/lib/store";
import Home from "./home-client";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Home initialProjects={listProjects()} />;
}
