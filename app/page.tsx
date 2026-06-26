"use client";

import { FormEvent, useRef, useState } from "react";

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

function buildTexDocument(transcript: string) {
  const body = escapeOutsideMath(transcript.trim() || "No transcript yet.");

  return `\\documentclass[11pt]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath,amssymb}
\\usepackage[margin=1in]{geometry}
\\usepackage{microtype}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0.8em}

\\title{Math Class Transcript}
\\date{\\today}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
}

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState("en");
  const [prompt, setPrompt] = useState("");
  const [formatMath, setFormatMath] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
  const [formattingUsage, setFormattingUsage] =
    useState<FormattingUsage | null>(null);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setStatus("Choose an audio or video file first.");
      return;
    }

    setIsLoading(true);
    setUsage(null);
    setFormattingUsage(null);
    setRawTranscript("");
    setStatus(
      formatMath
        ? "Uploading, transcribing, and formatting math..."
        : "Uploading and transcribing..."
    );

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("password", password);
      formData.append("language", language.trim() || "en");
      formData.append("prompt", prompt.trim());
      formData.append("formatMath", String(formatMath));

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as TranscribeResponse;

      if (!response.ok) {
        throw new Error(data.error || "Transcription failed.");
      }

      setTranscript(data.text || "");
      setRawTranscript(data.rawText || "");
      setUsage(data.usage || null);
      setFormattingUsage(data.formattingUsage || null);
      setStatus(
        formatMath
          ? "Transcription complete with math formatting."
          : "Transcription complete."
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Something went wrong.";
      setStatus(message);
    } finally {
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

    const blob = new Blob([buildTexDocument(transcript)], {
      type: "application/x-tex;charset=utf-8"
    });
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

    const form = document.createElement("form");
    form.action = "https://www.overleaf.com/docs";
    form.method = "post";
    form.target = "_blank";
    form.rel = "noopener noreferrer";

    const snippet = document.createElement("input");
    snippet.type = "hidden";
    snippet.name = "encoded_snip";
    snippet.value = encodeURIComponent(buildTexDocument(transcript));

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
          <label className="field">
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

          <label className="field">
            <span>Audio or video file</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_FORMATS}
              disabled={isLoading}
            />
          </label>

          <label className="field">
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

          <label className="field">
            <span>Prompt or hints</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Names, jargon, places, vocabulary..."
              rows={2}
              disabled={isLoading}
            />
          </label>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={formatMath}
              onChange={(event) => setFormatMath(event.target.checked)}
              disabled={isLoading}
            />
            <span>Format math as LaTeX</span>
          </label>

          <button className="primary" type="submit" disabled={isLoading}>
            {isLoading ? "Transcribing..." : "Transcribe"}
          </button>
        </form>

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

        <label className="field transcript">
          <span>{formatMath ? "Formatted transcript" : "Transcript"}</span>
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
      </section>
    </main>
  );
}
