"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

type TranscribeResponse = {
  text?: string;
  rawText?: string;
  usage?: TranscriptionUsage;
  formattingUsage?: FormattingUsage | null;
  error?: string;
};

type TranscriptionUsage =
  | {
      type: "duration";
      seconds: number;
    }
  | {
      type: "tokens";
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      input_token_details?: {
        audio_tokens?: number;
        text_tokens?: number;
      };
    };

type FormattingUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

const ACCEPTED_FORMATS = ".mp3,.wav,.m4a,.mp4,.mpeg,.webm,.ogg,audio/*,video/*";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PASSWORD_STORAGE_KEY = "tablet-transcriber-password";

type TranscriptMode = "raw" | "clean" | "latex";

function formatUsage(usage: TranscriptionUsage | null) {
  if (!usage) {
    return "";
  }

  if (usage.type === "duration") {
    const minutes = usage.seconds / 60;
    return `${usage.seconds.toFixed(1)} seconds (${minutes.toFixed(2)} minutes)`;
  }

  const details = usage.input_token_details;
  const detailParts = [
    typeof details?.audio_tokens === "number"
      ? `${details.audio_tokens.toLocaleString()} audio`
      : "",
    typeof details?.text_tokens === "number"
      ? `${details.text_tokens.toLocaleString()} text`
      : ""
  ].filter(Boolean);

  return [
    `${usage.total_tokens.toLocaleString()} total tokens`,
    `${usage.input_tokens.toLocaleString()} input`,
    `${usage.output_tokens.toLocaleString()} output`,
    detailParts.length ? `input details: ${detailParts.join(", ")}` : ""
  ]
    .filter(Boolean)
    .join(" • ");
}

function formatTokenUsage(usage: FormattingUsage | null) {
  if (!usage) {
    return "";
  }

  return [
    `${usage.total_tokens.toLocaleString()} total tokens`,
    `${usage.input_tokens.toLocaleString()} input`,
    `${usage.output_tokens.toLocaleString()} output`
  ].join(" • ");
}

function escapeLatexText(text: string) {
  return text
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/\$/g, "\\$")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/{/g, "\\{")
    .replace(/}/g, "\\}")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeOutsideMath(text: string) {
  const parts = text.split(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g);

  return parts
    .map((part) => {
      if (part.startsWith("\\[") || part.startsWith("\\(")) {
        return part;
      }

      return escapeLatexText(part);
    })
    .join("");
}

function stripMarkdownMarks(text: string) {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

function normalizeLatexStructure(text: string) {
  return text
    .replace(/\\\{\}section\*/g, "\\section*")
    .replace(/\\textbackslash\{\}section\*/g, "\\section*")
    .replace(/\\\{\}subsection\*/g, "\\subsection*")
    .replace(/\\textbackslash\{\}subsection\*/g, "\\subsection*")
    .replace(/\\\{\}begin\{itemize\}/g, "\\begin{itemize}")
    .replace(/\\textbackslash\{\}begin\{itemize\}/g, "\\begin{itemize}")
    .replace(/\\\{\}end\{itemize\}/g, "\\end{itemize}")
    .replace(/\\textbackslash\{\}end\{itemize\}/g, "\\end{itemize}")
    .replace(/\\\{\}item\b/g, "\\item")
    .replace(/\\textbackslash\{\}item\b/g, "\\item");
}

function convertMarkdownLineToLatex(line: string) {
  const trimmed = line.trim();
  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

  if (heading) {
    const command =
      heading[1].length === 1
        ? "section"
        : heading[1].length === 2
          ? "subsection"
          : "subsubsection";

    return `\\${command}*{${escapeOutsideMath(stripMarkdownMarks(heading[2]))}}`;
  }

  if (/^-{3,}$/.test(trimmed)) {
    return "\\bigskip\\hrule\\bigskip";
  }

  return escapeOutsideMath(stripMarkdownMarks(line));
}

function transcriptToLatexBody(transcript: string) {
  const lines = normalizeLatexStructure(
    transcript.trim() || "No transcript yet."
  ).split(/\r?\n/);
  const output: string[] = [];
  let inItemize = false;

  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (bullet) {
      if (!inItemize) {
        output.push("\\begin{itemize}");
        inItemize = true;
      }

      output.push(`\\item ${escapeOutsideMath(stripMarkdownMarks(bullet[1]))}`);
      continue;
    }

    if (inItemize) {
      output.push("\\end{itemize}");
      inItemize = false;
    }

    output.push(convertMarkdownLineToLatex(line));
  }

  if (inItemize) {
    output.push("\\end{itemize}");
  }

  return output.join("\n");
}

