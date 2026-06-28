"use client";

import katex from "katex";
import { ChangeEvent, FormEvent, ReactNode, useEffect, useRef, useState } from "react";

type TranscribeResponse = {
  text?: string;
  rawText?: string;
  usage?: TranscriptionUsage;
  boardContext?: string;
  boardUsage?: FormattingUsage | null;
  formattingUsage?: FormattingUsage | null;
  savedLecture?: {
    id: string;
    created_at: string;
  } | null;
  archiveError?: string;
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

type ArchiveAsset = {
  name: string;
  path: string;
  type: string;
  url?: string;
};

type ArchiveLecture = {
  id: string;
  created_at: string;
  course: string;
  lecture_title: string;
  lecture_date: string;
  source_file: string;
  transcript_mode: TranscriptMode;
  transcript: string;
  raw_transcript: string;
  board_context: string;
  board_photo_count: number;
  assetUrls: ArchiveAsset[];
};

type ArchiveResponse = {
  lectures?: ArchiveLecture[];
  archiveEnabled?: boolean;
  error?: string;
};

type LectureMutationResponse = {
  lecture?: ArchiveLecture;
  ok?: boolean;
  error?: string;
};

type AppTab = "create" | "archive";

const ACCEPTED_FORMATS = ".mp3,.wav,.m4a,.mp4,.mpeg,.webm,.ogg,audio/*,video/*";
const ACCEPTED_IMAGE_FORMATS = "image/*";
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const BOARD_IMAGE_MAX_DIMENSION = 1600;
const BOARD_IMAGE_QUALITY = 0.72;
const PASSWORD_STORAGE_KEY = "lectureforge-password";

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

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderInlineMath(text: string) {
  const parts = text.split(/(\\\([\s\S]*?\\\))/g);

  return parts
    .map((part) => {
      const inlineMath = part.match(/^\\\(([\s\S]*?)\\\)$/);

      if (!inlineMath) {
        return escapeHtml(part);
      }

      try {
        return katex.renderToString(inlineMath[1], {
          displayMode: false,
          throwOnError: false
        });
      } catch {
        return escapeHtml(part);
      }
    })
    .join("");
}

function renderDisplayMath(math: string) {
  try {
    return katex.renderToString(math, {
      displayMode: true,
      throwOnError: false
    });
  } catch {
    return `<pre>${escapeHtml(math)}</pre>`;
  }
}

function MarkdownMathPreview({ text }: { text: string }) {
  const lines = text.trim().split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let listItems: string[] = [];
  let displayMath: string[] = [];
  let inDisplayMath = false;

  function flushList() {
    if (!listItems.length) {
      return;
    }

    nodes.push(
      <ul key={`list-${nodes.length}`}>
        {listItems.map((item, index) => (
          <li
            key={`${item}-${index}`}
            dangerouslySetInnerHTML={{ __html: renderInlineMath(item) }}
          />
        ))}
      </ul>
    );
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("\\[") && line.endsWith("\\]") && line.length > 4) {
      flushList();
      nodes.push(
        <div
          className="math-block"
          key={`math-${nodes.length}`}
          dangerouslySetInnerHTML={{
            __html: renderDisplayMath(line.slice(2, -2).trim())
          }}
        />
      );
      continue;
    }

    if (line === "\\[") {
      flushList();
      inDisplayMath = true;
      displayMath = [];
      continue;
    }

    if (line === "\\]" && inDisplayMath) {
      nodes.push(
        <div
          className="math-block"
          key={`math-${nodes.length}`}
          dangerouslySetInnerHTML={{
            __html: renderDisplayMath(displayMath.join("\n"))
          }}
        />
      );
      inDisplayMath = false;
      displayMath = [];
      continue;
    }

    if (inDisplayMath) {
      displayMath.push(rawLine);
      continue;
    }

    if (!line) {
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      nodes.push(
        <Tag
          key={`heading-${nodes.length}`}
          dangerouslySetInnerHTML={{
            __html: renderInlineMath(stripMarkdownMarks(heading[2]))
          }}
        />
      );
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(stripMarkdownMarks(bullet[1]));
      continue;
    }

    flushList();
    nodes.push(
      <p
        key={`p-${nodes.length}`}
        dangerouslySetInnerHTML={{
          __html: renderInlineMath(stripMarkdownMarks(line))
        }}
      />
    );
  }

  flushList();

  return <div className="rendered-notes">{nodes}</div>;
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
    .replace(/^```(?:latex|tex|markdown|md)?\s*$/gim, "")
    .replace(/^```\s*$/gim, "")
    .replace(/\\\{\}section\*/g, "\\section*")
    .replace(/\\textbackslash\{\}section\*/g, "\\section*")
    .replace(/\\\{\}subsection\*/g, "\\subsection*")
    .replace(/\\textbackslash\{\}subsection\*/g, "\\subsection*")
    .replace(/\\\{\}begin\{itemize\}/g, "\\begin{itemize}")
    .replace(/\\textbackslash\{\}begin\{itemize\}/g, "\\begin{itemize}")
    .replace(/\\\{\}end\{itemize\}/g, "\\end{itemize}")
    .replace(/\\textbackslash\{\}end\{itemize\}/g, "\\end{itemize}")
    .replace(/\\\{\}item\b/g, "\\item")
    .replace(/\\textbackslash\{\}item\b/g, "\\item")
    .replace(/\\\{\}/g, "")
    .replace(/\\textbackslash\{\}/g, "")
    .replace(/\\\{\\\}/g, "");
}

