import { notFound } from "next/navigation";
import { loadProject } from "@/lib/store";
import EditorClient from "./editor-client";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^p[a-z0-9]+$/i.test(id)) notFound();
  const project = loadProject(id);
  if (!project) notFound();
  return <EditorClient id={id} initialProject={project} />;
}