function validateLatexDelimiters(text: string) {
  const inlineOpen = (text.match(/\\\(/g) || []).length;
  const inlineClose = (text.match(/\\\)/g) || []).length;
  const displayOpen = (text.match(/\\\[/g) || []).length;
  const displayClose = (text.match(/\\\]/g) || []).length;

  if (inlineOpen !== inlineClose) {
    return "LaTeX warning: inline math delimiters do not match.";
  }

  if (displayOpen !== displayClose) {
    return "LaTeX warning: display math delimiters do not match.";
  }

  return "";
}

function formatFileSize(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes.toFixed(2)} MB`;
}

function buildTranscriptMetadata(metadata: {
  course: string;
  lectureTitle: string;
  lectureDate: string;
  sourceFile?: string;
  mode: TranscriptMode;
}) {
  const rows = [
    "Transcript Metadata",
    `Course: ${metadata.course.trim() || "Not specified"}`,
    `Lecture Title: ${metadata.lectureTitle.trim() || "Not specified"}`,
    `Lecture Date: ${metadata.lectureDate.trim() || "Not specified"}`,
    `Source File: ${metadata.sourceFile || "Not specified"}`,
    `Transcript Mode: ${metadata.mode}`,
    `Created: ${new Date().toLocaleString()}`
  ];

  return `${rows.join("\n")}\n\n---\n\n`;
}

function buildTexDocument(
  transcript: string,
  metadata: { course: string; lectureTitle: string; lectureDate: string }
) {
  const body = transcriptToLatexBody(transcript);
  const title = escapeLatexText(
    metadata.lectureTitle.trim() || "Math Class Transcript"
  );
  const author = escapeLatexText(metadata.course.trim());
  const date = metadata.lectureDate.trim()
    ? escapeLatexText(metadata.lectureDate.trim())
    : "\\today";

  return `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage[margin=1in]{geometry}
\\usepackage{microtype}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.8em}

