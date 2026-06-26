"use client";

import { FormEvent, useRef, useState } from "react";

type TranscribeResponse = {
  text?: string;
  usage?: TranscriptionUsage;
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

export default function Home() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [language, setLanguage] = useState("en");
  const [prompt, setPrompt] = useState("");
  const [transcript, setTranscript] = useState("");
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
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
    setStatus("Uploading and transcribing...");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("language", language.trim() || "en");
      formData.append("prompt", prompt.trim());

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      const data = (await response.json()) as TranscribeResponse;

      if (!response.ok) {
        throw new Error(data.error || "Transcription failed.");
      }

      setTranscript(data.text || "");
      setUsage(data.usage || null);
      setStatus("Transcription complete.");
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

  return (
    <main className="page">
      <section className="card" aria-labelledby="page-title">
        <div className="header">
          <h1 id="page-title">Audio Transcriber</h1>
          <p>
            Upload an audio or video file, add optional hints, and edit the
            transcript when it returns.
          </p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
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
              rows={4}
              disabled={isLoading}
            />
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
            <span>API usage</span>
            <strong>{formatUsage(usage)}</strong>
          </div>
        ) : null}

        <label className="field transcript">
          <span>Transcript</span>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Your transcript will appear here."
            rows={12}
          />
        </label>

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
        </div>
      </section>
    </main>
  );
}
