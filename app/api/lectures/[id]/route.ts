import {
  getArchiveBucket,
  getSupabaseAdmin,
  isSupabaseArchiveConfigured,
  type LectureAsset,
  type SavedLecture
} from "../../../supabase-server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function checkPassword(request: Request) {
  const configuredPassword = process.env.APP_PASSWORD;

  if (!configuredPassword) {
    return true;
  }

  return request.headers.get("x-app-password") === configuredPassword;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanTranscriptMode(value: unknown) {
  return value === "raw" || value === "clean" || value === "latex"
    ? value
    : "latex";
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkPassword(request)) {
    return jsonError("Invalid app password.", 401);
  }

  if (!isSupabaseArchiveConfigured()) {
    return jsonError("Supabase archive is not configured.", 500);
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return jsonError("Supabase archive is not configured.", 500);
  }

  const { id } = await params;
  const body = await request.json();
  const { data, error } = await supabase
    .from("lectures")
    .update({
      course: cleanText(body.course),
      lecture_title: cleanText(body.lecture_title),
      lecture_date: cleanText(body.lecture_date) || null,
      transcript_mode: cleanTranscriptMode(body.transcript_mode),
      transcript: typeof body.transcript === "string" ? body.transcript : ""
    })
    .eq("id", id)
    .select(
      [
        "id",
        "created_at",
        "course",
        "lecture_title",
        "lecture_date",
        "source_file",
        "transcript_mode",
        "transcript",
        "raw_transcript",
        "board_context",
        "board_photo_count",
        "assets",
        "usage",
        "board_usage",
        "formatting_usage"
      ].join(",")
    )
    .single();

  if (error) {
    return jsonError(`Could not save lecture: ${error.message}`, 500);
  }

  return Response.json({ lecture: data });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkPassword(request)) {
    return jsonError("Invalid app password.", 401);
  }

  if (!isSupabaseArchiveConfigured()) {
    return jsonError("Supabase archive is not configured.", 500);
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return jsonError("Supabase archive is not configured.", 500);
  }

  const { id } = await params;
  const { data: lecture, error: loadError } = await supabase
    .from("lectures")
    .select("assets")
    .eq("id", id)
    .single();

  if (loadError) {
    return jsonError(`Could not load lecture: ${loadError.message}`, 500);
  }

  const assets = Array.isArray((lecture as SavedLecture | null)?.assets)
    ? ((lecture as SavedLecture).assets as LectureAsset[])
    : [];
  const paths = assets.map((asset) => asset.path).filter(Boolean);

  if (paths.length) {
    const { error: storageError } = await supabase.storage
      .from(getArchiveBucket())
      .remove(paths);

    if (storageError) {
      return jsonError(
        `Could not remove lecture images: ${storageError.message}`,
        500
      );
    }
  }

  const { error: deleteError } = await supabase
    .from("lectures")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return jsonError(`Could not delete lecture: ${deleteError.message}`, 500);
  }

  return Response.json({ ok: true });
}
