import OpenAI from "openai";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const DEFAULT_MATH_FORMAT_MODEL = "gpt-4.1-mini";
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

async function formatMathTranscript(
  client: OpenAI,
  transcript: string,
  hints?: string
) {
  const response = await client.responses.create({
    model: process.env.OPENAI_FORMAT_MODEL || DEFAULT_MATH_FORMAT_MODEL,
    instructions:
      "You convert raw math lecture transcripts into clean Markdown notes. " +
      "Preserve the speaker's meaning and order. Convert spoken equations, " +
      "variables, functions, matrices, fractions, exponents, integrals, sums, " +
      "limits, derivatives, and Greek letters into LaTeX when the math is clear. " +
      "Use inline math with \\(...\\) and display math with \\[...\\]. " +
      "Do not invent equations or silently fix uncertain content. If wording is " +
      "ambiguous, keep the original words or mark the math as unclear.",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              hints ? `Class hints and vocabulary:\n${hints}` : "",
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
    const formatMathValue = formData.get("formatMath");

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

    const language =
      typeof languageValue === "string" && languageValue.trim()
        ? languageValue.trim()
        : "en";
    const prompt =
      typeof promptValue === "string" && promptValue.trim()
        ? promptValue.trim()
        : undefined;
    const formatMath = formatMathValue === "true";

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const transcription = await client.audio.transcriptions.create({
      model: "gpt-4o-transcribe",
      file: upload,
      language,
      prompt
    });

    const formatted = formatMath
      ? await formatMathTranscript(client, transcription.text, prompt)
      : null;

    return Response.json({
      text: formatted?.text || transcription.text,
      rawText: formatMath ? transcription.text : undefined,
      usage: transcription.usage,
      formattingUsage: formatted?.usage || null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Transcription failed.";
    return jsonError(message, 500);
  }
}
