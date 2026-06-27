import {
  createSignedAssetUrls,
  getSupabaseAdmin,
  isSupabaseArchiveConfigured,
  type LectureAsset,
  type SavedLecture
} from "../../supabase-server";

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

export async function GET(request: Request) {
  if (!checkPassword(request)) {
    return jsonError("Invalid app password.", 401);
  }

  if (!isSupabaseArchiveConfigured()) {
    return Response.json({
      lectures: [],
      archiveEnabled: false
    });
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return jsonError("Supabase archive is not configured.", 500);
  }

  const { data, error } = await supabase
    .from("lectures")
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
    .order("lecture_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return jsonError(`Could not load lecture archive: ${error.message}`, 500);
  }

  const lectures = await Promise.all(
    ((data || []) as unknown as SavedLecture[]).map(async (lecture) => ({
      ...lecture,
      assetUrls: await createSignedAssetUrls(
        Array.isArray(lecture.assets)
          ? (lecture.assets as LectureAsset[])
          : []
      )
    }))
  );

  return Response.json({
    lectures,
    archiveEnabled: true
  });
}
