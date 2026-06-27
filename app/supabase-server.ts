import { createClient } from "@supabase/supabase-js";

export type LectureAsset = {
  name: string;
  path: string;
  type: string;
};

export type SavedLecture = {
  id: string;
  created_at: string;
  course: string;
  lecture_title: string;
  lecture_date: string;
  source_file: string;
  transcript_mode: string;
  transcript: string;
  raw_transcript: string;
  board_context: string;
  board_photo_count: number;
  assets: LectureAsset[];
  usage: unknown;
  board_usage: unknown;
  formatting_usage: unknown;
};

export function isSupabaseArchiveConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SUPABASE_STORAGE_BUCKET
  );
}

export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false
    }
  });
}

export function getArchiveBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET || "lecture-assets";
}

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "lecture"
  );
}

export async function createSignedAssetUrls(assets: LectureAsset[]) {
  const supabase = getSupabaseAdmin();

  if (!supabase || !assets.length) {
    return [];
  }

  const bucket = getArchiveBucket();

  return Promise.all(
    assets.map(async (asset) => {
      const { data } = await supabase.storage
        .from(bucket)
        .createSignedUrl(asset.path, 60 * 60);

      return {
        ...asset,
        url: data?.signedUrl || ""
      };
    })
  );
}
