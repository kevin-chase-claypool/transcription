import OpenAI from "openai";
import {
  getArchiveBucket,
  getSupabaseAdmin,
  isSupabaseArchiveConfigured,
  slugify,
  type LectureAsset
} from "../../supabase-server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_BOARD_IMAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MATH_FORMAT_MODEL = "gpt-4.1-mini";
const DEFAULT_VISION_MODEL = "gpt-4.1-mini";
const RATE_LIMIT_MAX_REQUESTS = 8;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const SUPPORTED_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "mpeg",
  "webm",
  "ogg"
]);

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function getExtension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() || "";
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

function checkRateLimit(key: string) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    return null;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    const minutes = Math.ceil((bucket.resetAt - now) / 60000);
    return `Rate limit reached. Try again in about ${minutes} minute${
      minutes === 1 ? "" : "s"
    }.`;
  }

  bucket.count += 1;
  return null;
}

function stringValue(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function dateSegment(value: string) {
  return value || new Date().toISOString().slice(0, 10);
}

function safeFileName(value: string, fallback: string) {
  const extension = value.includes(".") ? value.split(".").pop() : "";
  const base = value.replace(/\.[^.]+$/, "");
  const slug = slugify(base || fallback);
  return extension ? `${slug}.${extension.toLowerCase()}` : slug;
}

function buildLectureContext({
  course,
  lectureTitle,
  lectureDate,
  mode,
  hints
}: {
  course: string;
  lectureTitle: string;
  lectureDate: string;
  mode: string;
  hints: string;
}) {
  return [
    "Use the lecture context below to improve recognition of terms, symbols, names, and equations.",
    "Do not add content that is not supported by the audio, photos, or explicit user context.",
    course ? `Course: ${course}` : "",
    lectureTitle ? `Lecture title/topic: ${lectureTitle}` : "",
    lectureDate ? `Lecture date: ${lectureDate}` : "",
    `Requested output mode: ${mode}`,
    hints ? `Vocabulary, names, places, jargon, or context:\n${hints}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function latexModeInstructions(mode: string) {
  if (mode !== "latex") {
    return "Keep math readable in plain text.";
  }

  return (
    "Convert equations, variables, functions, matrices, fractions, " +
    "exponents, integrals, sums, limits, derivatives, and Greek letters into " +
    "LaTeX when the math is clear. Use inline math with \\(...\\). Put each " +
    "standalone equation in one complete display math block, like \\[ equation \\]. " +
    "Never put \\[, \\], \\(, or \\) on their own line."
  );
}

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function analyzeBoardPhotos(
  client: OpenAI,
  photos: File[],
  context: string
) {
  if (!photos.length) {
    return null;
  }

  const imageContent = await Promise.all(
    photos.map(async (photo) => ({
      type: "input_image" as const,
      image_url: await fileToDataUrl(photo)
    }))
  );

  const response = await client.responses.create({
    model: process.env.OPENAI_VISION_MODEL || DEFAULT_VISION_MODEL,
    instructions: [
      "Extract concise study context from lecture whiteboard photos.",
      "Focus on equations, definitions, diagrams, theorem names, variable meanings, worked steps, and topic labels.",
      "Write compact Markdown notes that can help correct and augment an audio transcript.",
      "Use LaTeX for clearly visible math.",
      "Do not invent content that is not visible.",
      "If an image is blurry or unreadable, say so briefly."
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              context ? `Lecture context:\n${context}` : "",
              `Analyze ${photos.length} whiteboard photo${
                photos.length === 1 ? "" : "s"
              } and return compact board context for transcript formatting.`
            ]
              .filter(Boolean)
              .join("\n\n")
          },
          ...imageContent
        ]
      }
    ] as OpenAI.Responses.ResponseInput
  });

  return {
    text: response.output_text.trim(),
    usage: response.usage
  };
}

function contextValue(context: string, label: string) {
  const line = context
    .split("\n")
    .find((item) => item.toLowerCase().startsWith(label.toLowerCase()));
  return line?.slice(label.length).trim() || "";
}

function cleanFormattedTranscript(text: string, context: string) {
  const withoutFences = text
    .replace(/^```(?:latex|tex|markdown|md)?\s*/gim, "")
    .replace(/^```\s*$/gim, "")
    .trim();
  const topic =
    contextValue(context, "Lecture title/topic:") ||
    contextValue(context, "Course:") ||
    "this lecture";
  const hasIntroduction =
    /(^|\n)\s*#{1,3}\s*Study Introduction\b/i.test(withoutFences) ||
    /(^|\n)\s*Study Introduction\b/i.test(withoutFences);
  const hasSummary =
    /(^|\n)\s*#{1,3}\s*Study Summary\b/i.test(withoutFences) ||
    /(^|\n)\s*Study Summary\b/i.test(withoutFences);

  return [
    hasIntroduction
      ? ""
      : `## Study Introduction\nThis lecture focuses on ${topic}. The notes below organize the transcript into study material and highlight the main ideas, formulas, and terminology from the audio.`,
    withoutFences,
    hasSummary
      ? ""
      : "## Study Summary\nReview the main definitions, formulas, and worked steps above. Focus on how each formula is derived, what each variable represents, and when each result applies."
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function formatTranscript(
  client: OpenAI,
  transcript: string,
  mode: string,
  context: string,
  boardContext: string
) {
  const response = await client.responses.create({
    model: process.env.OPENAI_FORMAT_MODEL || DEFAULT_MATH_FORMAT_MODEL,
    instructions: [
      "You convert raw class transcripts into clean Markdown notes.",
      "Return Markdown content only. Do not wrap the answer in a code fence.",
      "You must include exactly these top-level Markdown headings in this order: ## Study Introduction, ## Lecture Notes, ## Study Summary.",
      "Preserve the speaker's meaning and order.",
      "The Study Introduction must preview the lecture topic and why it matters.",
      "The Lecture Notes section must include the main lecture transcript or notes in logical order.",
      "The Study Summary section must contain key ideas, formulas, definitions, and likely review points.",
      "Use headings, short paragraphs, and bullet lists where useful.",
      "Use Markdown headings and Markdown bullet lists for document structure.",
      "Do not output LaTeX document structure commands like \\section, \\subsection, \\begin{itemize}, \\end{itemize}, or \\item.",
      latexModeInstructions(mode),
      "Never output empty math delimiters, empty braces, or placeholder fragments such as \\{\\}, \\(\\), or \\[\\].",
      "Do not invent equations or silently fix uncertain content.",
      "If wording is ambiguous, keep the original words or mark it as unclear."
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              context ? `Lecture context:\n${context}` : "",
              boardContext ? `Whiteboard/photo context:\n${boardContext}` : "",
              "Raw transcript:",
              transcript
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        ]
      }
    ]
  });

  return {
    text: cleanFormattedTranscript(response.output_text || transcript, context),
    usage: response.usage
  };
}

async function generatePhotoLesson(
  client: OpenAI,
  mode: string,
  context: string,
  boardContext: string
) {
  const response = await client.responses.create({
    model: process.env.OPENAI_FORMAT_MODEL || DEFAULT_MATH_FORMAT_MODEL,
    instructions: [
      "You create structured class study notes from whiteboard/photo context.",
      "Return Markdown content only. Do not wrap the answer in a code fence.",
      "You must include exactly these top-level Markdown headings in this order: ## Study Introduction, ## Lecture Notes, ## Study Summary.",
      "The Study Introduction must explain the visible lesson topic and why it matters.",
      "The Lecture Notes section must organize the visible definitions, equations, diagrams, and worked steps into a coherent lesson.",
      "The Study Summary section must contain key ideas, formulas, definitions, and review points.",
      "Use headings, short paragraphs, and bullet lists where useful.",
      "Use Markdown headings and Markdown bullet lists for document structure.",
      "Do not output LaTeX document structure commands like \\section, \\subsection, \\begin{itemize}, \\end{itemize}, or \\item.",
      latexModeInstructions(mode),
      "Make clear when something is inferred from the board photos rather than heard in audio.",
      "Do not invent missing steps or equations.",
      "Never output empty math delimiters, empty braces, or placeholder fragments such as \\{\\}, \\(\\), or \\[\\]."
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              context ? `Lecture context:\n${context}` : "",
              "Whiteboard/photo context:",
              boardContext
            ]
              .filter(Boolean)
              .join("\n\n")
          }
        ]
      }
    ]
  });

  return {
    text: cleanFormattedTranscript(response.output_text || boardContext, context),
    usage: response.usage
  };
}