\\title{${title}}
${author ? `\\author{${author}}\n` : ""}\\date{${date}}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("en");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TranscriptMode>("latex");
  const [course, setCourse] = useState("");
  const [lectureTitle, setLectureTitle] = useState("");
  const [lectureDate, setLectureDate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
  const [formattingUsage, setFormattingUsage] =
    useState<FormattingUsage | null>(null);
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState("Ready");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedPassword = window.localStorage.getItem(PASSWORD_STORAGE_KEY);
    if (savedPassword) {
      setPassword(savedPassword);
      setRememberPassword(true);
    }
  }, []);

  useEffect(() => {
    if (rememberPassword) {
      window.localStorage.setItem(PASSWORD_STORAGE_KEY, password);
    } else {
      window.localStorage.removeItem(PASSWORD_STORAGE_KEY);
    }
  }, [password, rememberPassword]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);

    if (!file) {
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setStatus(`File is ${formatFileSize(file.size)}. The limit is 25 MB.`);
      return;
    }

    setStatus(`Selected ${file.name} (${formatFileSize(file.size)}).`);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = selectedFile || fileInputRef.current?.files?.[0];
    if (!file) {
      setStatus("Choose an audio or video file first.");
      return;
    }

    if (file.size > MAX_FILE_BYTES) {
      setStatus(`File is ${formatFileSize(file.size)}. The limit is 25 MB.`);
      return;
    }

    setIsLoading(true);
    setUsage(null);
    setFormattingUsage(null);
    setRawTranscript("");
    setStage("Uploading");
    setStatus("Uploading file...");

    const stageTimer = window.setTimeout(() => {
      setStage(mode === "raw" ? "Transcribing" : "Formatting");
      setStatus(
        mode === "raw"
          ? "Transcribing audio..."
          : mode === "clean"
            ? "Transcribing and creating clean notes..."
            : "Transcribing and formatting LaTeX math..."
      );
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("password", password);
      formData.append("language", language.trim() || "en");
      formData.append("prompt", prompt.trim());
      formData.append("mode", mode);
      formData.append("course", course.trim());
      formData.append("lectureTitle", lectureTitle.trim());
      formData.append("lectureDate", lectureDate.trim());

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as TranscribeResponse;

      if (!response.ok) {
        throw new Error(data.error || "Transcription failed.");
      }

      const metadataBlock = buildTranscriptMetadata({
        course,
        lectureTitle,
        lectureDate,
        sourceFile: file.name,
        mode
      });
      setTranscript(`${metadataBlock}${data.text || ""}`);
      setRawTranscript(data.rawText || "");
      setUsage(data.usage || null);
      setFormattingUsage(data.formattingUsage || null);
      setStage("Ready");
      setStatus("Transcript ready.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setStage("Error");
      setStatus(message);
    } finally {
      window.clearTimeout(stageTimer);
      setIsLoading(false);
    }
  }

  async function copyTranscript() {
    if (!transcript) {
      setStatus("There is no transcript to copy yet.");
      return;
    }

    await navigator.clipboard.writeText(transcript);
    setStatus("Transcript copied.");
  }

  function downloadTranscript() {
    if (!transcript) {
      setStatus("There is no transcript to download yet.");
      return;
    }

    const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transcript.txt";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Transcript downloaded.");
  }

  function downloadTex() {
    if (!transcript) {
      setStatus("There is no transcript to export yet.");
      return;
    }

    const warning = validateLatexDelimiters(transcript);
    if (warning) {
      setStatus(`${warning} Review the transcript before exporting.`);
      return;
    }

    const blob = new Blob(
      [buildTexDocument(transcript, { course, lectureTitle, lectureDate })],
      {
        type: "application/x-tex;charset=utf-8"
      }
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "math-class-transcript.tex";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("LaTeX file downloaded.");
  }

  function openInOverleaf() {
    if (!transcript) {
      setStatus("There is no transcript to open in Overleaf yet.");
      return;
    }

    const warning = validateLatexDelimiters(transcript);
    if (warning) {
      setStatus(`${warning} Review the transcript before opening Overleaf.`);
      return;
    }

    const form = document.createElement("form");
    form.action = "https://www.overleaf.com/docs";
    form.method = "post";
    form.target = "_blank";
    form.rel = "noopener noreferrer";

    const snippet = document.createElement("input");
    snippet.type = "hidden";
    snippet.name = "encoded_snip";
    snippet.value = encodeURIComponent(
      buildTexDocument(transcript, { course, lectureTitle, lectureDate })
    );

    const engine = document.createElement("input");
    engine.type = "hidden";
    engine.name = "engine";
    engine.value = "pdflatex";

    form.append(snippet, engine);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    setStatus("Opening transcript in Overleaf...");
  }

  return (
    <main className="page">
      <section className="card" aria-labelledby="page-title">
        <div className="header">
          <div className="title-row">
            <img src="/icon.svg" alt="" aria-hidden="true" />
            <h1 id="page-title">Audio Transcriber</h1>
          </div>
          <p>
            Upload an audio or video file, add optional hints, and edit the
            transcript when it returns.
          </p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label className="field password-field">
            <span>App password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Required if configured"
              autoComplete="current-password"
              disabled={isLoading}
            />
          </label>

          <label className="checkbox remember">
            <input
              type="checkbox"
              checked={rememberPassword}
              onChange={(event) => setRememberPassword(event.target.checked)}
              disabled={isLoading}
            />
            <span>Remember on this device</span>
          </label>

          <label className="field file-field">
            <span>Audio or video file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              onChange={handleFileChange}
              disabled={isLoading}
            />
          </label>

          {selectedFile ? (
            <p className="file-info">
              {selectedFile.name} • {formatFileSize(selectedFile.size)} / 25 MB
            </p>
          ) : null}

          <div className="metadata-grid">
            <label className="field">
              <span>Course</span>
              <input
                type="text"
                value={course}
                onChange={(event) => setCourse(event.target.value)}
                placeholder="Calculus II"
                disabled={isLoading}
              />
            </label>

            <label className="field">
              <span>Lecture title</span>
              <input
                type="text"
                value={lectureTitle}
                onChange={(event) => setLectureTitle(event.target.value)}
                placeholder="Integration by parts"
                disabled={isLoading}
              />
            </label>

            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={lectureDate}
                onChange={(event) => setLectureDate(event.target.value)}
                disabled={isLoading}
              />
            </label>
          </div>

          <label className="field language-field">
            <span>Language</span>
            <input
              type="text"
              inputMode="text"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="en"
              disabled={isLoading}
            />
          </label>

          <label className="field prompt-field">
            <span>Lecture context and vocabulary</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Names, theorem names, symbols, textbook section, vocabulary..."
              rows={2}
              disabled={isLoading}
            />
          </label>

          <fieldset className="mode-field" disabled={isLoading}>
            <legend>Transcript mode</legend>
            <label>
              <input
                type="radio"
                name="mode"
                value="raw"
                checked={mode === "raw"}
                onChange={() => setMode("raw")}
              />
              <span>Raw</span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="clean"
                checked={mode === "clean"}
                onChange={() => setMode("clean")}
              />
              <span>Clean notes</span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="latex"
                checked={mode === "latex"}
                onChange={() => setMode("latex")}
              />
              <span>LaTeX math</span>
            </label>
          </fieldset>

          <button className="primary" type="submit" disabled={isLoading}>
            {isLoading ? "Transcribing..." : "Transcribe"}
          </button>
        </form>

        <div className="stage-bar" aria-label="Progress stage">
          {["Uploading", "Transcribing", "Formatting", "Ready"].map((item) => (
            <span
              key={item}
              className={stage === item ? "active" : ""}
              aria-current={stage === item ? "step" : undefined}
            >
              {item}
            </span>
          ))}
        </div>

        <p className="status" role="status" aria-live="polite">
          {status || "Ready."}
        </p>

        {usage ? (
          <div className="usage" aria-label="API usage">
            <span>Transcription usage</span>
            <strong>{formatUsage(usage)}</strong>
          </div>
        ) : null}

        {formattingUsage ? (
          <div className="usage" aria-label="Formatting usage">
            <span>Math formatting usage</span>
            <strong>{formatTokenUsage(formattingUsage)}</strong>
          </div>
        ) : null}

        <div className="actions">
          <button type="button" onClick={copyTranscript} disabled={!transcript}>
            Copy transcript
          </button>
          <button
            type="button"
            onClick={downloadTranscript}
            disabled={!transcript}
          >
            Download .txt
          </button>
          <button type="button" onClick={downloadTex} disabled={!transcript}>
            Download .tex
          </button>
          <button type="button" onClick={openInOverleaf} disabled={!transcript}>
            Open in Overleaf
          </button>
        </div>

        <label className="field transcript">
          <span>{mode === "raw" ? "Transcript" : "Formatted transcript"}</span>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Your transcript will appear here."
            rows={8}
          />
        </label>

        {rawTranscript ? (
          <details className="raw-transcript">
            <summary>Original transcript</summary>
            <textarea value={rawTranscript} readOnly rows={8} />
          </details>
        ) : null}
      </section>
    </main>
  );
}