function normalizeBareMathSyntax(text: string) {
  return text
    .replace(/\\\{\}\(/g, "\\(")
    .replace(/\\\{\}\)/g, "\\)")
    .replace(/\\\{\}\[/g, "\\[")
    .replace(/\\\{\}\]/g, "\\]")
    .replace(/\\\{\}/g, "")
    .replace(/\\textbackslash\{\}\(/g, "\\(")
    .replace(/\\textbackslash\{\}\)/g, "\\)")
    .replace(/\\textbackslash\{\}\[/g, "\\[")
    .replace(/\\textbackslash\{\}\]/g, "\\]")
    .replace(/\\textbackslash\{\}/g, "")
    .replace(/\\\{\\\}/g, "")
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\\\(?=[A-Za-z])/g, "\\");
}

function isEmptyLatexArtifactLine(line: string) {
  const normalized = normalizeBareMathSyntax(stripMarkdownMarks(line.trim()))
    .replace(/\s/g, "");

  return [
    "",
    "\\",
    "\\(",
    "\\)",
    "\\[",
    "\\]",
    "[",
    "]",
    "[]",
    "{}",
    "\\(\\)",
    "\\[\\]",
    "\\(\\[\\]\\)",
    "\\[\\(\\)\\]"
  ].includes(normalized);
}

function looksLikeBareMath(line: string) {
  const trimmed = normalizeBareMathSyntax(stripMarkdownMarks(line.trim()));

  if (!trimmed || trimmed.startsWith("\\(") || trimmed.startsWith("\\[")) {
    return false;
  }

  const mathCommandCount = (
    trimmed.match(
      /\\(?:frac|sqrt|int|sum|lim|theta|rho|alpha|beta|gamma|delta|partial|left|right|cdot|sin|cos|tan|ln|log)\b/g
    ) || []
  ).length;
  const operatorCount = (trimmed.match(/[=^_+\-*/]/g) || []).length;
  const textWithoutCommands = trimmed.replace(/\\[A-Za-z]+/g, "");
  const wordCount = (textWithoutCommands.match(/[A-Za-z]{3,}/g) || []).length;

  return mathCommandCount > 0 && operatorCount > 0 && wordCount <= 3;
}

function bareMathToDisplay(line: string) {
  return `\\[\n${normalizeBareMathSyntax(stripMarkdownMarks(line.trim()))}\n\\]`;
}

function convertMarkdownLineToLatex(line: string) {
  const trimmed = line.trim();
  const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);

  if (isEmptyLatexArtifactLine(line)) {
    return "";
  }

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

  if (looksLikeBareMath(line)) {
    return bareMathToDisplay(line);
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
    if (isEmptyLatexArtifactLine(line)) {
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (bullet) {
      if (!inItemize) {
        output.push("\\begin{itemize}");
        inItemize = true;
      }

      output.push(
        `\\item ${
          looksLikeBareMath(bullet[1])
            ? normalizeBareMathSyntax(stripMarkdownMarks(bullet[1].trim()))
            : escapeOutsideMath(stripMarkdownMarks(bullet[1]))
        }`
      );
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

  return cleanLatexBody(output.join("\n"));
}

function cleanLatexBody(body: string) {
  return body
    .replace(/\\textbackslash\{\\\}\\\{\\\}/g, "")
    .replace(/\\textbackslash\{\}\\\{\\\}/g, "")
    .replace(/\\textbackslash\{\}\\\{\\textbackslash\{\}\\\}/g, "")
    .replace(/(^|\n)\s*(?:\\textbackslash\{\\\}\\\{\\\}|\\textbackslash\{\}\\\{\\\}|\\textbackslash\{\}|\\\{\\\}|\\\{\}|\{\\\}|\{\})+\s*/g, "$1")
    .replace(/\s+(?:\\textbackslash\{\\\}\\\{\\\}|\\textbackslash\{\}\\\{\\\}|\\textbackslash\{\}|\\\{\\\}|\\\{\}|\{\\\}|\{\})+(?=\s|$)/g, " ")
    .replace(/\\textbackslash\{\}/g, "")
    .replace(/\\textbackslash/g, "")
    .replace(/(^|\n)\s*[\[\]]+\s*/g, "$1")
    .replace(/\s+[\[\]]+(?=\s|$)/g, " ")
    .replace(/\\?\{\\?\}/g, "")
    .replace(/\\\{\\\}/g, "")
    .replace(/\\\{\}/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
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

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    image.src = url;
  });
}

async function compressBoardPhoto(file: File) {
  const image = await loadImageFromFile(file);
  const scale = Math.min(
    1,
    BOARD_IMAGE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) {
    return file;
  }

  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", BOARD_IMAGE_QUALITY);
  });

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const safeName = file.name.replace(/\.[^.]+$/, "") || "board-photo";
  return new File([blob], `${safeName}.jpg`, { type: "image/jpeg" });
}

