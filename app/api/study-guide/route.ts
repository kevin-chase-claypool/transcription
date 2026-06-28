import OpenAI from "openai";

export const runtime = "nodejs";

const DEFAULT_STUDY_GUIDE_MODEL = "gpt-4.1-mini";
const MAX_LECTURES = 25;
const MAX_TOTAL_CHARS = 90000;

type StudyGuideLecture = {
  course?: string;
  lectureTitle?: string;
  lectureDate?: string;
  transcriptMode?: string;
  transcript?: string;
};

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

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function trimToBudget(lectures: StudyGuideLecture[]) {
  let remaining = MAX_TOTAL_CHARS;

  return lectures.map((lecture) => {
    const transcript = cleanString(lecture.transcript);
    const trimmedTranscript = transcript.slice(0, Math.max(0, remaining));
    remaining -= trimmedTranscript.length;

    return {
      course: cleanString(lecture.course),
      lectureTitle: cleanString(lecture.lectureTitle) || "Untitled lecture",
      lectureDate: cleanString(lecture.lectureDate),
      transcriptMode: cleanString(lecture.transcriptMode),
      transcript: trimmedTranscript
    };
  });
}

function buildLectureBundle(lectures: ReturnType<typeof trimToBudget>) {
  return lectures
    .map(
      (lecture, index) => `Lecture ${index + 1}
Course: ${lecture.course || "Unfiled"}
Title: ${lecture.lectureTitle}
Date: ${lecture.lectureDate || "No date"}
Mode: ${lecture.transcriptMode || "unknown"}

Transcript and notes:
${lecture.transcript || "No transcript content."}`
    )
    .join("\n\n---\n\n");
}

export async function POST(request: Request) {
  if (!checkPassword(request)) {
    return jsonError("Invalid app password.", 401);
  }

  if (!process.env.OPENAI_API_KEY) {
    return jsonError("Server is missing OPENAI_API_KEY.", 500);
  }

  try {
    const body = (await request.json()) as {
      lectures?: StudyGuideLecture[];
      context?: string;
    };
    const lectures = Array.isArray(body.lectures) ? body.lectures : [];

    if (!lectures.length) {
      return jsonError("Select at least one archived lecture.", 400);
    }

    if (lectures.length > MAX_LECTURES) {
      return jsonError(`Select ${MAX_LECTURES} or fewer lectures at a time.`, 400);
    }

    const preparedLectures = trimToBudget(lectures);
    const userContext = cleanString(body.context);
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: process.env.OPENAI_STUDY_GUIDE_MODEL || DEFAULT_STUDY_GUIDE_MODEL,
      instructions: [
        "You create exam-focused math study guides from selected lecture notes.",
        "Use only the selected lecture materials and explicit user context.",
        "Do not invent formulas, theorems, examples, or facts that are not supported by the selected materials.",
        "Return Markdown only. Do not wrap the response in a code fence.",
        "Use LaTeX for math. Inline math must use \\(...\\). Standalone equations must use complete \\[ equation \\] blocks.",
        "Never output LaTeX document commands such as \\documentclass, \\section, \\begin{document}, \\begin{itemize}, or \\item.",
        "Never output empty math delimiters, empty braces, or placeholder fragments such as \\{\\}, \\(\\), or \\[\\].",
        "Include these top-level Markdown headings in this order: ## Study Guide Overview, ## Key Concepts, ## Formula Sheet, ## Worked Patterns, ## Common Mistakes, ## Practice Checklist, ## Source Map.",
        "The Source Map must link each major idea back to the lecture title and date where it came from."
      ].join(" "),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                userContext
                  ? `User exam context and instructions:\n${userContext}`
                  : "",
                "Selected lecture materials:",
                buildLectureBundle(preparedLectures)
              ]
                .filter(Boolean)
                .join("\n\n")
            }
          ]
        }
      ]
    });

    return Response.json({
      text: response.output_text.trim(),
      usage: response.usage || null
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not build study guide.";
    return jsonError(message, 500);
  }
}
