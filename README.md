# Tablet Transcriber

A small Next.js app for uploading an audio or video file from a tablet, sending it to OpenAI's server-side speech-to-text API, and editing the returned transcript in the browser.

The app uses the official `openai` npm package and the `gpt-4o-transcribe` model. The OpenAI API key is read only on the server from `OPENAI_API_KEY`; it is never included in frontend code.

The `APP_PASSWORD` environment variable protects the transcription endpoint from public use. In production, it must be set. Users must enter the matching password in the form before the app will spend API credits.

## Features

- Mobile-friendly upload form for MP3, WAV, M4A, MP4, MPEG, WEBM, and OGG files.
- Optional "remember on this device" app-password storage in the browser.
- File size display before upload, with the 25 MB limit shown early.
- Course, lecture title, and date fields that guide transcription and generated LaTeX exports.
- Optional board-photo uploads so whiteboard equations and diagrams can augment clean notes and LaTeX output.
- Searchable metadata block at the top of every generated transcript.
- Optional language field, defaulting to `en`.
- Optional lecture context field for names, theorem names, symbols, jargon, places, or vocabulary.
- Transcript modes for raw transcript, clean notes, or LaTeX math notes.
- Clean notes and LaTeX math modes add a study introduction and end-of-transcript study summary.
- Staged status display for upload, transcription, formatting, and ready states.
- Editable transcript textarea.
- Copy transcript button.
- Download transcript as `transcript.txt`.
- Download transcript as a complete `.tex` document.
- Open the generated `.tex` document directly in Overleaf.
- Markdown headings and bullets are converted into real LaTeX sections and lists during `.tex` export.
- API usage display for the returned audio duration or token totals.
- Server-side file validation with a 25 MB upload limit.
- Lightweight server-side rate limiting to reduce accidental or abusive use.
- LaTeX delimiter validation before `.tex` export or Overleaf import.

## Run Locally

Install dependencies:

```bash
npm install
```

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Add your OpenAI API key to `.env.local`:

```bash
OPENAI_API_KEY=sk-your_key_here
APP_PASSWORD=choose-a-private-password
OPENAI_FORMAT_MODEL=gpt-4.1-mini
OPENAI_VISION_MODEL=gpt-4.1-mini
```

Start the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js, usually `http://localhost:3000`.

## Deploy with GitHub and Vercel

1. Create a new GitHub repository.
2. Push this project to that repository.
3. In Vercel, import the GitHub repository as a new project.
4. Add `OPENAI_API_KEY` as a Vercel environment variable.
5. Add `APP_PASSWORD` as a Vercel environment variable to prevent public use of your API credits.
6. Optionally add `OPENAI_FORMAT_MODEL` if you want to override the default `gpt-4.1-mini` math-formatting model.
7. Optionally add `OPENAI_VISION_MODEL` if you want to override the default `gpt-4.1-mini` board-photo analysis model.
8. Deploy the project.

Do not commit `.env`, `.env.local`, or any real API key to GitHub.

## Notes

OpenAI file uploads for this transcription route are limited to 25 MB, so this app rejects larger files before calling the API. Low-bitrate MP3s such as 48 kbps can work, but transcription accuracy may be lower if the audio is noisy, distorted, or hard to hear.

The "Clean notes" and "LaTeX math" modes make a second OpenAI API call after transcription. That second call can improve class notes, add a study introduction, and add an end-of-transcript study summary, but it adds token usage and cost. The app shows formatting token usage separately when OpenAI returns it.

Board photos are optional and are used only in "Clean notes" and "LaTeX math" modes. The browser compresses selected photos before upload, and the server extracts concise whiteboard context before formatting the transcript. There is no fixed photo-count limit in the UI, but very large batches can still hit browser, network, Vercel, or API request-size limits. Use clear photos of the board rather than many near-duplicate images.

The "Open in Overleaf" button posts the generated LaTeX document to Overleaf's official `https://www.overleaf.com/docs` import endpoint. Overleaf handles project creation and PDF compilation after the new tab opens.

Each generated transcript starts with a metadata block containing the course, lecture title, lecture date, source file, board-photo count, transcript mode, and created timestamp. This metadata is included when copying, downloading `.txt`, downloading `.tex`, or opening the document in Overleaf, so later searches can find the lecture by class or topic.

The course, lecture title, lecture date, transcript mode, and lecture context field are also sent as context to the transcription request. This helps the speech-to-text model prefer the right class vocabulary and math terminology while still grounding the transcript in the uploaded audio.