function buildTranscriptMetadata(metadata: {
  course: string;
  lectureTitle: string;
  lectureDate: string;
  sourceFile?: string;
  mode: TranscriptMode;
  boardPhotoCount: number;
}) {
  const rows = [
    "Transcript Metadata",
    `Course: ${metadata.course.trim() || "Not specified"}`,
    `Lecture Title: ${metadata.lectureTitle.trim() || "Not specified"}`,
    `Lecture Date: ${metadata.lectureDate.trim() || "Not specified"}`,
    `Source File: ${metadata.sourceFile || "Not specified"}`,
    `Board Photos: ${metadata.boardPhotoCount}`,
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
  const boardPhotoInputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [boardPhotos, setBoardPhotos] = useState<File[]>([]);
  const [language, setLanguage] = useState("en");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<TranscriptMode>("latex");
  const [course, setCourse] = useState("");
  const [lectureTitle, setLectureTitle] = useState("");
  const [lectureDate, setLectureDate] = useState("");
  const [transcript, setTranscript] = useState("");
  const [rawTranscript, setRawTranscript] = useState("");
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
  const [boardContext, setBoardContext] = useState("");
  const [boardUsage, setBoardUsage] = useState<FormattingUsage | null>(null);
  const [formattingUsage, setFormattingUsage] =
    useState<FormattingUsage | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("create");
  const [archiveLectures, setArchiveLectures] = useState<ArchiveLecture[]>([]);
  const [selectedArchiveLecture, setSelectedArchiveLecture] =
    useState<ArchiveLecture | null>(null);
  const [archiveEdit, setArchiveEdit] = useState({
    course: "",
    lecture_title: "",
    lecture_date: "",
    transcript_mode: "latex" as TranscriptMode,
    transcript: ""
  });
  const [archiveViewMode, setArchiveViewMode] = useState<"preview" | "source">(
    "preview"
  );
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archiveCourseFilter, setArchiveCourseFilter] = useState("All");
  const [lightboxAsset, setLightboxAsset] = useState<ArchiveAsset | null>(null);
  const [autoLoadedArchive, setAutoLoadedArchive] = useState(false);
  const [isArchiveSaving, setIsArchiveSaving] = useState(false);
  const [archiveStatus, setArchiveStatus] = useState("");
  const [isArchiveLoading, setIsArchiveLoading] = useState(false);
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

  useEffect(() => {
    if (password && !autoLoadedArchive) {
      setAutoLoadedArchive(true);
      void loadArchive({ switchToArchiveIfAny: true });
    }
  }, [password, autoLoadedArchive]);

  useEffect(() => {
    if (!selectedArchiveLecture) {
      setArchiveEdit({
        course: "",
        lecture_title: "",
        lecture_date: "",
        transcript_mode: "latex",
        transcript: ""
      });
      return;
    }

    setArchiveEdit({
      course: selectedArchiveLecture.course || "",
      lecture_title: selectedArchiveLecture.lecture_title || "",
      lecture_date: selectedArchiveLecture.lecture_date || "",
      transcript_mode:
        selectedArchiveLecture.transcript_mode === "raw" ||
        selectedArchiveLecture.transcript_mode === "clean" ||
        selectedArchiveLecture.transcript_mode === "latex"
          ? selectedArchiveLecture.transcript_mode
          : "latex",
      transcript: selectedArchiveLecture.transcript || ""
    });
    setArchiveViewMode("preview");
  }, [selectedArchiveLecture]);

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

  async function handleBoardPhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    setStatus(`Preparing ${files.length} board photo${files.length === 1 ? "" : "s"}...`);

    try {
      const compressedPhotos = await Promise.all(files.map(compressBoardPhoto));
      setBoardPhotos((current) => [...current, ...compressedPhotos]);
      setStatus(
        `${compressedPhotos.length} board photo${
          compressedPhotos.length === 1 ? "" : "s"
        } added.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not prepare board photos.";
      setStatus(message);
    } finally {
      if (boardPhotoInputRef.current) {
        boardPhotoInputRef.current.value = "";
      }
    }
  }

  function clearBoardPhotos() {
    setBoardPhotos([]);
    setBoardContext("");
    setBoardUsage(null);

    if (boardPhotoInputRef.current) {
      boardPhotoInputRef.current.value = "";
    }

    setStatus("Board photos cleared.");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = selectedFile || fileInputRef.current?.files?.[0];
    const requestMode: TranscriptMode = file ? mode : mode === "raw" ? "clean" : mode;

    if (!file && boardPhotos.length === 0) {
      setStatus("Choose an audio/video file or add board photos first.");
      return;
    }

    if (file && file.size > MAX_FILE_BYTES) {
      setStatus(`File is ${formatFileSize(file.size)}. The limit is 25 MB.`);
      return;
    }

    setIsLoading(true);
    setUsage(null);
    setBoardContext("");
    setBoardUsage(null);
    setFormattingUsage(null);
    setRawTranscript("");
    setStage("Uploading");
    setStatus(file ? "Uploading file..." : "Uploading board photos...");

    const stageTimer = window.setTimeout(() => {
      setStage(file && requestMode === "raw" ? "Transcribing" : "Formatting");
      setStatus(
        !file
          ? "Analyzing board photos and creating a structured lesson..."
          : requestMode === "raw"
          ? "Transcribing audio..."
          : requestMode === "clean"
            ? "Transcribing and creating clean notes..."
            : "Transcribing and formatting LaTeX math..."
      );
    }, 1200);

    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      }
      formData.append("password", password);
      formData.append("language", language.trim() || "en");
      formData.append("prompt", prompt.trim());
      formData.append("mode", requestMode);
      formData.append("course", course.trim());
      formData.append("lectureTitle", lectureTitle.trim());
      formData.append("lectureDate", lectureDate.trim());
      boardPhotos.forEach((photo) => {
        formData.append("boardPhotos", photo);
      });

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
        sourceFile: file?.name || "No audio file",
        mode: requestMode,
        boardPhotoCount: boardPhotos.length
      });
      setTranscript(`${metadataBlock}${data.text || ""}`);
      setRawTranscript(data.rawText || "");
      setUsage(data.usage || null);
      setBoardContext(data.boardContext || "");
      setBoardUsage(data.boardUsage || null);
      setFormattingUsage(data.formattingUsage || null);
      setStage("Ready");
      const archivePath = `${course.trim() || "Unfiled"} / ${
        lectureDate.trim() || "No date"
      } / ${lectureTitle.trim() || file?.name || "Untitled lecture"}`;
      setStatus(
        data.savedLecture
          ? file
            ? `Transcript ready. Saved to ${archivePath}.`
            : `Photo lesson ready. Saved to ${archivePath}.`
          : data.archiveError
            ? file
              ? `Transcript ready. Archive save failed: ${data.archiveError}`
              : `Photo lesson ready. Archive save failed: ${data.archiveError}`
          : file
            ? "Transcript ready."
            : "Photo lesson ready."
      );
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

  function resetTranscript() {
    setSelectedFile(null);
    setBoardPhotos([]);
    setTranscript("");
    setRawTranscript("");
    setUsage(null);
    setBoardContext("");
    setBoardUsage(null);
    setFormattingUsage(null);
    setStage("Ready");
    setStatus("Ready.");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (boardPhotoInputRef.current) {
      boardPhotoInputRef.current.value = "";
    }
  }

  async function loadArchive(options?: { switchToArchiveIfAny?: boolean }) {
    setIsArchiveLoading(true);
    setArchiveStatus("Loading saved lectures...");

    try {
      const response = await fetch("/api/lectures", {
        headers: {
          "x-app-password": password
        }
      });
      const data = (await response.json()) as ArchiveResponse;

      if (!response.ok) {
        throw new Error(data.error || "Could not load archive.");
      }

      if (data.archiveEnabled === false) {
        setArchiveStatus("Archive is not configured yet.");
        setArchiveLectures([]);
        return;
      }

      const loadedLectures = data.lectures || [];
      setArchiveLectures(loadedLectures);
      setSelectedArchiveLecture((current) => current || loadedLectures[0] || null);
      if (options?.switchToArchiveIfAny && loadedLectures.length) {
        setActiveTab("archive");
      }
      setArchiveStatus(
        `${loadedLectures.length} saved lecture${
          loadedLectures.length === 1 ? "" : "s"
        } loaded.`
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not load archive.";
      setArchiveStatus(message);
    } finally {
      setIsArchiveLoading(false);
    }
  }

  function archiveHasUnsavedChanges() {
    if (!selectedArchiveLecture) {
      return false;
    }

    return (
      archiveEdit.course !== (selectedArchiveLecture.course || "") ||
      archiveEdit.lecture_title !==
        (selectedArchiveLecture.lecture_title || "") ||
      archiveEdit.lecture_date !== (selectedArchiveLecture.lecture_date || "") ||
      archiveEdit.transcript_mode !== selectedArchiveLecture.transcript_mode ||
      archiveEdit.transcript !== (selectedArchiveLecture.transcript || "")
    );
  }

  function confirmArchiveNavigation() {
    if (!archiveHasUnsavedChanges()) {
      return true;
    }

    return window.confirm("You have unsaved archive changes. Continue without saving?");
  }

  function selectArchivedLecture(lecture: ArchiveLecture) {
    if (!confirmArchiveNavigation()) {
      return;
    }

    setSelectedArchiveLecture(lecture);
  }

  function openArchivedLecture(lecture: ArchiveLecture) {
    const loadedMode =
      lecture.transcript_mode === "raw" ||
      lecture.transcript_mode === "clean" ||
      lecture.transcript_mode === "latex"
        ? lecture.transcript_mode
        : "latex";
    const metadataBlock = buildTranscriptMetadata({
      course: lecture.course || "",
      lectureTitle: lecture.lecture_title || "",
      lectureDate: lecture.lecture_date || "",
      sourceFile: lecture.source_file || "Archived lecture",
      mode: loadedMode,
      boardPhotoCount: lecture.board_photo_count || 0
    });

    setCourse(lecture.course || "");
    setLectureTitle(lecture.lecture_title || "");
    setLectureDate(lecture.lecture_date || "");
    setMode(loadedMode);
    setSelectedFile(null);
    setBoardPhotos([]);
    setTranscript(`${metadataBlock}${lecture.transcript || ""}`);
    setRawTranscript(lecture.raw_transcript || "");
    setBoardContext(lecture.board_context || "");
    setUsage(null);
    setBoardUsage(null);
    setFormattingUsage(null);
    setStage("Ready");
    setStatus("Archived lecture opened.");
    setActiveTab("create");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function archiveTitle(lecture: ArchiveLecture) {
    return (
      lecture.lecture_title ||
      lecture.course ||
      lecture.source_file ||
      "Untitled lecture"
    );
  }

  function archiveCourses() {
    return Array.from(
      new Set(
        archiveLectures.map((lecture) => lecture.course || "Unfiled")
      )
    ).sort((first, second) => first.localeCompare(second));
  }

  function filteredArchiveLectures() {
    const query = archiveSearch.trim().toLowerCase();

    return archiveLectures.filter((lecture) => {
      const courseName = lecture.course || "Unfiled";
      const matchesCourse =
        archiveCourseFilter === "All" || courseName === archiveCourseFilter;
      const searchable = [
        lecture.course,
        lecture.lecture_title,
        lecture.lecture_date,
        lecture.source_file,
        lecture.transcript
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesCourse && (!query || searchable.includes(query));
    });
  }

  function updateArchiveLectureInState(updated: ArchiveLecture) {
    setArchiveLectures((current) =>
      current.map((lecture) => (lecture.id === updated.id ? updated : lecture))
    );
    setSelectedArchiveLecture(updated);
  }

  async function saveArchivedLecture() {
    if (!selectedArchiveLecture) {
      return;
    }

    setIsArchiveSaving(true);
    setArchiveStatus("Saving lecture...");

    try {
      const response = await fetch(`/api/lectures/${selectedArchiveLecture.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-app-password": password
        },
        body: JSON.stringify(archiveEdit)
      });
      const data = (await response.json()) as LectureMutationResponse;

      if (!response.ok || !data.lecture) {
        throw new Error(data.error || "Could not save lecture.");
      }

      updateArchiveLectureInState({
        ...selectedArchiveLecture,
        ...data.lecture,
        assetUrls: selectedArchiveLecture.assetUrls
      });
      setArchiveStatus("Lecture saved.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not save lecture.";
      setArchiveStatus(message);
    } finally {
      setIsArchiveSaving(false);
    }
  }

  async function deleteArchivedLecture() {
    if (!selectedArchiveLecture) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${archiveTitle(selectedArchiveLecture)}" and its board images?`
    );

    if (!confirmed) {
      return;
    }

    setIsArchiveSaving(true);
    setArchiveStatus("Deleting lecture...");

    try {
      const response = await fetch(`/api/lectures/${selectedArchiveLecture.id}`, {
        method: "DELETE",
        headers: {
          "x-app-password": password
        }
      });
      const data = (await response.json()) as LectureMutationResponse;

      if (!response.ok) {
        throw new Error(data.error || "Could not delete lecture.");
      }

      setArchiveLectures((current) => {
        const remaining = current.filter(
          (lecture) => lecture.id !== selectedArchiveLecture.id
        );
        setSelectedArchiveLecture(remaining[0] || null);
        return remaining;
      });
      setArchiveStatus("Lecture deleted.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not delete lecture.";
      setArchiveStatus(message);
    } finally {
      setIsArchiveSaving(false);
    }
  }

  async function copyArchivedLecture() {
    if (!selectedArchiveLecture) {
      return;
    }

    await navigator.clipboard.writeText(archiveEdit.transcript || "");
    setArchiveStatus("Lecture notes copied.");
  }

  function archiveDownloadName(extension: "txt" | "tex") {
    const title =
      archiveEdit.lecture_title ||
      selectedArchiveLecture?.lecture_title ||
      "lecture";
    const safeTitle =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "lecture";

    return `${safeTitle}.${extension}`;
  }

  function downloadArchivedText() {
    if (!selectedArchiveLecture) {
      return;
    }

    const blob = new Blob([archiveEdit.transcript || ""], {
      type: "text/plain;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = archiveDownloadName("txt");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setArchiveStatus("Lecture .txt downloaded.");
  }

  function buildArchivedTex() {
    return buildTexDocument(archiveEdit.transcript || "", {
      course: archiveEdit.course,
      lectureTitle: archiveEdit.lecture_title,
      lectureDate: archiveEdit.lecture_date
    });
  }

  function downloadArchivedTex() {
    if (!selectedArchiveLecture) {
      return;
    }

    const warning = validateLatexDelimiters(archiveEdit.transcript || "");
    if (warning) {
      setArchiveStatus(`${warning} Review the lecture before exporting.`);
      return;
    }

    const blob = new Blob([buildArchivedTex()], {
      type: "application/x-tex;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = archiveDownloadName("tex");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setArchiveStatus("Lecture .tex downloaded.");
  }

  function openArchivedInOverleaf() {
    if (!selectedArchiveLecture) {
      return;
    }

    const warning = validateLatexDelimiters(archiveEdit.transcript || "");
    if (warning) {
      setArchiveStatus(`${warning} Review the lecture before opening Overleaf.`);
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
    snippet.value = encodeURIComponent(buildArchivedTex());

    const engine = document.createElement("input");
    engine.type = "hidden";
    engine.name = "engine";
    engine.value = "pdflatex";

    form.append(snippet, engine);
    document.body.appendChild(form);
    form.submit();
    form.remove();
    setArchiveStatus("Opening lecture in Overleaf...");
  }

  function groupedArchive() {
    const groups = new Map<string, Map<string, ArchiveLecture[]>>();

    for (const lecture of filteredArchiveLectures()) {
      const courseName = lecture.course || "Unfiled";
      const dateName = lecture.lecture_date || "No date";

      if (!groups.has(courseName)) {
        groups.set(courseName, new Map());
      }

      const courseGroup = groups.get(courseName);
      if (!courseGroup?.has(dateName)) {
        courseGroup?.set(dateName, []);
      }

      courseGroup?.get(dateName)?.push(lecture);
    }

    return Array.from(groups.entries());
  }

  return (
    <main className="page">
      <section className="card" aria-labelledby="page-title">
        <div className="header">
          <div className="title-row">
            <img src="/icon.svg" alt="" aria-hidden="true" />
            <h1 id="page-title">LectureForge</h1>
          </div>
          <p>
            Upload audio/video, board photos, or both, then edit the generated
            transcript or lesson.
          </p>
        </div>

        <div className="top-tabs" role="tablist" aria-label="App sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "create"}
            className={activeTab === "create" ? "active" : ""}
            onClick={() => {
              if (confirmArchiveNavigation()) {
                setActiveTab("create");
              }
            }}
          >
            New Lecture
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "archive"}
            className={activeTab === "archive" ? "active" : ""}
            onClick={() => {
              setActiveTab("archive");

              if (!archiveLectures.length && !isArchiveLoading) {
                void loadArchive();
              }
            }}
          >
            Archive
          </button>
        </div>

        {activeTab === "create" ? (
          <>
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              onClick={resetTranscript}
              disabled={isLoading}
            >
              New transcript
            </button>
          </div>

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

          <section className="board-panel" aria-labelledby="board-title">
            <div>
              <h2 id="board-title">Board photos</h2>
              <p>
                Add whiteboard photos to help the notes capture written math.
              </p>
            </div>
            <div className="board-actions">
              <label className="secondary upload-photos">
                Add photos
                <input
                  ref={boardPhotoInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_FORMATS}
                  multiple
                  onChange={handleBoardPhotoChange}
                  disabled={isLoading}
                />
              </label>
              <button
                className="secondary"
                type="button"
                onClick={clearBoardPhotos}
                disabled={isLoading || boardPhotos.length === 0}
              >
                Clear
              </button>
            </div>
            <p className="board-info">
              {boardPhotos.length
                ? `${boardPhotos.length} photo${
                    boardPhotos.length === 1 ? "" : "s"
                  } selected`
                : "No board photos selected"}
            </p>
          </section>

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
              <span>Notes</span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                value="latex"
                checked={mode === "latex"}
                onChange={() => setMode("latex")}
              />
              <span>LaTeX</span>
            </label>
          </fieldset>

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

          <details className="advanced">
            <summary>Advanced</summary>
            <div className="advanced-grid">
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
            </div>
          </details>

          <button className="primary" type="submit" disabled={isLoading}>
            {isLoading
              ? selectedFile
                ? "Transcribing..."
                : "Creating lesson..."
              : selectedFile
                ? "Transcribe"
                : "Create lesson"}
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

        {usage || boardUsage || formattingUsage ? (
          <details className="usage-details">
            <summary>Usage details</summary>
            {usage ? (
              <div className="usage" aria-label="API usage">
                <span>Transcription</span>
                <strong>{formatUsage(usage)}</strong>
              </div>
            ) : null}

            {boardUsage ? (
              <div className="usage" aria-label="Board photo usage">
                <span>Board photos</span>
                <strong>{formatTokenUsage(boardUsage)}</strong>
              </div>
            ) : null}

            {formattingUsage ? (
              <div className="usage" aria-label="Formatting usage">
                <span>Formatting</span>
                <strong>{formatTokenUsage(formattingUsage)}</strong>
              </div>
            ) : null}
          </details>
        ) : null}

        {boardContext ? (
          <details className="raw-transcript board-context">
            <summary>Extracted board context</summary>
            <textarea value={boardContext} readOnly rows={6} />
          </details>
        ) : null}

        <label className="field transcript">
          <span>{mode === "raw" ? "Transcript" : "Formatted transcript"}</span>
          <textarea
            value={transcript}
            onChange={(event) => setTranscript(event.target.value)}
            placeholder="Your transcript will appear here."
            rows={8}
          />
        </label>

        <div className="actions">
          <button type="button" onClick={copyTranscript} disabled={!transcript}>
            Copy
          </button>
          <button
            type="button"
            onClick={downloadTranscript}
            disabled={!transcript}
          >
            .txt
          </button>
          <button type="button" onClick={downloadTex} disabled={!transcript}>
            .tex
          </button>
          <button type="button" onClick={openInOverleaf} disabled={!transcript}>
            Overleaf
          </button>
        </div>

        {rawTranscript ? (
          <details className="raw-transcript">
            <summary>Original transcript</summary>
            <textarea value={rawTranscript} readOnly rows={8} />
          </details>
        ) : null}
          </>
        ) : (
          <section className="archive-workspace" aria-label="Lecture archive">
            <div className="archive-header">
              <button
                className="secondary"
                type="button"
                onClick={() => void loadArchive()}
                disabled={isArchiveLoading}
              >
                {isArchiveLoading ? "Loading..." : "Load saved lectures"}
              </button>
              <span>{archiveStatus || "Load saved lectures to browse by course."}</span>
            </div>

            <div className="archive-search-row">
              <label className="field">
                <span>Search archive</span>
                <input
                  value={archiveSearch}
                  onChange={(event) => setArchiveSearch(event.target.value)}
                  placeholder="Course, title, date, formula, keyword..."
                />
              </label>
              <div className="course-chips" aria-label="Course filters">
                {["All", ...archiveCourses()].map((courseName) => (
                  <button
                    type="button"
                    key={courseName}
                    className={
                      archiveCourseFilter === courseName ? "active" : ""
                    }
                    onClick={() => setArchiveCourseFilter(courseName)}
                  >
                    {courseName}
                  </button>
                ))}
              </div>
            </div>

            <div className="archive-grid">
              <aside className="archive-tree" aria-label="Saved lecture tree">
                {filteredArchiveLectures().length ? (
                  groupedArchive().map(([courseName, dateGroups]) => (
                    <details key={courseName} open>
                      <summary>{courseName}</summary>
                      {Array.from(dateGroups.entries()).map(
                        ([dateName, lectures]) => (
                          <details key={`${courseName}-${dateName}`} open>
                            <summary>{dateName}</summary>
                            <div className="archive-tree-items">
                              {lectures.map((lecture) => (
                                <button
                                  type="button"
                                  key={lecture.id}
                                  className={
                                    selectedArchiveLecture?.id === lecture.id
                                      ? "active"
                                      : ""
                                  }
                                  onClick={() => selectArchivedLecture(lecture)}
                                >
                                  {archiveTitle(lecture)}
                                </button>
                              ))}
                            </div>
                          </details>
                        )
                      )}
                    </details>
                  ))
                ) : (
                  <p className="empty-archive">
                    {archiveLectures.length
                      ? "No lectures match the current search or course filter."
                      : "No saved lectures yet. Create a lecture from audio, video, or board photos, then return here."}
                  </p>
                )}
              </aside>

              <section className="archive-viewer" aria-label="Selected lecture">
                {selectedArchiveLecture ? (
                  <>
                    <div className="archive-viewer-header">
                      <div>
                        <h2>{archiveTitle(selectedArchiveLecture)}</h2>
                        <p>
                          {[
                            selectedArchiveLecture.course,
                            selectedArchiveLecture.lecture_date,
                            selectedArchiveLecture.transcript_mode
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      </div>
                      <div className="archive-actions">
                        <button
                          className="secondary"
                          type="button"
                          onClick={saveArchivedLecture}
                          disabled={isArchiveSaving}
                        >
                          Save
                        </button>
                        <button
                          className="secondary"
                          type="button"
                          onClick={() =>
                            openArchivedLecture(selectedArchiveLecture)
                          }
                        >
                          Open in editor
                        </button>
                        <button
                          className="danger"
                          type="button"
                          onClick={deleteArchivedLecture}
                          disabled={isArchiveSaving}
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {archiveHasUnsavedChanges() ? (
                      <p className="unsaved-banner">Unsaved changes</p>
                    ) : null}

                    <div className="archive-edit-grid">
                      <label className="field">
                        <span>Course</span>
                        <input
                          value={archiveEdit.course}
                          onChange={(event) =>
                            setArchiveEdit((current) => ({
                              ...current,
                              course: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Lecture title</span>
                        <input
                          value={archiveEdit.lecture_title}
                          onChange={(event) =>
                            setArchiveEdit((current) => ({
                              ...current,
                              lecture_title: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Date</span>
                        <input
                          type="date"
                          value={archiveEdit.lecture_date || ""}
                          onChange={(event) =>
                            setArchiveEdit((current) => ({
                              ...current,
                              lecture_date: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Mode</span>
                        <select
                          value={archiveEdit.transcript_mode}
                          onChange={(event) =>
                            setArchiveEdit((current) => ({
                              ...current,
                              transcript_mode: event.target
                                .value as TranscriptMode
                            }))
                          }
                        >
                          <option value="raw">Raw</option>
                          <option value="clean">Notes</option>
                          <option value="latex">LaTeX</option>
                        </select>
                      </label>
                    </div>

                    {selectedArchiveLecture.assetUrls?.length ? (
                      <div className="archive-images">
                        {selectedArchiveLecture.assetUrls.map((asset, index) =>
                          asset.url ? (
                            <button
                              type="button"
                              key={asset.path}
                              onClick={() => setLightboxAsset(asset)}
                            >
                              <img
                                src={asset.url}
                                alt={`Board photo ${index + 1}`}
                              />
                              <span>Fig. {index + 1}</span>
                            </button>
                          ) : null
                        )}
                      </div>
                    ) : null}

                    <div className="archive-export-actions">
                      <button type="button" onClick={copyArchivedLecture}>
                        Copy
                      </button>
                      <button type="button" onClick={downloadArchivedText}>
                        .txt
                      </button>
                      <button type="button" onClick={downloadArchivedTex}>
                        .tex
                      </button>
                      <button type="button" onClick={openArchivedInOverleaf}>
                        Overleaf
                      </button>
                    </div>

                    <div className="archive-view-toggle">
                      <button
                        type="button"
                        className={archiveViewMode === "preview" ? "active" : ""}
                        onClick={() => setArchiveViewMode("preview")}
                      >
                        Rendered
                      </button>
                      <button
                        type="button"
                        className={archiveViewMode === "source" ? "active" : ""}
                        onClick={() => setArchiveViewMode("source")}
                      >
                        Source
                      </button>
                    </div>

                    {archiveViewMode === "preview" ? (
                      <MarkdownMathPreview text={archiveEdit.transcript || ""} />
                    ) : (
                      <label className="archive-source field">
                        <span>Markdown / LaTeX source</span>
                      <textarea
                          value={archiveEdit.transcript || ""}
                          onChange={(event) =>
                            setArchiveEdit((current) => ({
                              ...current,
                              transcript: event.target.value
                            }))
                          }
                          rows={14}
                      />
                      </label>
                    )}
                  </>
                ) : (
                  <p className="empty-archive">
                    Select a saved lecture to view rendered notes, edit metadata,
                    export LaTeX, or manage the file.
                  </p>
                )}
              </section>
            </div>
          </section>
        )}
        {lightboxAsset?.url ? (
          <div
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Board photo preview"
            onClick={() => setLightboxAsset(null)}
          >
            <div onClick={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => setLightboxAsset(null)}>
                Close
              </button>
              <img src={lightboxAsset.url} alt={lightboxAsset.name} />
              <p>{lightboxAsset.name}</p>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
