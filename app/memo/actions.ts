"use server"

import { buildMemoDraft } from "@/lib/memo/build"
import { buildMemoDocx, memoFilename } from "@/lib/memo/docx"

export type ExportDocxResult =
  | { ok: true; filename: string; base64: string }
  | { ok: false; error: string }

export async function exportMemoDocx(
  includedSectionIds: string[],
): Promise<ExportDocxResult> {
  try {
    if (!Array.isArray(includedSectionIds) || includedSectionIds.length === 0) {
      return { ok: false, error: "Select at least one section to include." }
    }
    // Re-fetch the draft server-side so we never trust client text.
    const draft = await buildMemoDraft()
    const bytes = buildMemoDocx(draft, includedSectionIds)
    const base64 = Buffer.from(bytes).toString("base64")
    return { ok: true, filename: memoFilename(draft), base64 }
  } catch (e) {
    console.error("exportMemoDocx", e)
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Failed to build .docx — check server logs.",
    }
  }
}
