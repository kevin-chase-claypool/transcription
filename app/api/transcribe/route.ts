import OpenAI from "openai";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MATH_FORMAT_MODEL = "gpt-4.1-mini";
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
    "Do not add content that is not supported by the audio.",
    course ? `Course: ${course}` : "",
    lectureTitle ? `Lecture title/topic: ${lectureTitle}` : "",
    lectureDate ? `Lecture date: ${lectureDate}` : "",
    `Requested output mode: ${mode}`,
    hints ? `Vocabulary, names, places, jargon, or context:\n${hints}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

async function formatTranscript(
  client: OpenAI,
  transcript: string,
  mode: string,
  context: string
) {
  const latexInstructions =
    "Convert spoken equations, variables, functions, matrices, fractions, " +
    "exponents, integrals, sums, limits, derivatives, and Greek letters into " +
    "LaTeX when the math is clear. Use inline math with \\(...\\) and display " +
    "math with \\[...\\]. Every standalone equation must be wrapped in \\[...\\].";

  const response = await client.responses.create({
    model: process.env.OPENAI_FORMAT_MODEL || DEFAULT_MATH_FORMAT_MODEL,
    instructions: [
      "You convert raw class transcripts into clean Markdown notes.",
      "Preserve the speaker's meaning and order.",
      "Begin with a concise 'Study Introduction' section that previews the lecture topic and why it matters.",
      "After the introduction, include the main lecture transcript or notes in logical order.",
      "End with a 'Study Summary' section containing key ideas, formulas, definitions, and likely review points.",
      "Use headings, short paragraphs, and bullet lists where useful.",
      "Use Markdown headings and Markdown bullet lists for document structure.",
      "Do not output LaTeX document structure commands like \\section, \\subsection, \\begin{itemize}, \\end{itemize}, or \\item.",
      mode === "latex" ? latexInstructions : "Keep math readable in plain text.",
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
    text: response.output_text || transcript,
    usage: response.usage
  };
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

    if (!(upload instanceof File)) {
      return jsonError("Missing file upload.", 400);
    }

    if (upload.size === 0) {
      return jsonError("Uploaded file is empty.", 400);
    }

    if (upload.size > MAX_FILE_BYTES) {
      return jsonError("File is too large. Please upload a file under 25 MB.", 413);
    }

    const extension = getExtension(upload.name);
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
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
    const lectureContext = buildLectureContext({
      course: stringValue(courseValue),
      lectureTitle: stringValue(lectureTitleValue),
      lectureDate: stringValue(lectureDateValue),
      mode,
      hints: stringValue(promptValue)
    });

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const transcription = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: upload,
      language,
      prompt: lectureContext || undefined
    });

    const formatted = mode === "clean" || mode === "latex"
      ? await formatTranscript(client, transcription.text, mode, lectureContext)
      : null;

    return Response.json({
      text: formatted?.text || transcription.text,
      rawText: mode === "raw" ? undefined : transcription.text,
      usage: transcription.usage,
      formattingUsage: formatted?.usage || null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed.";
    return jsonError(message, 500);
  }
}