async function uploadLectureAssets({
  photos,
  course,
  lectureTitle,
  lectureDate
}: {
  photos: File[];
  course: string;
  lectureTitle: string;
  lectureDate: string;
}) {
  if (!isSupabaseArchiveConfigured() || !photos.length) {
    return [];
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return [];
  }

  const bucket = getArchiveBucket();
  const lectureSlug = slugify(
    [course, lectureTitle].filter(Boolean).join(" ") || "lecture"
  );
  const root = `${dateSegment(lectureDate)}/${lectureSlug}-${Date.now()}`;
  const assets: LectureAsset[] = [];

  for (const [index, photo] of photos.entries()) {
    const filename = safeFileName(
      photo.name,
      `board-${String(index + 1).padStart(2, "0")}.jpg`
    );
    const path = `${root}/${String(index + 1).padStart(2, "0")}-${filename}`;
    const { error } = await supabase.storage.from(bucket).upload(path, photo, {
      contentType: photo.type || "image/jpeg",
      upsert: false
    });

    if (error) {
      throw new Error(`Could not save board photo: ${error.message}`);
    }

    assets.push({
      name: photo.name || filename,
      path,
      type: photo.type || "image/jpeg"
    });
  }

  return assets;
}

async function saveLecture({
  course,
  lectureTitle,
  lectureDate,
  sourceFile,
  mode,
  transcript,
  rawTranscript,
  boardContext,
  boardPhotoCount,
  assets,
  usage,
  boardUsage,
  formattingUsage
}: {
  course: string;
  lectureTitle: string;
  lectureDate: string;
  sourceFile: string;
  mode: string;
  transcript: string;
  rawTranscript: string;
  boardContext: string;
  boardPhotoCount: number;
  assets: LectureAsset[];
  usage: unknown;
  boardUsage: unknown;
  formattingUsage: unknown;
}) {
  if (!isSupabaseArchiveConfigured()) {
    return null;
  }

  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("lectures")
    .insert({
      course,
      lecture_title: lectureTitle,
      lecture_date: lectureDate || null,
      source_file: sourceFile,
      transcript_mode: mode,
      transcript,
      raw_transcript: rawTranscript,
      board_context: boardContext,
      board_photo_count: boardPhotoCount,
      assets,
      usage,
      board_usage: boardUsage,
      formatting_usage: formattingUsage
    })
    .select("id, created_at")
    .single();

  if (error) {
    throw new Error(`Could not save lecture archive: ${error.message}`);
  }

  return data;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const upload = formData.get("file");
    const languageValue = formData.get("language");
    const promptValue = formData.get("prompt");
    const modeValue = formData.get("mode");
    const passwordValue = formData.get("password");
    const courseValue = formData.get("course");
    const lectureTitleValue = formData.get("lectureTitle");
    const lectureDateValue = formData.get("lectureDate");
    const boardPhotos = formData
      .getAll("boardPhotos")
      .filter((value): value is File => value instanceof File && value.size > 0);

    const audioFile = upload instanceof File && upload.size > 0 ? upload : null;
    const hasUpload = audioFile !== null;

    if (!hasUpload && boardPhotos.length === 0) {
      return jsonError("Choose an audio/video file or add board photos.", 400);
    }

    if (audioFile && audioFile.size > MAX_FILE_BYTES) {
      return jsonError("File is too large. Please upload a file under 25 MB.", 413);
    }

    const extension = audioFile ? getExtension(audioFile.name) : "";
    if (audioFile && !SUPPORTED_EXTENSIONS.has(extension)) {
      return jsonError(
        "Unsupported file type. Please upload MP3, WAV, M4A, MP4, MPEG, WEBM, or OGG.",
        400
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return jsonError("Server is missing OPENAI_API_KEY.", 500);
    }

    if (process.env.NODE_ENV === "production" && !process.env.APP_PASSWORD) {
      return jsonError("Server is missing APP_PASSWORD.", 500);
    }

    if (process.env.APP_PASSWORD && passwordValue !== process.env.APP_PASSWORD) {
      return jsonError("Invalid app password.", 401);
    }

    const rateLimitError = checkRateLimit(getClientKey(request));

    if (rateLimitError) {
      return jsonError(rateLimitError, 429);
    }

    const language =
      typeof languageValue === "string" && languageValue.trim()
        ? languageValue.trim()
        : "en";
    const mode =
      modeValue === "clean" || modeValue === "latex" ? modeValue : "raw";
    const course = stringValue(courseValue);
    const lectureTitle = stringValue(lectureTitleValue);
    const lectureDate = stringValue(lectureDateValue);
    const lectureContext = buildLectureContext({
      course,
      lectureTitle,
      lectureDate,
      mode,
      hints: stringValue(promptValue)
    });

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    for (const photo of boardPhotos) {
      if (!photo.type.startsWith("image/")) {
        return jsonError("Board context files must be images.", 400);
      }

      if (photo.size > MAX_BOARD_IMAGE_BYTES) {
        return jsonError(
          "One or more board photos is too large. Please use compressed photos under 5 MB each.",
          413
        );
      }
    }

    const boardAnalysis =
      mode === "clean" || mode === "latex" || !audioFile
        ? await analyzeBoardPhotos(client, boardPhotos, lectureContext)
        : null;

    const transcription = audioFile
      ? await client.audio.transcriptions.create({
          model: "gpt-4o-transcribe",
          file: audioFile,
          language,
          prompt: lectureContext || undefined
        })
      : null;

    const formatted = transcription
      ? mode === "clean" || mode === "latex"
        ? await formatTranscript(
            client,
            transcription.text,
            mode,
            lectureContext,
            boardAnalysis?.text || ""
          )
        : null
      : await generatePhotoLesson(
          client,
          mode === "latex" ? "latex" : "clean",
          lectureContext,
          boardAnalysis?.text || ""
        );
    const finalText = formatted?.text || transcription?.text || "";
    const rawText = transcription && mode !== "raw" ? transcription.text : "";
    const savedAssets = await uploadLectureAssets({
      photos: boardPhotos,
      course,
      lectureTitle,
      lectureDate
    });
    const savedLecture = await saveLecture({
      course,
      lectureTitle,
      lectureDate,
      sourceFile: audioFile?.name || "No audio file",
      mode: transcription ? mode : mode === "latex" ? "latex" : "clean",
      transcript: finalText,
      rawTranscript: rawText,
      boardContext: boardAnalysis?.text || "",
      boardPhotoCount: boardPhotos.length,
      assets: savedAssets,
      usage: transcription?.usage || null,
      boardUsage: boardAnalysis?.usage || null,
      formattingUsage: formatted?.usage || null
    });

    return Response.json({
      text: finalText,
      rawText: rawText || undefined,
      usage: transcription?.usage || null,
      boardContext: boardAnalysis?.text || "",
      boardUsage: boardAnalysis?.usage || null,
      formattingUsage: formatted?.usage || null,
      savedLecture
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed.";
    return jsonError(message, 500);
  }
}
